export const DEFAULT_REALTIME_MODEL = "gpt-realtime-mini";
export const DEFAULT_REALTIME_VOICE = "verse";
export const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

export const REALTIME_QA_STOP_RESPONSE_TEXT =
  "Oké, dank je wel. Ik ga het verslag nu uitwerken.";

export const REALTIME_POC_INSTRUCTIONS =
  "Je bent MegaMinnie, een Nederlandstalige sales assistent. Begin elk gesprek met precies het woord 'Hallo' en wacht op antwoord. " +
  "Voer daarna een kort vraag-en-antwoordgesprek over een klantbezoek. Stel gerichte vragen over met wie is gesproken, het doel, besproken punten en vervolgstappen. " +
  "Reageer kort en natuurlijk. " +
  `Als de gebruiker 'stop' of 'stoppen' zegt, zeg exact: '${REALTIME_QA_STOP_RESPONSE_TEXT}' en wacht af. ` +
  "Als de gebruiker 'annuleer' of 'annuleren' zegt, bevestig kort dat het gesprek is afgebroken en wacht af.";

/** Korte stijl voor onderbrekingen tijdens voorlezen — niet van toepassing op Vraag & Antwoord. */
const PLAYBACK_CAPTURE_BRIEF_STYLE =
  "Dit is een korte onderbreking tijdens voorlezen — geen interview. " +
  "Maximaal één verduidelijkingsvraag als iets echt onduidelijk is. " +
  "Herhaal niet wat de gebruiker al zei. Geen veld-voor-veld vragenlijst. " +
  "Antwoorden: maximaal één korte zin. " +
  "Als de gebruiker klaar is of 'klaar'/'ja' zegt, vraag exact: " +
  "'Ben je klaar? Zal ik verder gaan met voorlezen?'";

export const SUPPLEMENT_REALTIME_INSTRUCTIONS =
  `${PLAYBACK_CAPTURE_BRIEF_STYLE} ` +
  "Je helpt de gebruiker mondeling een correctie door te geven op een voorgelezen klantverslag. " +
  "Accepteer de correctie zoals gegeven; vraag alleen door bij echte onduidelijkheid.";

export const TASK_CAPTURE_REALTIME_INSTRUCTIONS =
  `${PLAYBACK_CAPTURE_BRIEF_STYLE} ` +
  "Je helpt een taak in Salesforce aan te maken tijdens voorlezen. " +
  "Verzamel minimaal onderwerp (subject) en uiterste datum (activityDate); overige velden optioneel. " +
  "Vraag ontbrekende kerngegevens in één korte vraag, niet veld voor veld. " +
  "Verzin geen details die de gebruiker niet noemde.";

export const EVENT_CAPTURE_REALTIME_INSTRUCTIONS =
  `${PLAYBACK_CAPTURE_BRIEF_STYLE} ` +
  "Je helpt een agenda-item in Salesforce aan te maken tijdens voorlezen. " +
  "Verzamel minimaal onderwerp (subject), datum, starttijd en eindtijd; beschrijving optioneel. " +
  "Vraag ontbrekende kerngegevens in één korte vraag, niet veld voor veld. " +
  "Verzin geen details die de gebruiker niet noemde.";

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

export function getSupplementRealtimeInstructions(): string {
  return (
    process.env.OPENAI_SUPPLEMENT_REALTIME_INSTRUCTIONS?.trim() ||
    SUPPLEMENT_REALTIME_INSTRUCTIONS
  );
}

export function getTaskCaptureRealtimeInstructions(): string {
  return (
    process.env.OPENAI_TASK_CAPTURE_REALTIME_INSTRUCTIONS?.trim() ||
    TASK_CAPTURE_REALTIME_INSTRUCTIONS
  );
}

export function getEventCaptureRealtimeInstructions(): string {
  return (
    process.env.OPENAI_EVENT_CAPTURE_REALTIME_INSTRUCTIONS?.trim() ||
    EVENT_CAPTURE_REALTIME_INSTRUCTIONS
  );
}

export const LISTEN_REALTIME_INSTRUCTIONS =
  "Je bent een stille luisteraar. Transcribeer alleen wat de gebruiker zegt — genereer geen antwoorden en geef geen commentaar. " +
  "Wacht rustig op spraak en verwerk die zodra je die ontvangt.";

export function getListenRealtimeInstructions(): string {
  return (
    process.env.OPENAI_LISTEN_REALTIME_INSTRUCTIONS?.trim() ||
    LISTEN_REALTIME_INSTRUCTIONS
  );
}

export const REVIEW_REALTIME_INSTRUCTIONS =
  "Je bent een nauwkeurige voorlezer van Nederlandstalige klantverslagen. " +
  "Wanneer je tekst ontvangt om voor te lezen, spreek je die precies uit — woord voor woord, zonder toevoegingen of commentaar. " +
  "Lees in een rustig, duidelijk tempo. " +
  "Je reageert niet spontaan op geluiden of spraak van de gebruiker; je wacht op expliciete tekst om voor te lezen. " +
  "Als de gebruiker je onderbreekt, stop je direct en wacht je.";

export function getReviewRealtimeInstructions(): string {
  return (
    process.env.OPENAI_REVIEW_REALTIME_INSTRUCTIONS?.trim() ||
    REVIEW_REALTIME_INSTRUCTIONS
  );
}

export function getOpenAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || "";
}
