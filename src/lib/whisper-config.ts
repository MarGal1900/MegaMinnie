/** Spraak-transcriptie: OpenAI cloud of lokaal (faster-whisper via Speaches). */

export type WhisperProvider = "openai" | "local";

/** Cloud-only profielen; lokaal gebruikt HuggingFace-model-id via Speaches. */
export type TranscriptionProfile = "quality" | "fast" | "diarize" | "legacy";

/** Gelijk aan multer fileSize-limiet in visit-report routes. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function getWhisperProvider(): WhisperProvider {
  if (process.env.WHISPER_BASE_URL?.trim()) return "local";
  return "openai";
}

export function isWhisperConfigured(): boolean {
  if (getWhisperProvider() === "local") {
    return Boolean(process.env.WHISPER_BASE_URL?.trim());
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getTranscriptionProfile(): TranscriptionProfile {
  const raw = process.env.WHISPER_PROFILE?.trim().toLowerCase();
  if (raw === "fast" || raw === "diarize" || raw === "legacy") return raw;
  return "quality";
}

export function getWhisperModel(): string {
  const explicit = process.env.WHISPER_MODEL?.trim();
  if (explicit) return explicit;

  if (getWhisperProvider() === "local") {
    return (
      process.env.WHISPER_LOCAL_MODEL?.trim() || "Systran/faster-whisper-medium"
    );
  }

  switch (getTranscriptionProfile()) {
    case "fast":
      return "gpt-4o-mini-transcribe";
    case "diarize":
      return "gpt-4o-transcribe-diarize";
    case "legacy":
      return "whisper-1";
    default:
      return "gpt-4o-mini-transcribe";
  }
}

export function getWhisperLanguage(): string {
  return process.env.WHISPER_LANGUAGE?.trim() || "nl";
}

export function getWhisperBaseUrl(): string | undefined {
  const url = process.env.WHISPER_BASE_URL?.trim();
  return url || undefined;
}

export function getWhisperApiKey(): string {
  if (getWhisperProvider() === "local") {
    return process.env.WHISPER_API_KEY?.trim() || "not-needed";
  }
  return process.env.OPENAI_API_KEY?.trim() || "";
}
