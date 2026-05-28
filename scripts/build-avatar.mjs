import { existsSync } from "node:fs";
import sharp from "sharp";

const source = "public/images/megaminnie.png";
const avatarOut = "public/images/megaminnie-avatar.png";
const profileOut = "public/images/megaminnie-profile.png";

/** Header-kader: 92×100 px (5.75rem × 6.25rem) — beeldvullend, armen zichtbaar */
const PROFILE_W = 368;
const PROFILE_H = 400;
const HEADER_ASPECT = 92 / 100;

if (!existsSync(source)) {
  console.log(`Geen ${source} — gebruik npm run avatar voor placeholder`);
  process.exit(0);
}

const trimmed = await sharp(source)
  .trim({ background: "#ffffff", threshold: 10 })
  .toBuffer();

const meta = await sharp(trimmed).metadata();
const w = meta.width ?? 790;
const h = meta.height ?? 1024;

// Vierkante crop voor algemene avatar (icon)
const side = Math.round(Math.min(w, h) * 0.58);
const squareLeft = Math.round((w - side) / 2);
const squareTop = Math.round(h * 0.06);

const square = await sharp(trimmed)
  .extract({
    left: squareLeft,
    top: squareTop,
    width: side,
    height: side,
  })
  .resize(512, 512)
  .png()
  .toBuffer();

await sharp(square).toFile(avatarOut);

// Header: volle breedte, crop hoogte op kader-ratio, bovenste deel (geen menigte)
let cropW = w;
let cropH = Math.round(cropW / HEADER_ASPECT);
const maxH = Math.round(h * 0.76);

if (cropH > maxH) {
  cropH = maxH;
  cropW = Math.round(cropH * HEADER_ASPECT);
}

const profileLeft = Math.max(0, Math.round((w - cropW) / 2));
const profileTop = 0;

await sharp(trimmed)
  .extract({
    left: profileLeft,
    top: profileTop,
    width: Math.min(cropW, w - profileLeft),
    height: Math.min(cropH, h - profileTop),
  })
  .resize(PROFILE_W, PROFILE_H, {
    fit: "cover",
    position: "attention",
  })
  .png()
  .toFile(profileOut);

console.log(`OK: ${avatarOut}, ${profileOut}`);
