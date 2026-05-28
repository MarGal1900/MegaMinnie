import { getWhisperModel, getWhisperProvider } from "./whisper-config.js";
import { getWhisperServiceRoot } from "./whisper-health.js";

/** Zorg dat het STT-model op de lokale Speaches-server staat (anders 404). */
export async function ensureWhisperModelLoaded(): Promise<void> {
  if (getWhisperProvider() !== "local") return;

  const root = getWhisperServiceRoot();
  const modelId = getWhisperModel();
  if (!root) return;

  const listRes = await fetch(`${root}/v1/models`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!listRes.ok) {
    throw new Error(
      "Whisper-server reageert niet. Start met: npm run whisper:up",
    );
  }

  const list = (await listRes.json()) as { data?: { id: string }[] };
  if (list.data?.some((m) => m.id === modelId)) return;

  console.log(`[whisper] Model downloaden: ${modelId}…`);
  const dlRes = await fetch(`${root}/v1/models/${modelId}`, {
    method: "POST",
    signal: AbortSignal.timeout(600_000),
  });

  if (!dlRes.ok) {
    const detail = await dlRes.text().catch(() => "");
    throw new Error(
      `Whisper-model "${modelId}" niet beschikbaar (${dlRes.status}). ` +
        `Voer uit: npm run whisper:download. ${detail}`.trim(),
    );
  }
}
