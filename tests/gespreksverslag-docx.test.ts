import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  GESPREKSVERSLAG_FONT,
  buildGespreksverslagDocxBlob,
  buildGespreksverslagDocumentXml,
  buildParagraphXmlFromLine,
  buildRunPropertiesXml,
} from "../public/js/gespreksverslag-docx.js";

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

describe("buildGespreksverslagDocumentXml", () => {
  it("bevat titel, datum en verslag", () => {
    const xml = buildGespreksverslagDocumentXml({
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

describe("buildGespreksverslagDocxBlob", () => {
  it("maakt een geldig docx-bestand", async () => {
    const blob = await buildGespreksverslagDocxBlob({
      meetingSubject: "Kick-off Acme",
      dateTimeLabel: "28 mei 2026",
      reportBody: "Inhoud van het verslag.",
    });

    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("Kick-off Acme");
    expect(documentXml).toContain(GESPREKSVERSLAG_FONT);
  });
});
