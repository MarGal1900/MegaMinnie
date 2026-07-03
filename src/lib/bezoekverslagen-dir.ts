import { mkdir } from "node:fs/promises";
import path from "node:path";

export const BEZOEKVERSLAGEN_DIRNAME = "Bezoekverslagen";

/** Absolute pad naar de map Bezoekverslagen in de MegaMinnie-werkmap. */
export function resolveBezoekverslagenDir(cwd = process.cwd()): string {
  const override = process.env.MEGAMINNIE_BEZOEKVERSLAGEN_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(cwd, BEZOEKVERSLAGEN_DIRNAME);
}

export async function ensureBezoekverslagenDir(cwd = process.cwd()): Promise<string> {
  const dir = resolveBezoekverslagenDir(cwd);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** @returns true wanneer opslag op schijf en lokale mail-automation beschikbaar zijn. */
export function isLocalShareStorageEnabled(): boolean {
  if (process.env.MEGAMINNIE_DISABLE_LOCAL_SHARE === "true") return false;
  if (process.env.VERCEL) return false;
  return true;
}

export function isOutlookComposeAutomationEnabled(): boolean {
  return isLocalShareStorageEnabled() && process.platform === "win32";
}

const SAFE_FILENAME =
  /^gespreksverslag-[a-z0-9][a-z0-9-]*\.(docx|pdf)$/i;

/** Voorkomt path traversal bij download van opgeslagen verslagen. */
export function isSafeBezoekverslagFilename(filename: string): boolean {
  const base = path.basename(filename);
  return base === filename && SAFE_FILENAME.test(base);
}
