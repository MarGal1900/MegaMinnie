import sharp from "sharp";

const MAX_EDGE = Number(process.env.IMAGE_MAX_EDGE) || 2048;
const JPEG_QUALITY = Number(process.env.IMAGE_JPEG_QUALITY) || 90;

/** Verklein foto voor snellere upload en API (behoud leesbaarheid handschrift). */
export async function prepareImageForApi(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const pipeline = sharp(buffer, { failOn: "none" }).rotate();

  const meta = await pipeline.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  const keepOriginal =
    w > 0 &&
    h > 0 &&
    w <= MAX_EDGE &&
    h <= MAX_EDGE &&
    mimeType === "image/jpeg" &&
    buffer.length < 4 * 1024 * 1024;

  if (keepOriginal) {
    return { buffer, mimeType };
  }

  const out = await pipeline
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return { buffer: out, mimeType: "image/jpeg" };
}
