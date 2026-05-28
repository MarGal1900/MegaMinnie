import JSZip from "jszip";

export const GESPREKSVERSLAG_FONT = "Century Gothic";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

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
  return `<w:rPr><w:rFonts w:ascii="${GESPREKSVERSLAG_FONT}" w:hAnsi="${GESPREKSVERSLAG_FONT}" w:cs="${GESPREKSVERSLAG_FONT}"/><w:sz w:val="22"/>${boldXml}</w:rPr>`;
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
export function buildGespreksverslagDocumentXml(input) {
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

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.join("")}</w:body>
</w:document>`;
}

/**
 * @param {{ meetingSubject: string; dateTimeLabel?: string | null; reportBody: string }} input
 * @returns {Promise<Blob>}
 */
export async function buildGespreksverslagDocxBlob(input) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS_XML);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS_XML);
  zip.file("word/document.xml", buildGespreksverslagDocumentXml(input));

  return zip.generateAsync({
    type: "blob",
    mimeType: DOCX_MIME,
    compression: "DEFLATE",
  });
}
