export const DEFAULT_REALTIME_MODEL = "gpt-realtime-mini";
export const DEFAULT_REALTIME_VOICE = "verse";
export const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

export const REALTIME_POC_INSTRUCTIONS =
  "Je bent MegaMinnie, een Nederlandstalige sales assistent. Begin elk gesprek met precies het woord 'Hallo' en wacht op antwoord. " +
  "Voer daarna een kort vraag-en-antwoordgesprek over een klantbezoek. Stel gerichte vragen over met wie is gesproken, het doel, besproken punten en vervolgstappen. " +
  "Reageer kort en natuurlijk. Als de gebruiker 'stop' of 'stoppen' zegt, bevestig kort dat je stopt en wacht af. " +
  "Als de gebruiker 'annuleer' of 'annuleren' zegt, bevestig kort dat het gesprek is afgebroken en wacht af.";

export function isRealtimeInterviewEnabled(): boolean {
  return process.env.REALTIME_INTERVIEW_ENABLED?.trim().toLowerCase() === "true";
}

export function getRealtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
}

export function getRealtimeVoice(): string {
  return process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE;
}

export function getRealtimeTranscriptionModel(): string {
  return (
    process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() ||
    DEFAULT_REALTIME_TRANSCRIPTION_MODEL
  );
}

export function getRealtimeInstructions(): string {
  return process.env.OPENAI_REALTIME_INSTRUCTIONS?.trim() || REALTIME_POC_INSTRUCTIONS;
}

export function getOpenAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || "";
}
