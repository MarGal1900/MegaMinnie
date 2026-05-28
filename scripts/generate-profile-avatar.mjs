import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const outDir = "public/images";
const outFile = `${outDir}/megaminnie-profile.png`;

await mkdir(outDir, { recursive: true });

// Afgeronde rechthoek ~92×116 (header crop), roze achtergrond + vliegende figuur-silhouet
const svg = `
<svg width="184" height="232" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f5d0e0"/>
      <stop offset="100%" style="stop-color:#e8c4d4"/>
    </linearGradient>
  </defs>
  <rect width="184" height="232" rx="28" fill="url(#bg)"/>
  <ellipse cx="92" cy="200" rx="36" ry="8" fill="#c49ab0" opacity="0.35"/>
  <circle cx="92" cy="72" r="28" fill="#fff8fb" stroke="#d4a0b8" stroke-width="2"/>
  <path d="M92 100 Q72 130 58 168 Q88 155 92 140 Q96 155 126 168 Q112 130 92 100" fill="#fff8fb" stroke="#d4a0b8" stroke-width="2"/>
  <path d="M64 118 Q48 108 40 92 Q56 98 64 118" fill="#fff8fb" stroke="#d4a0b8" stroke-width="2"/>
  <path d="M120 118 Q136 108 144 92 Q128 98 120 118" fill="#fff8fb" stroke="#d4a0b8" stroke-width="2"/>
  <circle cx="84" cy="68" r="3" fill="#5c3d4a"/>
  <circle cx="100" cy="68" r="3" fill="#5c3d4a"/>
  <path d="M86 78 Q92 82 98 78" fill="none" stroke="#5c3d4a" stroke-width="2" stroke-linecap="round"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(outFile);
console.log(`OK: ${outFile}`);
