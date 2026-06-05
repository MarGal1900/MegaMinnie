import { APIError } from "openai";
import { toFile } from "openai";
import {
  getTranscriptionProfile,
  getWhisperLanguage,
  getWhisperModel,
  getWhisperProvider,
  isWhisperConfigured,
  MAX_AUDIO_BYTES,
} from "../lib/whisper-config.js";
import { getWhisperClient } from "../lib/whisper-client.js";
import { ensureWhisperModelLoaded } from "../lib/whisper-model.js";
import { buildWhisperPrompt } from "../lib/whisper-prompts.js";

const SUPPORTED_AUDIO = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/m4a",
  "audio/x-m4a",
]);

export { MAX_AUDIO_BYTES };

export function isSupportedAudio(mimeType: string): boolean {
  return SUPPORTED_AUDIO.has(mimeType) || mimeType.startsWith("audio/");
}

export interface TranscriptionSegment {
  speaker?: string;
  start?: number;
  end?: number;
  text?: string;
}

export interface TranscriptionResult {
  text: string;
  segments?: TranscriptionSegment[];
  qualityWarning?: string;
}

export type TranscribeOptions = {
  /** Extra prompt (gecombineerd met domein-jargon). */
  prompt?: string;
  /** Standaard true — zet false voor korte commando-opnames zonder vakjargon. */
  useDomainPrompt?: boolean;
  /** Sprekerherkenning (cloud + gpt-4o-transcribe-diarize). */
  diarize?: boolean;
};

function assertAudioSize(buffer: Buffer): void {
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `Audiobestand is te groot (${Math.round(buffer.byteLength / 1024 / 1024)} MB). ` +
        "Maximum is 25 MB — neem korter op of exporteer als kleiner bestand.",
    );
  }
  if (buffer.byteLength < 512) {
    throw new Error("Audiobestand is te klein of leeg.");
  }
}

function formatDiarizedText(segments: TranscriptionSegment[]): string {
  const labels = new Map<string, string>();
  let n = 0;
  return segments
    .map((seg) => {
      const key = seg.speaker ?? "unknown";
      if (!labels.has(key)) {
        labels.set(
          key,
          n === 0
            ? "Accountmanager"
            : n === 1
              ? "Klant"
              : `Spreker ${n + 1}`,
        );
        n++;
      }
      return `[${labels.get(key)}]: ${(seg.text ?? "").trim()}`;
    })
    .filter((line) => line.length > 4)
    .join("\n");
}

function detectQualityWarning(verbose: {
  segments?: { compression_ratio?: number; no_speech_prob?: number }[];
}): string | undefined {
  const bad = verbose.segments?.some(
    (s) => (s.compression_ratio ?? 0) > 2.4 || (s.no_speech_prob ?? 0) > 0.6,
  );
  return bad
    ? "Audiokwaliteit lijkt matig — controleer het verslag extra goed."
    : undefined;
}

function normalizeText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object" && "text" in result) {
    return String((result as { text: string }).text).trim();
  }
  return String(result).trim();
}

function shouldUseDiarization(options: TranscribeOptions): boolean {
  if (options.diarize === true) return true;
  if (options.diarize === false) return false;
  return getTranscriptionProfile() === "diarize";
}

function isLegacyWhisperModel(model: string): boolean {
  return model === "whisper-1" || getWhisperProvider() === "local";
}

/**
 * Spraak → transcriptie via OpenAI of lokaal faster-whisper.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  mimeType = "audio/webm",
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  if (!isWhisperConfigured()) {
    throw new Error(
      "Spraak vereist OPENAI_API_KEY (cloud) of WHISPER_BASE_URL (lokaal). Zie .env.example.",
    );
  }

  assertAudioSize(buffer);
  await ensureWhisperModelLoaded();

  const useDiarize = shouldUseDiarization(options);
  if (useDiarize && getWhisperProvider() !== "openai") {
    throw new Error(
      "Sprekerherkenning vereist OpenAI cloud (WHISPER_PROFILE=diarize). " +
        "Verwijder WHISPER_BASE_URL of kies een ander profiel.",
    );
  }

  const model = useDiarize ? "gpt-4o-transcribe-diarize" : getWhisperModel();
  const file = await toFile(buffer, filename, { type: mimeType });
  const whisperPrompt = useDiarize
    ? undefined
    : buildWhisperPrompt({
        domain: options.useDomainPrompt !== false,
        extra: options.prompt,
      });

  try {
    if (useDiarize) {
      const result = await getWhisperClient().audio.transcriptions.create({
        model: "gpt-4o-transcribe-diarize",
        file,
        language: getWhisperLanguage(),
        response_format: "diarized_json",
        chunking_strategy: "auto",
        ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
      } as unknown as Parameters<
        ReturnType<typeof getWhisperClient>["audio"]["transcriptions"]["create"]
      >[0]);

      const segments =
        (result as { segments?: TranscriptionSegment[] }).segments ?? [];
      const text = formatDiarizedText(segments);
      if (!text.trim()) {
        throw new Error("Geen spraak herkend in het audiobestand");
      }
      return { text, segments };
    }

    if (isLegacyWhisperModel(model)) {
      const result = await getWhisperClient().audio.transcriptions.create({
        model,
        file,
        language: getWhisperLanguage(),
        response_format: "verbose_json",
        ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
      });

      const verbose = result as {
        text?: string;
        segments?: { compression_ratio?: number; no_speech_prob?: number }[];
      };
      const text = normalizeText(verbose);
      if (!text) throw new Error("Geen spraak herkend in het audiobestand");

      return {
        text,
        qualityWarning: detectQualityWarning(verbose),
      };
    }

    const result = await getWhisperClient().audio.transcriptions.create({
      model,
      file,
      language: getWhisperLanguage(),
      response_format: "json",
      ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
    });

    const text = normalizeText(result);
    if (!text) throw new Error("Geen spraak herkend in het audiobestand");
    return { text };
  } catch (err) {
    if (err instanceof APIError) {
      if (err.status === 413) {
        throw new Error(
          "Audiobestand te groot voor Whisper API (max. 25 MB).",
        );
      }
      if (err.status === 404) {
        throw new Error(
          `Transcriptiemodel "${model}" niet gevonden. Controleer WHISPER_MODEL of voer npm run whisper:download uit.`,
        );
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|Connection error|fetch failed/i.test(msg)) {
      throw new Error(
        "Whisper-server niet bereikbaar. Start met: npm run whisper:up",
      );
    }
    throw err;
  }
}
