import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LIBREOFFICE_CANDIDATES = [
  "soffice",
  "libreoffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLibreOfficeBinary(): Promise<string | null> {
  for (const candidate of LIBREOFFICE_CANDIDATES) {
    if (candidate.includes(path.sep) || candidate.includes("/")) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5000 });
      return candidate;
    } catch {
      /* probeer volgende */
    }
  }
  return null;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function convertWithWordCom(docxPath: string, pdfPath: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$docx = ${psQuote(docxPath)}`,
    `$pdf = ${psQuote(pdfPath)}`,
    "$word = New-Object -ComObject Word.Application",
    "$word.Visible = $false",
    "try {",
    "  $doc = $word.Documents.Open($docx)",
    "  $doc.SaveAs2($pdf, 17)",
    "  $doc.Close([ref]0)",
    "} finally {",
    "  $word.Quit()",
    "  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)",
    "}",
  ].join("; ");

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: 120_000, windowsHide: true },
  );

  if (!(await fileExists(pdfPath))) {
    throw new Error("Word kon het PDF-bestand niet aanmaken.");
  }
}

async function convertWithLibreOffice(
  docxPath: string,
  pdfPath: string,
  binary: string,
): Promise<void> {
  const outDir = path.dirname(pdfPath);
  await execFileAsync(
    binary,
    ["--headless", "--convert-to", "pdf", "--outdir", outDir, docxPath],
    { timeout: 120_000, windowsHide: true },
  );

  const expectedName = `${path.basename(docxPath, path.extname(docxPath))}.pdf`;
  const generatedPath = path.join(outDir, expectedName);
  if (generatedPath !== pdfPath && (await fileExists(generatedPath))) {
    const { rename } = await import("node:fs/promises");
    await rename(generatedPath, pdfPath);
  }

  if (!(await fileExists(pdfPath))) {
    throw new Error("LibreOffice kon het PDF-bestand niet aanmaken.");
  }
}

/**
 * Converteert een DOCX naar PDF via Microsoft Word (Windows) of LibreOffice.
 */
export async function convertDocxToPdf(docxPath: string, pdfPath: string): Promise<void> {
  if (process.platform === "win32") {
    try {
      await convertWithWordCom(docxPath, pdfPath);
      return;
    } catch (wordError) {
      const libreOffice = await resolveLibreOfficeBinary();
      if (libreOffice) {
        await convertWithLibreOffice(docxPath, pdfPath, libreOffice);
        return;
      }
      throw wordError;
    }
  }

  const libreOffice = await resolveLibreOfficeBinary();
  if (!libreOffice) {
    throw new Error(
      "PDF-conversie vereist LibreOffice (soffice in PATH) of Windows met Microsoft Word.",
    );
  }
  await convertWithLibreOffice(docxPath, pdfPath, libreOffice);
}
