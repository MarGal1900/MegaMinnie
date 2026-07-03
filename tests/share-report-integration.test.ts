import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGespreksverslagDocxBuffer,
  saveGespreksverslagDocx,
} from "../src/services/gespreksverslag-export.js";
import { convertDocxToPdf } from "../src/services/docx-to-pdf.js";
import { ensureBezoekverslagenDir } from "../src/lib/bezoekverslagen-dir.js";

const templatePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/templates/gespreksverslag-template.dotx",
);

describe("buildGespreksverslagDocxBuffer", () => {
  it("maakt een geldig docx-buffer", async () => {
    readFileSync(templatePath);
    const buffer = await buildGespreksverslagDocxBuffer({
      meetingSubject: "Kick-off Acme",
      dateTimeLabel: "28-05-2026, 11:27",
      reportBody: "**Samenvatting:**\nGoed gesprek.",
    });
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
  });
});

describe("saveGespreksverslagDocx", () => {
  /** @type {string | undefined} */
  let tempRoot;
  /** @type {string | undefined} */
  let prevDir;

  afterEach(async () => {
    if (prevDir !== undefined) {
      if (prevDir) process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR = prevDir;
      else delete process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR;
      prevDir = undefined;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("schrijft docx naar Bezoekverslagen-map", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "megaminnie-bv-"));
    prevDir = process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR;
    process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR = path.join(tempRoot, "Bezoekverslagen");

    const saved = await saveGespreksverslagDocx({
      meetingSubject: "Kick-off Acme",
      dateTimeLabel: "28-05-2026, 11:27",
      reportBody: "**Samenvatting:**\nGoed gesprek.",
    });

    expect(saved.docxFilename).toBe("gespreksverslag-kick-off-acme-28-05-2026-1127.docx");
    const onDisk = await readFile(saved.docxPath);
    expect(onDisk.subarray(0, 2).toString("utf8")).toBe("PK");
    await ensureBezoekverslagenDir();
  });
});

describe("convertDocxToPdf", () => {
  /** @type {string | undefined} */
  let tempRoot;
  /** @type {string | undefined} */
  let prevDir;

  afterEach(async () => {
    if (prevDir !== undefined) {
      if (prevDir) process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR = prevDir;
      else delete process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR;
      prevDir = undefined;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it.skipIf(process.env.CI === "true")(
    "converteert docx naar pdf wanneer Word of LibreOffice beschikbaar is",
    async () => {
      tempRoot = await mkdtemp(path.join(tmpdir(), "megaminnie-pdf-"));
      prevDir = process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR;
      process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR = path.join(tempRoot, "Bezoekverslagen");

      const saved = await saveGespreksverslagDocx({
        meetingSubject: "PDF test",
        reportBody: "Testverslag voor PDF.",
      });
      const pdfPath = saved.docxPath.replace(/\.docx$/i, ".pdf");
      await convertDocxToPdf(saved.docxPath, pdfPath);
      const pdf = await readFile(pdfPath);
      expect(pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    },
    180_000,
  );
});
