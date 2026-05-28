import { createVisionCompletion } from "../lib/llm.js";

const SUPPORTED_IMAGE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i;

const SYSTEM_PROMPT = `Je transcribeert foto's van bezoeknotities (handschrift, whiteboard, briefje) naar Nederlandse tekst.

Dit is alleen de ruwe bron — een volgende stap werkt dit later uit tot een volledig verslag.
- Lees ALLES wat zichtbaar is, zo getrouw mogelijk (bullets en steekwoorden mag).
- Noteer namen, bedrijven, data, cijfers en afspraken zoals op de foto.
- Geen sales-verslag schrijven hier; alleen transcriberen wat er staat.
- Onleesbaar: [onleesbaar]. Onzeker: [?].
- Verzin niets dat niet op de foto staat.
- Meerdere foto's: één doorlopende transcriptie in leesvolgorde.`;

export function isSupportedImage(mimeType: string, filename?: string): boolean {
  if (SUPPORTED_IMAGE.has(mimeType)) return true;
  if ((!mimeType || mimeType === "application/octet-stream") && filename) {
    return IMAGE_EXT.test(filename);
  }
  return false;
}

export function guessImageMimeType(filename: string, fallback = "image/jpeg"): string {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".bmp": "image/png",
  };
  return map[ext] ?? fallback;
}

export type PhotoInput = { buffer: Buffer; mimeType: string };

/** Eén of meerdere foto's → uitgewerkte tekst voor MegaMinnie. */
export async function extractTextFromPhotos(
  images: PhotoInput[],
  context?: string,
): Promise<string> {
  if (images.length === 0) {
    throw new Error("Geen foto's ontvangen");
  }

  const userText =
    images.length === 1
      ? "Transcribeer letterlijk alle tekst op deze foto (ruwe aantekening, niets weglaten):"
      : `Transcribeer letterlijk alle tekst op deze ${images.length} foto's (zelfde bezoek). Ruwe transcriptie, niets weglaten:`;

  const userParts = [userText];
  if (context?.trim()) {
    userParts.push(`Extra context van sales: ${context.trim()}`);
  }

  const text = await createVisionCompletion({
    system: SYSTEM_PROMPT,
    userText: userParts.join("\n\n"),
    images,
  });

  if (!text.trim()) {
    throw new Error("Geen tekst uit de foto's gehaald");
  }
  return text.trim();
}
