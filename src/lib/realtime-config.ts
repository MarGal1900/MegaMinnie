export const DEFAULT_REALTIME_MODEL = "gpt-realtime-mini";
export const DEFAULT_REALTIME_VOICE = "verse";

export const REALTIME_POC_INSTRUCTIONS =
  "Je bent een Nederlandstalige sales assistent. Je voert een kort testgesprek na een klantmeeting. " +
  "Stel eerst één vraag: 'Vertel kort met wie je hebt gesproken en wat het doel van het gesprek was.' " +
  "Luister naar het antwoord. Reageer kort en natuurlijk. Stel maximaal één korte vervolgvraag als iets onduidelijk is. " +
  "Houd het gesprek compact. Dit is een realtime proof of concept, geen definitief verslag.";

export function isRealtimeInterviewEnabled(): boolean {
  return process.env.REALTIME_INTERVIEW_ENABLED?.trim().toLowerCase() === "true";
}

export function getRealtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
}

export function getRealtimeVoice(): string {
  return process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE;
}

export function getRealtimeInstructions(): string {
  return process.env.OPENAI_REALTIME_INSTRUCTIONS?.trim() || REALTIME_POC_INSTRUCTIONS;
}

export function getOpenAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || "";
}
