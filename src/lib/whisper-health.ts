import { getWhisperBaseUrl, getWhisperProvider, isWhisperConfigured } from "./whisper-config.js";

/** Root-URL van Speaches/faster-whisper (zonder /v1). */
export function getWhisperServiceRoot(): string | null {
  const base = getWhisperBaseUrl();
  if (!base) return null;
  return base.replace(/\/v1\/?$/, "");
}

/** Of de lokale Whisper-service bereikbaar is (alleen bij WHISPER_BASE_URL). */
export async function isWhisperServiceReachable(): Promise<boolean> {
  if (!isWhisperConfigured() || getWhisperProvider() !== "local") {
    return false;
  }
  const root = getWhisperServiceRoot();
  if (!root) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${root}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
