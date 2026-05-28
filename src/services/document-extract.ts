import mammoth from "mammoth";

const TEXT_EXT = /\.(txt|md|markdown)$/i;

export function isSupportedDocument(mimeType: string, filename?: string): boolean {
  if (mimeType === "text/plain") return true;
  if (mimeType === "application/pdf") return true;
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return true;
  }
  if (!filename) return false;
  return TEXT_EXT.test(filename) || /\.(docx|pdf)$/i.test(filename);
}

export async function extractTextFromDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const lower = filename.toLowerCase();

  if (
    mimeType === "text/plain" ||
    TEXT_EXT.test(lower)
  ) {
    const text = buffer.toString("utf8").trim();
    if (!text) throw new Error("Het tekstbestand is leeg");
    return text;
  }

  if (
    mimeType.includes("wordprocessingml") ||
    lower.endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    if (!value.trim()) {
      throw new Error("Geen tekst gevonden in het Word-document");
    }
    return value.trim();
  }

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      if (!result.text?.trim()) {
        throw new Error("Geen tekst gevonden in het PDF-bestand");
      }
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`Document niet ondersteund: ${filename}`);
}
