import { getOpenAiApiKey, getRealtimeVoice } from "./realtime-config.js";

export const DEFAULT_SPEECH_MODEL = "gpt-4o-mini-tts";
export const MAX_SPEECH_INPUT_CHARS = 4096;

/** Zelfde toon/tempo als de Realtime-wijzigingsdialoog (correctie/taak/agenda). */
export const DEFAULT_SPEECH_INSTRUCTIONS =
  "Spreek natuurlijk en rustig Nederlands. Houd antwoorden kort en helder — dezelfde toon als een MegaMinnie-wijzigingsgesprek.";

export function getSpeechModel(): string {
  return process.env.OPENAI_SPEECH_MODEL?.trim() || DEFAULT_SPEECH_MODEL;
}

export function getSpeechVoice(): string {
  return getRealtimeVoice();
}

export function getSpeechInstructions(): string {
  return process.env.OPENAI_SPEECH_INSTRUCTIONS?.trim() || DEFAULT_SPEECH_INSTRUCTIONS;
}

export function getSpeechSpeed(): number {
  const raw = process.env.OPENAI_SPEECH_SPEED?.trim();
  if (!raw) return 1.0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0.25 && n <= 4.0 ? n : 1.0;
}

export type SpeechPrereqResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function validateSpeechPrereqs(apiKey: string): SpeechPrereqResult {
  if (!apiKey.trim()) {
    return {
      ok: false,
      status: 503,
      error: "OpenAI-spraak is niet geconfigureerd (OPENAI_API_KEY ontbreekt).",
    };
  }
  return { ok: true };
}

export function normalizeSpeechText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > MAX_SPEECH_INPUT_CHARS) {
    return text.slice(0, MAX_SPEECH_INPUT_CHARS);
  }
  return text;
}

export async function synthesizeOpenAiSpeech(params: {
  text: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  speed?: number;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const apiKey = params.apiKey?.trim() || getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ontbreekt voor spraaksynthese.");
  }

  const model = params.model ?? getSpeechModel();
  const voice = params.voice ?? getSpeechVoice();
  const fetchImpl = params.fetchImpl ?? fetch;

  const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: params.text,
      response_format: "mp3",
      instructions: params.instructions ?? getSpeechInstructions(),
      speed: params.speed ?? getSpeechSpeed(),
    }),
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
    };
    const message =
      json.error?.message?.trim() ||
      json.message?.trim() ||
      "Kon OpenAI-spraak niet genereren.";
    throw new Error(message);
  }

  return Buffer.from(await response.arrayBuffer());
}
