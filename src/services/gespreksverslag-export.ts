import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGespreksverslagDocxFromTemplate } from "../../public/js/gespreksverslag-docx.js";
import { ensureBezoekverslagenDir } from "../lib/bezoekverslagen-dir.js";

export type GespreksverslagExportInput = {
  meetingSubject: string;
  dateTimeLabel?: string | null;
  reportBody: string;
};

export type SavedGespreksverslagFiles = {
  docxPath: string;
  pdfPath: string;
  docxFilename: string;
  pdfFilename: string;
};

const templatePath = path.join(
  process.cwd(),
  "public",
  "templates",
  "gespreksverslag-template.dotx",
);

let cachedTemplate: Buffer | null = null;

async function loadTemplateBuffer(): Promise<Buffer> {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = await readFile(templatePath);
  return cachedTemplate;
}

/**
 * @param meetingSubject
 * @param dateTimeLabel optioneel; maakt bestandsnamen unieker
 */
export function buildGespreksverslagBasename(
  meetingSubject: string,
  dateTimeLabel?: string | null,
): string {
  const slug = sanitizeFilenameSegment(meetingSubject);
  const dateSlug = dateTimeLabel ? sanitizeFilenameSegment(dateTimeLabel) : "";
  return dateSlug ? `gespreksverslag-${slug}-${dateSlug}` : `gespreksverslag-${slug}`;
}

/** @param {string} title */
export function sanitizeFilenameSegment(title: string): string {
  const normalized = title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "notitie";
}

export async function buildGespreksverslagDocxBuffer(
  input: GespreksverslagExportInput,
): Promise<Buffer> {
  const templateBuffer = await loadTemplateBuffer();
  const arrayBuffer = templateBuffer.buffer.slice(
    templateBuffer.byteOffset,
    templateBuffer.byteOffset + templateBuffer.byteLength,
  ) as ArrayBuffer;
  const blob = await buildGespreksverslagDocxFromTemplate(arrayBuffer, input);
  return Buffer.from(await blob.arrayBuffer());
}

export async function saveGespreksverslagDocx(
  input: GespreksverslagExportInput,
): Promise<{ docxPath: string; docxFilename: string; basename: string }> {
  const dir = await ensureBezoekverslagenDir();
  const basename = buildGespreksverslagBasename(input.meetingSubject, input.dateTimeLabel);
  const docxFilename = `${basename}.docx`;
  const docxPath = path.join(dir, docxFilename);
  const buffer = await buildGespreksverslagDocxBuffer(input);
  await writeFile(docxPath, buffer);
  return { docxPath, docxFilename, basename };
}
