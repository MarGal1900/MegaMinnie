/**
 * Pure helpers voor inline review-correctie state machine (testbaar zonder DOM).
 */

/** Stilte na correctie met inhoud voordat voorlezen hervat. */
export const INLINE_CORRECTION_RESUME_MS = 3000;
/** Stilte na valse lege correctie (alleen commando, geen tekst). */
export const INLINE_CORRECTION_EMPTY_RESUME_MS = 1200;

/**
 * @param {{ segmentsLength: number; enteredViaCommand: boolean }} ctx
 * @returns {number}
 */
export function resolveInlineCorrectionResumeDelay({ segmentsLength, enteredViaCommand }) {
  return segmentsLength > 0 || enteredViaCommand
    ? INLINE_CORRECTION_RESUME_MS
    : INLINE_CORRECTION_EMPTY_RESUME_MS;
}

/** @param {"correctie"|"voorlezen"|"stop"|"maak_taak"|"maak_agenda"|null} cmd */
export function isReviewPlaybackStopCommand(cmd) {
  return cmd === "stop";
}

/** @param {"correctie"|"voorlezen"|"stop"|"maak_taak"|"maak_agenda"|null} cmd */
export function isInlineCaptureVoiceCommand(cmd) {
  return cmd === "correctie" || cmd === "maak_taak" || cmd === "maak_agenda";
}

/** @typedef {"correction"|"task"|"event"} InlineCaptureIntent */

/** @param {InlineCaptureIntent} intent */
export function resolveInlineCaptureSupplementSource(intent) {
  if (intent === "task") return "task";
  if (intent === "event") return "event";
  return "correction";
}

/** @param {"maak_taak"|"maak_agenda"|"correctie"|"voorlezen"|"stop"|null} cmd */
export function resolveInlineCaptureIntent(cmd) {
  if (cmd === "maak_taak") return "task";
  if (cmd === "maak_agenda") return "event";
  if (cmd === "correctie") return "correction";
  return null;
}

/** @param {InlineCaptureIntent} intent @param {boolean} [hasSegments=false] */
export function getInlineCaptureStatusMessage(intent, hasSegments = false) {
  if (intent === "task") {
    return hasSegments
      ? 'Taak bijgewerkt — spreek verder of zeg "Voorlezen"'
      : "Maak taak — spreek de taak in…";
  }
  if (intent === "event") {
    return hasSegments
      ? 'Agenda bijgewerkt — spreek verder of zeg "Voorlezen"'
      : "Maak agenda — spreek het agenda-item in…";
  }
  return hasSegments
    ? 'Tekst bijgewerkt — spreek verder of zeg "Voorlezen"'
    : "Corrigeren — spreek je aanpassing in…";
}

/** @param {InlineCaptureIntent} intent */
export function getInlineCaptureProcessingStatus(intent) {
  if (intent === "task") return "Taak verwerken…";
  if (intent === "event") return "Agenda-item verwerken…";
  return "Correctie verwerken…";
}

/** @param {InlineCaptureIntent} intent */
export function getInlineCaptureFailureStatus(intent) {
  if (intent === "task") {
    return 'Taak mislukt — spreek opnieuw of zeg "Voorlezen"';
  }
  if (intent === "event") {
    return 'Agenda-item mislukt — spreek opnieuw of zeg "Voorlezen"';
  }
  return 'Correctie mislukt — spreek opnieuw of zeg "Voorlezen"';
}

/** @param {{ active: boolean; flushedSegmentCount: number; applyInFlight: boolean; finalizeInFlight: boolean }} state */
export function shouldStartNewCorrectionRound(state) {
  return (
    state.active &&
    state.flushedSegmentCount > 0 &&
    !state.applyInFlight &&
    !state.finalizeInFlight
  );
}

/** @param {{ active: boolean; flushedSegmentCount: number; resumeTimer: unknown; applyInFlight: boolean; correctionUserSpeaking: boolean }} state */
export function shouldIgnoreCorrectionSpeech(state) {
  return (
    state.active &&
    state.flushedSegmentCount > 0 &&
    Boolean(state.resumeTimer) &&
    !state.applyInFlight &&
    !state.correctionUserSpeaking
  );
}

/**
 * Gebruiker hervat of verlengt een correctie — auto-hervatting moet worden uitgesteld.
 * @param {{ active: boolean; resumeTimer: unknown; finalizeInFlight: boolean }} state
 * @param {boolean} isLikelyEcho
 */
export function shouldCancelCorrectionResumeForUserSpeech(state, isLikelyEcho) {
  return state.active && Boolean(state.resumeTimer) && !state.finalizeInFlight && !isLikelyEcho;
}

/**
 * Voorkom dat lege speech_stopped-events de stiltetimer opnieuw starten.
 * @param {{ flushedSegmentCount: number; resumeTimer: unknown }} state
 */
export function shouldSkipEmptyCorrectionResumeReschedule(state) {
  return state.flushedSegmentCount > 0 && Boolean(state.resumeTimer);
}

/**
 * @param {"correctie"|"voorlezen"|"stop"|"maak_taak"|"maak_agenda"|null} cmd
 * @param {boolean} alreadyPending
 */
export function shouldQueueCorrectieDuringFinalize(cmd, alreadyPending) {
  return cmd === "correctie" && !alreadyPending;
}

/** @param {{ correctionUserSpeaking: boolean }} state */
export function shouldDeferCorrectionResume(state) {
  return state.correctionUserSpeaking;
}

/**
 * @param {{ active: boolean; ttsActive: boolean; finalizeInFlight: boolean }} ctx
 */
export function shouldPauseCorrectionResumeOnSpeechStart(ctx) {
  return ctx.active && !ctx.ttsActive && !ctx.finalizeInFlight;
}
