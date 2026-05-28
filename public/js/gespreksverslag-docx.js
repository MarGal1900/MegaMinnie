import JSZip from "jszip";

export const GESPREKSVERSLAG_FONT = "Century Gothic";
export const GESPREKSVERSLAG_TEMPLATE_URL = "/templates/gespreksverslag-template.dotx";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TEMPLATE_MAIN_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const DOCUMENT_MAIN_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

/** @type {ArrayBuffer | null} */
let cachedTemplateBuffer = null;

/**
 * @param {string} [templateUrl]
 * @returns {Promise<ArrayBuffer>}
 */
export async function loadGespreksverslagTemplate(
  templateUrl = GESPREKSVERSLAG_TEMPLATE_URL,
) {
  if (cachedTemplateBuffer) return cachedTemplateBuffer;

  const response = await fetch(templateUrl);
  if (!response.ok) {
    throw new Error(`Gespreksverslag-template niet gevonden (${response.status}).`);
  }

  cachedTemplateBuffer = await response.arrayBuffer();
  return cachedTemplateBuffer;
}

export function clearGespreksverslagTemplateCache() {
  cachedTemplateBuffer = null;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeXmlText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * @param {boolean} [bold]
 * @returns {string}
 */
export function buildRunPropertiesXml(bold = false) {
  const boldXml = bold ? "<w:b/>" : "";
  return `<w:rPr><w:rFonts w:ascii="${GESPREKSVERSLAG_FONT}" w:hAnsi="${GESPREKSVERSLAG_FONT}" w:cs="${GESPREKSVERSLAG_FONT}"/><w:sz w:val="22"/><w:lang w:val="nl-NL"/>${boldXml}</w:rPr>`;
}

/**
 * @param {string} text
 * @param {boolean} [bold]
 * @returns {string}
 */
export function buildTextRunXml(text, bold = false) {
  const safe = escapeXmlText(text || " ");
  return `<w:r>${buildRunPropertiesXml(bold)}<w:t xml:space="preserve">${safe}</w:t></w:r>`;
}

/**
 * @param {string} line
 * @returns {string}
 */
export function buildParagraphXmlFromLine(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
  if (!parts.length) {
    return `<w:p>${buildTextRunXml(" ")}</w:p>`;
  }

  const runs = parts
    .map((part) => {
      const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
      if (boldMatch) {
        return buildTextRunXml(boldMatch[1], true);
      }
      return buildTextRunXml(part, false);
    })
    .join("");

  return `<w:p>${runs}</w:p>`;
}

/**
 * @param {string} text
 * @param {boolean} [bold]
 * @returns {string}
 */
export function buildParagraphXml(text, bold = false) {
  return `<w:p>${buildTextRunXml(text, bold)}</w:p>`;
}

/**
 * @param {{ meetingSubject: string; dateTimeLabel?: string | null; reportBody: string }} input
 * @returns {string}
 */
export function buildReportBodyParagraphsXml(input) {
  const paragraphs = [
    buildParagraphXml(
      `Notitietitel: ${input.meetingSubject.trim() || "Meeting"}`,
      true,
    ),
  ];

  const dateTime = input.dateTimeLabel?.trim();
  if (dateTime) {
    paragraphs.push(buildParagraphXml(`Datum/tijd: ${dateTime}`));
  }

  paragraphs.push(buildParagraphXml(""));

  for (const line of input.reportBody.trim().split(/\r?\n/)) {
    paragraphs.push(buildParagraphXmlFromLine(line));
  }

  return paragraphs.join("");
}

/**
 * Voegt verslag-inhoud in na het voorblad (pagina 1); sectPr en footers blijven intact.
 *
 * @param {string} documentXml
 * @param {string} reportParagraphsXml
 * @returns {string}
 */
export function mergeReportIntoTemplateDocument(documentXml, reportParagraphsXml) {
  const bodyMatch = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) {
    throw new Error("Ongeldig Word-document: geen body gevonden.");
  }

  const bodyInner = bodyMatch[1];
  const sectPrMatch = bodyInner.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  if (!sectPrMatch) {
    throw new Error("Ongeldig template: sectPr ontbreekt.");
  }
  const sectPrXml = sectPrMatch[0];

  const pageBreakMarker = '<w:br w:type="page"/>';
  const pageBreakIdx = bodyInner.indexOf(pageBreakMarker);
  if (pageBreakIdx < 0) {
    throw new Error("Ongeldig template: pagina-einde voorblad ontbreekt.");
  }

  const coverEndIdx = bodyInner.indexOf("</w:p>", pageBreakIdx);
  if (coverEndIdx < 0) {
    throw new Error("Ongeldig template: einde voorblad niet gevonden.");
  }
  const coverEnd = coverEndIdx + "</w:p>".length;
  const coverXml = bodyInner.slice(0, coverEnd);

  const newBodyInner = `${coverXml}${reportParagraphsXml}${sectPrXml}`;
  return documentXml.replace(bodyMatch[0], `<w:body>${newBodyInner}</w:body>`);
}

/**
 * @deprecated Gebruik buildReportBodyParagraphsXml + mergeReportIntoTemplateDocument.
 * @param {{ meetingSubject: string; dateTimeLabel?: string | null; reportBody: string }} input
 * @returns {string}
 */
export function buildGespreksverslagDocumentXml(input) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${buildReportBodyParagraphsXml(input)}</w:body>
</w:document>`;
}

/**
 * @param {string} contentTypesXml
 * @returns {string}
 */
export function convertTemplateContentTypesToDocument(contentTypesXml) {
  return contentTypesXml.replace(
    TEMPLATE_MAIN_CONTENT_TYPE,
    DOCUMENT_MAIN_CONTENT_TYPE,
  );
}

/**
 * @param {ArrayBuffer} templateBuffer
 * @param {{ meetingSubject: string; dateTimeLabel?: string | null; reportBody: string }} input
 * @returns {Promise<Blob>}
 */
export async function buildGespreksverslagDocxFromTemplate(
  templateBuffer,
  input,
) {
  const zip = await JSZip.loadAsync(templateBuffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Ongeldig template: word/document.xml ontbreekt.");
  }

  const documentXml = await documentFile.async("string");
  const reportParagraphsXml = buildReportBodyParagraphsXml(input);
  const mergedDocumentXml = mergeReportIntoTemplateDocument(
    documentXml,
    reportParagraphsXml,
  );
  zip.file("word/document.xml", mergedDocumentXml);

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (contentTypesFile) {
    const contentTypesXml = await contentTypesFile.async("string");
    zip.file(
      "[Content_Types].xml",
      convertTemplateContentTypesToDocument(contentTypesXml),
    );
  }

  return zip.generateAsync({
    type: "blob",
    mimeType: DOCX_MIME,
    compression: "DEFLATE",
  });
}

/**
 * @param {{ meetingSubject: string; dateTimeLabel?: string | null; reportBody: string }} input
 * @param {{ templateUrl?: string; templateBuffer?: ArrayBuffer }} [options]
 * @returns {Promise<Blob>}
 */
export async function buildGespreksverslagDocxBlob(input, options = {}) {
  const templateBuffer =
    options.templateBuffer ??
    (await loadGespreksverslagTemplate(options.templateUrl));

  return buildGespreksverslagDocxFromTemplate(templateBuffer, input);
}
