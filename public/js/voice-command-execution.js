/**
 * Serialiseert async spraakcommando-uitvoering; coalesceert naar laatste tekst tijdens busy.
 */

/** @returns {{ begin(text: string): "run"|"queue"|"skip"; finish(): string | null }} */
export function createVoiceCommandExecutionGate() {
  let inFlight = false;
  /** @type {string | null} */
  let queuedText = null;

  return {
    /** @param {string} text */
    begin(text) {
      const trimmed = String(text || "").replace(/\s+/g, " ").trim();
      if (!trimmed) return "skip";
      if (inFlight) {
        queuedText = trimmed;
        return "queue";
      }
      inFlight = true;
      queuedText = null;
      return "run";
    },
    finish() {
      inFlight = false;
      const next = queuedText;
      queuedText = null;
      return next;
    },
    isRunning() {
      return inFlight;
    },
  };
}

/**
 * Alleen dedupliceren als wake/commando-flow echt actief is (niet na mislukte poging).
 * @param {string} lastKey
 * @param {number} lastAt
 * @param {string} currentKey
 * @param {boolean} flowActive
 * @param {number} [windowMs]
 */
export function shouldTreatDuplicateWakeAsHandled(
  lastKey,
  lastAt,
  currentKey,
  flowActive,
  windowMs = 1200,
) {
  if (!currentKey || currentKey !== lastKey) return false;
  if (Date.now() - lastAt >= windowMs) return false;
  return flowActive;
}
