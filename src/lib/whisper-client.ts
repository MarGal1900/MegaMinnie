import OpenAI from "openai";
import {
  getWhisperApiKey,
  getWhisperBaseUrl,
  getWhisperProvider,
} from "./whisper-config.js";

let whisperClient: OpenAI | null = null;

/** OpenAI-client voor audio.transcriptions (cloud of lokaal faster-whisper endpoint). */
export function getWhisperClient(): OpenAI {
  const apiKey = getWhisperApiKey();

  if (getWhisperProvider() === "local") {
    const baseURL = getWhisperBaseUrl();
    if (!baseURL) {
      throw new Error(
        "WHISPER_BASE_URL ontbreekt. Zet bijv. WHISPER_BASE_URL=http://127.0.0.1:8000/v1 in .env.",
      );
    }
    if (!whisperClient) {
      whisperClient = new OpenAI({ apiKey, baseURL });
    }
    return whisperClient;
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "Spraak vereist OPENAI_API_KEY (OpenAI Whisper) of WHISPER_BASE_URL (lokaal faster-whisper).",
    );
  }

  if (!whisperClient) {
    whisperClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY!.trim() });
  }
  return whisperClient;
}
