/**
 * Realtime voice-to-voice voorlezer — gebruikt één OpenAI Realtime WebRTC sessie
 * voor zowel TTS-output (model leest voor) als STT-input (gebruiker kan corrigeren).
 *
 * Implementeert dezelfde interface als createOpenAiSpeechPlayback zodat de rest
 * van app.js grotendeels onveranderd blijft.
 */

import { createRealtimeInterviewController } from "./realtime-interview.js";
import {
  buildMicrophoneConstraints,
  requestMicrophoneStream,
  stopMediaStream,
} from "./media-permissions.js";

const CHUNK_TIMEOUT_MS = 120_000;

/**
 * @param {{
 *   sessionUrl?: string;
 *   onStatus?: (msg: string) => void;
 *   onError?: (msg: string) => void;
 *   onTtsActive?: (active: boolean) => void;
 *   onSpeechStarted?: () => void;
 *   onSpeechStopped?: (ctx: { pendingUserText: string; transcript: string }) => void;
 *   onSpeechStoppedEarly?: () => void;
 *   onTranscriptUpdate?: (transcript: string) => void;
 *   onTurn?: (turn: { role: "assistant"|"user"; text: string }) => void;
 *   onStateChange?: (s: { active: boolean; connecting: boolean }) => void;
 * }} options
 */
export function createRealtimeReviewPlayer(options = {}) {
  let active = false;
  let paused = false;
  let cancelled = false;
  /** @type {string[]} */
  let chunks = [];
  let index = 0;
  let skipNextIndexAdvance = false;
  /** @type {(() => void) | null} */
  let currentChunkResolve = null;
  /** @type {((err: Error) => void) | null} */
  let currentChunkReject = null;
  /** @type {MediaStream | null} */
  let micStream = null;

  const controller = createRealtimeInterviewController({
    sessionUrl: options.sessionUrl ?? "/api/realtime/session/review",
    setStatus: (msg) => { if (msg) options.onStatus?.(msg); },
    onError: (msg) => options.onError?.(msg),
    onStateChange: (s) => options.onStateChange?.(s),
    onSpeechStarted: () => options.onSpeechStarted?.(),
    onSpeechStoppedEarly: () => options.onSpeechStoppedEarly?.(),
    onSpeechStopped: (ctx) => options.onSpeechStopped?.(ctx),
    onTranscriptUpdate: (transcript) => options.onTranscriptUpdate?.(transcript),
    onTurn: (turn) => {
      options.onTurn?.(turn);
    },
    onResponseStarted: () => options.onTtsActive?.(true),
    onResponseDone: () => {
      options.onTtsActive?.(false);
      // Model heeft het huidige chunk volledig voorgelezen — ga door naar volgende.
      const resolve = currentChunkResolve;
      currentChunkResolve = null;
      currentChunkReject = null;
      resolve?.();
    },
  });

  const resolveCurrentChunk = () => {
    const resolve = currentChunkResolve;
    currentChunkResolve = null;
    currentChunkReject = null;
    resolve?.();
  };

  const rejectCurrentChunk = (err) => {
    const reject = currentChunkReject;
    currentChunkResolve = null;
    currentChunkReject = null;
    reject?.(err);
  };

  const speakChunk = (text) =>
    new Promise((resolve, reject) => {
      if (cancelled) { resolve(); return; }

      let timeoutId = setTimeout(() => {
        timeoutId = null;
        resolveCurrentChunk();
      }, CHUNK_TIMEOUT_MS);

      currentChunkResolve = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        resolve();
      };
      currentChunkReject = (err) => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        reject(err);
      };

      if (!controller.speakText(text)) {
        currentChunkResolve = null;
        currentChunkReject = null;
        reject(new Error("Geen actieve Realtime sessie."));
      }
    });

  /**
   * @param {string[]} textChunks
   * @param {number} [startIndex]
   * @param {{ onProgress?: (index: number) => void }} [hooks]
   */
  const playFrom = async (textChunks, startIndex = 0, hooks = {}) => {
    // Stop eventuele vorige sessie
    cancelled = true;
    active = false;
    rejectCurrentChunk(new Error("Stopped"));
    controller.stop("");
    if (micStream) { stopMediaStream(micStream); micStream = null; }

    chunks = textChunks.filter((c) => c.trim());
    if (!chunks.length) throw new Error("Geen tekst om voor te lezen.");

    index = Math.max(0, Math.min(startIndex, chunks.length - 1));
    active = true;
    cancelled = false;
    paused = false;
    skipNextIndexAdvance = false;

    try {
      micStream = await requestMicrophoneStream(buildMicrophoneConstraints());
    } catch (err) {
      active = false;
      throw err;
    }

    const started = await controller.start({
      listenOnly: false,
      passiveListen: false,
      skipOpeningGreeting: true,
      prefetchedStream: micStream,
    });

    if (!started || cancelled) {
      active = false;
      if (micStream) { stopMediaStream(micStream); micStream = null; }
      return;
    }

    options.onStatus?.(`Voorlezen…`);

    try {
      while (active && !cancelled && index < chunks.length) {
        // Wacht zolang gepauzeerd
        while (paused && active && !cancelled) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (cancelled) break;

        hooks.onProgress?.(index);
        options.onStatus?.(`Voorlezen… (${index + 1}/${chunks.length})`);

        const chunkIndexAtStart = index;

        try {
          await speakChunk(chunks[index]);
        } catch (err) {
          if (paused || err?.message === "Paused") {
            // Wacht op resume, dan dezelfde chunk opnieuw
            while (paused && active && !cancelled) {
              await new Promise((r) => setTimeout(r, 50));
            }
            continue;
          }
          if (cancelled || err?.message === "Stopped") break;
          throw err;
        }

        if (cancelled) break;

        if (skipNextIndexAdvance) {
          skipNextIndexAdvance = false;
        } else if (index === chunkIndexAtStart) {
          index++;
        }
      }

      if (!cancelled && index >= chunks.length) {
        options.onStatus?.("Voorlezen klaar.");
      } else if (cancelled) {
        options.onStatus?.("");
      }
    } catch (err) {
      if (!cancelled) {
        options.onStatus?.("Voorlezen gestopt.");
        options.onError?.(err instanceof Error ? err.message : "Voorlezen mislukt.");
        throw err;
      }
    } finally {
      active = false;
      paused = false;
      options.onTtsActive?.(false);
      controller.stop("");
      if (micStream) { stopMediaStream(micStream); micStream = null; }
    }
  };

  return {
    isActive: () => active,
    isPaused: () => paused,
    /** Retourneert true zodat isReviewInlineListening() werkt zonder aparte controller. */
    isListening: () => active,

    pause() {
      if (!active || paused) return;
      paused = true;
      controller.cancelResponse();
      rejectCurrentChunk(Object.assign(new Error("Paused"), { reason: "paused" }));
      options.onStatus?.("Gepauzeerd.");
      options.onTtsActive?.(false);
    },

    resume() {
      if (!active || !paused) return;
      paused = false;
      // De pause-wait loop in playFrom stopt vanzelf; chunk wordt opnieuw gestuurd.
    },

    stop() {
      cancelled = true;
      active = false;
      paused = false;
      rejectCurrentChunk(new Error("Stopped"));
      controller.stop("");
      if (micStream) { stopMediaStream(micStream); micStream = null; }
      options.onStatus?.("");
      options.onTtsActive?.(false);
    },

    getCurrentIndex: () => index,

    /**
     * Hervat voorlezen vanuit newIndex met nieuwe chunks (na een correctie).
     * Implementeert hetzelfde contract als createOpenAiSpeechPlayback.
     */
    resumeAfterCorrection(newChunks, newIndex) {
      if (!active) return false;
      cancelled = false;
      chunks = newChunks.filter((c) => c.trim());
      index = newIndex;
      skipNextIndexAdvance = true;
      paused = false;
      controller.cancelResponse();
      resolveCurrentChunk();
      options.onStatus?.(`Voorlezen… (${index + 1}/${chunks.length})`);
      return true;
    },

    syncChunks(newChunks, newIndex) {
      chunks = newChunks.filter((c) => c.trim());
      index = Math.max(0, Math.min(newIndex, Math.max(0, chunks.length - 1)));
    },

    playFrom,
    async playAll(textChunks) {
      await playFrom(textChunks, 0);
    },
  };
}
