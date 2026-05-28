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

/** @type {Map<string, { blob?: Blob; promise?: Promise<Blob> }>} */
const speechBlobCache = new Map();

/**
 * @param {string} text
 * @returns {Promise<Blob>}
 */
export function prefetchOpenAiSpeech(text) {
  const key = text.replace(/\s+/g, " ").trim();
  if (!key) return Promise.reject(new Error("Lege tekst."));
  const cached = speechBlobCache.get(key);
  if (cached?.blob) return Promise.resolve(cached.blob);
  if (cached?.promise) return cached.promise;

  const promise = fetchOpenAiSpeechBlob(key)
    .then((blob) => {
      speechBlobCache.set(key, { blob });
      return blob;
    })
    .catch((err) => {
      speechBlobCache.delete(key);
      throw err;
    });
  speechBlobCache.set(key, { promise });
  return promise;
}

/**
 * @param {string} text
 * @returns {Promise<Blob>}
 */
async function loadSpeechBlob(text) {
  return prefetchOpenAiSpeech(text);
}

/**
 * @typedef {{
 *   onStatus?: (message: string) => void;
 *   onError?: (message: string) => void;
 *   onTtsActive?: (active: boolean) => void;
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
  /** @type {(() => void) | null} */
  let playOneResolve = null;
  let skipNextIndexAdvance = false;

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

  const stopPlayback = () => {
    cancelled = true;
    active = false;
    paused = false;
    setTtsActive(false);
    cleanupAudio();
    chunks = [];
    index = 0;
  };

  const waitWhilePaused = async () => {
    while (paused && active && !cancelled) {
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const prefetchAhead = (fromIndex) => {
    if (chunks[fromIndex]) void prefetchOpenAiSpeech(chunks[fromIndex]);
    if (chunks[fromIndex + 1]) void prefetchOpenAiSpeech(chunks[fromIndex + 1]);
  };

  const setTtsActive = (active) => options.onTtsActive?.(active);

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

      playOneResolve = resolve;
      setTtsActive(true);

      loadSpeechBlob(text)
        .then((blob) => {
          if (cancelled) {
            playOneResolve = null;
            setTtsActive(false);
            resolve();
            return;
          }
          blobUrl = URL.createObjectURL(blob);
          audio = new Audio(blobUrl);
          audio.onended = () => {
            cleanupAudio();
            playOneResolve = null;
            setTtsActive(false);
            resolve();
          };
          audio.onerror = () => {
            cleanupAudio();
            playOneResolve = null;
            setTtsActive(false);
            reject(new Error("Kon audio niet afspelen."));
          };
          void audio.play().catch((err) => {
            cleanupAudio();
            playOneResolve = null;
            setTtsActive(false);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        })
        .catch((err) => {
          playOneResolve = null;
          setTtsActive(false);
          reject(err);
        });
    });

  /**
   * @param {string[]} newChunks
   * @param {number} newIndex
   */
  function syncChunks(newChunks, newIndex) {
    chunks = newChunks.filter((c) => c.trim());
    index = Math.max(0, Math.min(newIndex, Math.max(0, chunks.length - 1)));
    prefetchAhead(index);
  }

  /**
   * Hervat na inline correctie zonder de afspeel-lus te beëindigen.
   * @param {string[]} newChunks
   * @param {number} newIndex
   */
  function resumeAfterCorrection(newChunks, newIndex) {
    if (!active) return false;
    cancelled = false;
    syncChunks(newChunks, newIndex);
    cleanupAudio();
    setTtsActive(false);
    if (playOneResolve) {
      const done = playOneResolve;
      playOneResolve = null;
      skipNextIndexAdvance = true;
      done();
    }
    paused = false;
    setStatus(`Voorlezen… (${index + 1}/${chunks.length})`);
    return true;
  }

  /**
   * @param {string[]} textChunks
   * @param {number} [startIndex]
   * @param {{
   *   onProgress?: (index: number) => void;
   * }} [hooks]
   */
  async function playFrom(textChunks, startIndex = 0, hooks = {}) {
    stopPlayback();
    chunks = textChunks.filter((c) => c.trim());
    if (!chunks.length) {
      throw new Error("Geen tekst om voor te lezen.");
    }

    index = Math.max(0, Math.min(startIndex, chunks.length - 1));
    active = true;
    cancelled = false;
    paused = false;
    prefetchAhead(index);

    try {
      while (active && !cancelled && index < chunks.length) {
        await waitWhilePaused();
        if (cancelled) break;

        hooks.onProgress?.(index);
        setStatus(`Voorlezen… (${index + 1}/${chunks.length})`);
        prefetchAhead(index + 1);
        const chunkIndex = index;
        await playOne(chunks[index]);
        if (cancelled) break;
        if (skipNextIndexAdvance) {
          skipNextIndexAdvance = false;
        } else if (index === chunkIndex) {
          index++;
        }
      }

      if (!cancelled && index >= chunks.length) {
        setStatus("Voorlezen klaar.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voorlezen mislukt.";
      options.onError?.(message);
      throw err;
    } finally {
      active = false;
      paused = false;
      cleanupAudio();
    }
  }

  return {
    isActive: () => active,
    isPaused: () => paused,

    pause() {
      if (!active || paused) return;
      paused = true;
      audio?.pause();
      setTtsActive(false);
      setStatus("Gepauzeerd.");
    },

    resume() {
      if (!active || !paused) return;
      paused = false;
      if (audio) {
        setTtsActive(true);
        void audio.play();
      }
      setStatus(`Voorlezen… (${index + 1}/${chunks.length})`);
    },

    stop() {
      stopPlayback();
      setStatus("");
    },

    getCurrentIndex: () => index,

    syncChunks,
    resumeAfterCorrection,

    playFrom,

    /**
     * @param {string[]} textChunks
     */
    async playAll(textChunks) {
      await playFrom(textChunks, 0);
    },
  };
}
