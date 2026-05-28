import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GESPREKSVERSLAG_FONT,
  buildGespreksverslagDocxBlob,
  buildParagraphXmlFromLine,
  buildReportBodyParagraphsXml,
  buildRunPropertiesXml,
  clearGespreksverslagTemplateCache,
  convertTemplateContentTypesToDocument,
  mergeReportIntoTemplateDocument,
} from "../public/js/gespreksverslag-docx.js";

const templatePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/templates/gespreksverslag-template.dotx",
);

function loadTemplateBuffer() {
  const file = readFileSync(templatePath);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

beforeEach(() => {
  clearGespreksverslagTemplateCache();
});

describe("buildRunPropertiesXml", () => {
  it("gebruikt Century Gothic", () => {
    expect(buildRunPropertiesXml()).toContain(GESPREKSVERSLAG_FONT);
  });
});

describe("buildParagraphXmlFromLine", () => {
  it("zet markdown vetgedrukt om naar bold runs", () => {
    const xml = buildParagraphXmlFromLine("**Samenvatting:** Goed gesprek.");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("Samenvatting:");
    expect(xml).toContain("Goed gesprek.");
  });
});

describe("buildReportBodyParagraphsXml", () => {
  it("bevat titel, datum en verslag", () => {
    const xml = buildReportBodyParagraphsXml({
      meetingSubject: "Interview 28-05-2026, 11:27",
      dateTimeLabel: "28-05-2026, 11:27",
      reportBody: "**Samenvatting:**\nGoed gesprek.",
    });

    expect(xml).toContain("Notitietitel: Interview 28-05-2026, 11:27");
    expect(xml).toContain("Datum/tijd: 28-05-2026, 11:27");
    expect(xml).toContain("Samenvatting:");
    expect(xml).toContain(GESPREKSVERSLAG_FONT);
  });
});

describe("mergeReportIntoTemplateDocument", () => {
  it("behoudt voorblad en plaatst verslag na pagina-einde", async () => {
    const zip = await JSZip.loadAsync(loadTemplateBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toBeTruthy();

    const reportXml = buildReportBodyParagraphsXml({
      meetingSubject: "Kick-off Acme",
      dateTimeLabel: "28 mei 2026",
      reportBody: "Inhoud van het verslag.",
    });

    const merged = mergeReportIntoTemplateDocument(documentXml ?? "", reportXml);
    const pageBreakIdx = merged.indexOf('<w:br w:type="page"/>');
    const reportIdx = merged.indexOf("Notitietitel: Kick-off Acme");

    expect(pageBreakIdx).toBeGreaterThan(0);
    expect(reportIdx).toBeGreaterThan(pageBreakIdx);
    expect(merged).toContain("Gespreskverslag");
    expect(merged).not.toContain('w14:paraId="3D744CEF"');
  });
});

describe("convertTemplateContentTypesToDocument", () => {
  it("zet template content type om naar document", () => {
    const xml =
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/>';
    const converted = convertTemplateContentTypesToDocument(xml);
    expect(converted).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
    expect(converted).not.toContain("template.main");
  });
});

describe("buildGespreksverslagDocxBlob", () => {
  it("maakt een geldig docx op basis van het template", async () => {
    const blob = await buildGespreksverslagDocxBlob(
      {
        meetingSubject: "Kick-off Acme",
        dateTimeLabel: "28 mei 2026",
        reportBody: "Inhoud van het verslag.",
      },
      { templateBuffer: loadTemplateBuffer() },
    );

    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");

    expect(documentXml).toContain("Kick-off Acme");
    expect(documentXml).toContain("Gespreskverslag");
    expect(documentXml).toContain('<w:br w:type="page"/>');
    expect(contentTypes).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
    expect(contentTypes).not.toContain("template.main");
  });
});
