/**
 * Centrale router voor spraakcommando's (fase 1: push-to-talk).
 */

import {
  detectReviewVoiceCommand,
  isOkMegaMinnieWakeOnly,
  isReviewCorrectieCommand,
  isStartVoorlezenCommand,
  stripRepeatedOkMegaMinnieWakePrefixes,
  stripReviewVoiceCommand,
} from "./interview-commands.js";
import { isInlineCaptureVoiceCommand } from "./review-inline-correction.js";

/** Minimale confidence om LLM-intent te vertrouwen (sync met backend). */
export const VOICE_INTENT_MIN_CONFIDENCE = 0.55;

/**
 * @typedef {"READ_REPORT"|"CREATE_TASK"|"CREATE_EVENT"|"CORRECTION"|"STOP"|"UNKNOWN"} VoiceIntentId
 * @typedef {{ intent: VoiceIntentId; confidence: number; remainder?: string }} VoiceIntentClassification
 */

/**
 * @param {VoiceIntentClassification | null | undefined} llmIntent
 * @returns {boolean}
 */
export function isActionableVoiceIntent(llmIntent) {
  if (!llmIntent) return false;
  const intent = String(llmIntent.intent || "UNKNOWN").toUpperCase();
  const confidence = Number(llmIntent.confidence ?? 0);
  return intent !== "UNKNOWN" && Number.isFinite(confidence) && confidence >= VOICE_INTENT_MIN_CONFIDENCE;
}

/**
 * @param {VoiceIntentClassification} llmIntent
 * @param {boolean} playbackActive
 */
export function mapVoiceIntentToPlan(llmIntent, playbackActive) {
  const intent = String(llmIntent.intent || "UNKNOWN").toUpperCase();
  const remainder = String(llmIntent.remainder || "").replace(/\s+/g, " ").trim();
  const empty = {
    action: null,
    requiresPlayback: false,
    autoStartPlayback: false,
    remainder: "",
    wakeOnly: false,
  };

  if (!isActionableVoiceIntent(llmIntent)) return empty;

  if (intent === "READ_REPORT") {
    return {
      action: playbackActive ? "resume_voorlezen" : "start_voorlezen",
      requiresPlayback: false,
      autoStartPlayback: !playbackActive,
      remainder: "",
      wakeOnly: false,
    };
  }

  if (intent === "CREATE_TASK") {
    return {
      action: "maak_taak",
      requiresPlayback: true,
      autoStartPlayback: !playbackActive,
      remainder,
      wakeOnly: false,
    };
  }

  if (intent === "CREATE_EVENT") {
    return {
      action: "maak_agenda",
      requiresPlayback: true,
      autoStartPlayback: !playbackActive,
      remainder,
      wakeOnly: false,
    };
  }

  if (intent === "CORRECTION") {
    return {
      action: "correctie",
      requiresPlayback: true,
      autoStartPlayback: !playbackActive,
      remainder,
      wakeOnly: false,
    };
  }

  if (intent === "STOP") {
    return {
      action: "stop",
      requiresPlayback: true,
      autoStartPlayback: false,
      remainder,
      wakeOnly: false,
    };
  }

  return empty;
}

/**
 * @typedef {"start_voorlezen"|"resume_voorlezen"|"stop"|"maak_taak"|"maak_agenda"|"correctie"} VoiceCommandAction
 */

/**
 * @param {{ text: string; playbackActive: boolean; llmIntent?: VoiceIntentClassification | null }} ctx
 * @returns {{
 *   action: VoiceCommandAction | null;
 *   requiresPlayback: boolean;
 *   autoStartPlayback: boolean;
 *   remainder: string;
 * }}
 */
export function resolveVoiceCommandPlan({ text, playbackActive, llmIntent = null }) {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      action: null,
      requiresPlayback: false,
      autoStartPlayback: false,
      remainder: "",
      wakeOnly: false,
    };
  }

  if (isOkMegaMinnieWakeOnly(raw)) {
    return {
      action: null,
      requiresPlayback: false,
      autoStartPlayback: false,
      remainder: "",
      wakeOnly: true,
    };
  }

  // Tijdens voorlezen: puur "Correctie" start direct luisteren (geen Ok Minnie-wake).
  if (playbackActive && isReviewCorrectieCommand(raw)) {
    return {
      action: "correctie",
      requiresPlayback: true,
      autoStartPlayback: false,
      remainder: "",
      wakeOnly: false,
    };
  }

  // stripRepeatedOkMegaMinnieWakePrefixes (i.p.v. één keer strippen) vangt ongeduldig
  // herhaalde wake-pogingen binnen één opgevangen uiting, bijv. "Ok Minnie. Ok Minnie.",
  // die anders als onherkend "commando" zouden eindigen in plaats van als hernieuwde wake.
  const effectiveText = stripRepeatedOkMegaMinnieWakePrefixes(raw);
  if (!effectiveText) {
    return {
      action: null,
      requiresPlayback: false,
      autoStartPlayback: false,
      remainder: "",
      wakeOnly: true,
    };
  }

  if (isStartVoorlezenCommand(effectiveText)) {
    return {
      action: playbackActive ? "resume_voorlezen" : "start_voorlezen",
      requiresPlayback: false,
      autoStartPlayback: !playbackActive,
      remainder: "",
      wakeOnly: false,
    };
  }

  const cmd = detectReviewVoiceCommand(effectiveText);
  if (!cmd) {
    if (isActionableVoiceIntent(llmIntent)) {
      return mapVoiceIntentToPlan(llmIntent, playbackActive);
    }
    return {
      action: null,
      requiresPlayback: false,
      autoStartPlayback: false,
      remainder: "",
      wakeOnly: false,
    };
  }

  const remainder = isActionableVoiceIntent(llmIntent)
    ? String(llmIntent.remainder || "").replace(/\s+/g, " ").trim() ||
      stripReviewVoiceCommand(effectiveText).replace(/\s+/g, " ").trim()
    : stripReviewVoiceCommand(effectiveText).replace(/\s+/g, " ").trim();

  if (cmd === "voorlezen") {
    return {
      action: playbackActive ? "resume_voorlezen" : "start_voorlezen",
      requiresPlayback: false,
      autoStartPlayback: !playbackActive,
      remainder: "",
      wakeOnly: false,
    };
  }

  if (cmd === "stop") {
    return {
      action: "stop",
      requiresPlayback: true,
      autoStartPlayback: false,
      remainder,
      wakeOnly: false,
    };
  }

  if (isInlineCaptureVoiceCommand(cmd)) {
    return {
      action: cmd,
      requiresPlayback: true,
      autoStartPlayback: !playbackActive,
      remainder,
      wakeOnly: false,
    };
  }

  return {
    action: null,
    requiresPlayback: false,
    autoStartPlayback: false,
    remainder: "",
    wakeOnly: false,
  };
}

/** @param {VoiceCommandAction | null} action */
export function getVoiceCommandFailureMessage(action) {
  if (action === "stop") return "Voorlezen is niet actief.";
  if (isInlineCaptureVoiceCommand(action)) {
    return "Start eerst met Voorlezen, of spreek het commando opnieuw in.";
  }
  return "Commando niet herkend.";
}

export function getVoiceCommandUnrecognizedMessage() {
  return 'Commando niet herkend. Probeer bijv.: "Lees het verslag voor", "Maak een taak aan", "Maak een agenda aan", "Correctie" of "Stop".';
}

export function getVoiceCommandWakePromptMessage() {
  return 'Zeg "Ok MegaMinnie", "Ok Minnie" of "Correctie" om een spraakcommando te geven.';
}

export const VOICE_COMMAND_WAKE_ACK_SPEECH = "Wat kan ik voor je doen?";

export function getVoiceCommandWakeAckSpeechText() {
  return VOICE_COMMAND_WAKE_ACK_SPEECH;
}

export function getVoiceCommandAwaitingMessage() {
  return "Ik luister…";
}
