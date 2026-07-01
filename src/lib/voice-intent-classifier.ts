import { createJsonCompletion } from "./llm.js";

export const VOICE_INTENT_IDS = [
  "READ_REPORT",
  "CREATE_TASK",
  "CREATE_EVENT",
  "CORRECTION",
  "STOP",
  "UNKNOWN",
] as const;

export type VoiceIntentId = (typeof VOICE_INTENT_IDS)[number];

export type VoiceIntentResult = {
  intent: VoiceIntentId;
  confidence: number;
  remainder: string;
};

const VOICE_INTENT_SYSTEM = `Je classificeert korte spraakcommando's voor MegaMinnie (Nederlands bezoekverslag).
De gebruiker heeft al "Ok Minnie" gezegd; je krijgt alleen het commando.

Antwoord uitsluitend als JSON-object met exact deze keys:
- "intent": string — één van READ_REPORT, CREATE_TASK, CREATE_EVENT, CORRECTION, STOP, UNKNOWN
- "confidence": number tussen 0 en 1
- "remainder": string — resttekst voor taak/agenda/correctie (leeg string indien niet van toepassing)

Intent-regels:
- READ_REPORT: voorlezen van het uitgewerkte verslag (alle formuleringen, bijv. "lees het uitgewerkte verslag voor", "kun je dit voorlezen")
- CREATE_TASK: taak of to-do aanmaken
- CREATE_EVENT: agenda-item of afspraak aanmaken
- CORRECTION: correctie op het verslag
- STOP: stoppen met voorlezen
- UNKNOWN: geen duidelijk commando

Zet in remainder alles wat ná het commando-werkwoord hoort (taakomschrijving, correctietekst, etc.).`;

/** @param {unknown} value */
export function normalizeVoiceIntentResult(value: unknown): VoiceIntentResult {
  const fallback: VoiceIntentResult = { intent: "UNKNOWN", confidence: 0, remainder: "" };
  if (!value || typeof value !== "object") return fallback;

  const raw = value as Record<string, unknown>;
  const intentRaw = typeof raw.intent === "string" ? raw.intent.trim().toUpperCase() : "";
  const intent = VOICE_INTENT_IDS.includes(intentRaw as VoiceIntentId)
    ? (intentRaw as VoiceIntentId)
    : "UNKNOWN";

  let confidence = typeof raw.confidence === "number" ? raw.confidence : Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const remainder =
    typeof raw.remainder === "string" ? raw.remainder.replace(/\s+/g, " ").trim() : "";

  return { intent, confidence, remainder };
}

/** Minimale confidence om een LLM-intent te vertrouwen. */
export const VOICE_INTENT_MIN_CONFIDENCE = 0.55;

export function isActionableVoiceIntent(result: VoiceIntentResult): boolean {
  return result.intent !== "UNKNOWN" && result.confidence >= VOICE_INTENT_MIN_CONFIDENCE;
}

/** @param {string} transcript */
export async function classifyVoiceIntent(transcript: string): Promise<VoiceIntentResult> {
  const text = String(transcript || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return { intent: "UNKNOWN", confidence: 0, remainder: "" };
  }

  const user = `Classificeer dit spraakcommando:\n"""${text}"""`;
  const rawJson = await createJsonCompletion(VOICE_INTENT_SYSTEM, user);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { intent: "UNKNOWN", confidence: 0, remainder: "" };
  }
  const normalized = normalizeVoiceIntentResult(parsed);
  if (normalized.intent !== "UNKNOWN" && !normalized.remainder) {
    normalized.remainder = extractRemainderHeuristic(text, normalized.intent);
  }
  return normalized;
}

/** @param {string} text @param {VoiceIntentId} intent */
function extractRemainderHeuristic(text: string, intent: VoiceIntentId): string {
  const lower = text.toLowerCase();
  const prefixes = [
    "lees het uitgewerkte verslag voor",
    "lees het verslag voor",
    "lees het uitgewerkte verslag",
    "maak een taak aan",
    "maak een agenda aan",
    "maak taak",
    "maak agenda",
    "correctie",
    "stop",
  ];
  if (intent === "READ_REPORT" || intent === "STOP") return "";
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return text.slice(prefix.length).replace(/^[\s,.:;!?-]+/, "").trim();
    }
  }
  return "";
}
