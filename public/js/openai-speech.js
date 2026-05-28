/**
 * Voorlezen via OpenAI Speech API (zelfde stem/config als realtime interview).
 */

import { apiPostBlob } from "./api.js";

/**
 * @param {string} text
 * @returns {Promise<Blob>}
 */
export async function fetchOpenAiSpeechBlob(text) {
  return apiPostBlob("/api/realtime/speech", { text });
}

/**
 * @typedef {{
 *   onStatus?: (message: string) => void;
 *   onError?: (message: string) => void;
 * }} OpenAiSpeechPlaybackOptions
 */

/**
 * @param {OpenAiSpeechPlaybackOptions} options
 */
export function createOpenAiSpeechPlayback(options = {}) {
  /** @type {HTMLAudioElement | null} */
  let audio = null;
  /** @type {string | null} */
  let blobUrl = null;
  let active = false;
  let paused = false;
  let cancelled = false;
  /** @type {string[]} */
  let chunks = [];
  let index = 0;

  const setStatus = (message) => options.onStatus?.(message);

  const cleanupAudio = () => {
    if (audio) {
      try {
        audio.pause();
        audio.src = "";
      } catch {
        /* noop */
      }
      audio = null;
    }
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
  };

  const stop = () => {
    cancelled = true;
    active = false;
    paused = false;
    cleanupAudio();
    chunks = [];
    index = 0;
  };

  /**
   * @param {string} text
   * @returns {Promise<void>}
   */
  const playOne = (text) =>
    new Promise((resolve, reject) => {
      cleanupAudio();
      if (cancelled) {
        resolve();
        return;
      }

      fetchOpenAiSpeechBlob(text)
        .then((blob) => {
          if (cancelled) {
            resolve();
            return;
          }
          blobUrl = URL.createObjectURL(blob);
          audio = new Audio(blobUrl);
          audio.onended = () => {
            cleanupAudio();
            resolve();
          };
          audio.onerror = () => {
            cleanupAudio();
            reject(new Error("Kon audio niet afspelen."));
          };
          void audio.play().catch((err) => {
            cleanupAudio();
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        })
        .catch(reject);
    });

  return {
    isActive: () => active,
    isPaused: () => paused,

    pause() {
      if (!active || paused) return;
      paused = true;
      audio?.pause();
      setStatus("Gepauzeerd.");
    },

    resume() {
      if (!active || !paused) return;
      paused = false;
      void audio?.play();
    },

    stop() {
      stop();
      setStatus("");
    },

    /**
     * @param {string[]} textChunks
     */
    async playAll(textChunks) {
      stop();
      chunks = textChunks.filter((c) => c.trim());
      if (!chunks.length) {
        throw new Error("Geen tekst om voor te lezen.");
      }

      active = true;
      cancelled = false;
      paused = false;
      index = 0;

      try {
        while (active && !cancelled && index < chunks.length) {
          if (paused) {
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          setStatus(`Voorlezen… (${index + 1}/${chunks.length})`);
          await playOne(chunks[index]);
          if (cancelled) break;
          index++;
        }

        if (!cancelled && index >= chunks.length) {
          setStatus("Voorlezen klaar.");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Voorlezen mislukt.";
        options.onError?.(message);
        throw err;
      } finally {
        active = false;
        paused = false;
        cleanupAudio();
      }
    },
  };
}
