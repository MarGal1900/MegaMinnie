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
 * Speelt één korte zin af via OpenAI Speech (zelfde stem als voorlezen).
 * @param {string} text
 * @param {{ playbackRate?: number }} [options]
 * @returns {Promise<void>}
 */
export async function playOpenAiSpeechOnce(text, options = {}) {
  const key = String(text || "").replace(/\s+/g, " ").trim();
  if (!key) throw new Error("Lege tekst.");
  const blob = await loadSpeechBlob(key);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = 1;
  audio.playbackRate = options.playbackRate ?? TTS_PLAYBACK_RATE;
  try {
    await playAudioElement(audio);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @typedef {{
 *   onStatus?: (message: string) => void;
 *   onError?: (message: string) => void;
 *   onTtsActive?: (active: boolean) => void;
 * }} OpenAiSpeechPlaybackOptions
 */

const TTS_POST_GRACE_MS = 900;
/**
 * Volume tijdens "ducking": zodra tijdens actief voorlezen spraak wordt gedetecteerd (VAD
 * speech_started), wordt het TTS-volume hierheen verlaagd in plaats van de playback volledig
 * te onderbreken. Zo krijgt de microfoon een veel schoner signaal van bijv. "Correctie" (minder
 * eigen-echo om doorheen te komen), zonder dat elke valse VAD-trigger (echo van de speaker
 * zelf) meteen een harde stop/hervat-cyclus veroorzaakt — dat laatste zou voorlezen laten
 * stotteren. Bij een carkit/losse speaker zonder goede akoestische echo-onderdrukking is dit
 * de veiligste tussenweg tussen "nooit onderbreken" (huidig gedrag, vereist vaak herhalen) en
 * "altijd volledig pauzeren" (risico op constant onderbroken voorlezen).
 */
const TTS_DUCK_VOLUME = 0.12;
/** Iets sneller voorlezen (1.0 = normaal). */
export const TTS_PLAYBACK_RATE = 1.12;
/** Vraag & Antwoord opening: normale snelheid, zelfde toon als Realtime-interview. */
export const REALTIME_QA_OPENING_PLAYBACK_RATE = 1.0;

/**
 * @param {HTMLAudioElement} audio
 * @returns {Promise<void>}
 */
function playAudioElement(audio) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Kon audio niet afspelen."));
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    const attemptPlay = (retriesLeft = 2) => {
      void audio.play().catch((err) => {
        if (retriesLeft > 0) {
          window.setTimeout(() => attemptPlay(retriesLeft - 1), 200);
          return;
        }
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      attemptPlay();
      return;
    }

    const onCanPlay = () => {
      audio.removeEventListener("canplay", onCanPlay);
      attemptPlay();
    };
    audio.addEventListener("canplay", onCanPlay);
  });
}

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
  let playGeneration = 0;
  let duckVolume = 1;

  /** @type {ReturnType<typeof setTimeout> | null} */
  let ttsGraceTimer = null;

  const setStatus = (message) => options.onStatus?.(message);

  const setTtsActive = (value) => options.onTtsActive?.(value);

  const clearTtsGrace = () => {
    if (ttsGraceTimer) {
      clearTimeout(ttsGraceTimer);
      ttsGraceTimer = null;
    }
  };

  const setTtsActiveDeferred = (value) => {
    if (value) {
      if (ttsGraceTimer) {
        clearTimeout(ttsGraceTimer);
        ttsGraceTimer = null;
      }
      setTtsActive(true);
      return;
    }
    if (ttsGraceTimer) clearTimeout(ttsGraceTimer);
    ttsGraceTimer = setTimeout(() => {
      ttsGraceTimer = null;
      setTtsActive(false);
    }, TTS_POST_GRACE_MS);
  };

  const cleanupAudio = () => {
    if (audio) {
      try {
        audio.pause();
        audio.src = "";
        audio.onended = null;
        audio.onerror = null;
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

  const resolvePendingPlayOne = () => {
    if (!playOneResolve) return;
    const done = playOneResolve;
    playOneResolve = null;
    done();
  };

  const stopPlayback = () => {
    cancelled = true;
    active = false;
    paused = false;
    playGeneration += 1;
    duckVolume = 1;
    clearTtsGrace();
    setTtsActive(false);
    resolvePendingPlayOne();
    cleanupAudio();
    chunks = [];
    index = 0;
  };

  /**
   * Verlaagt (of herstelt) het TTS-volume zonder de afspeel-lus te onderbreken.
   * @param {boolean} active
   */
  const setDucked = (duckActive) => {
    duckVolume = duckActive ? TTS_DUCK_VOLUME : 1;
    if (audio) audio.volume = duckVolume;
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

  /**
   * @param {string} text
   * @param {Blob} [preloadedBlob]
   * @returns {Promise<void>}
   */
  const playOne = (text, preloadedBlob = null) =>
    new Promise((resolve, reject) => {
      cleanupAudio();
      if (cancelled) {
        resolve();
        return;
      }

      const generation = playGeneration;
      playOneResolve = resolve;
      setTtsActiveDeferred(true);

      const finishPlayOne = () => {
        if (playOneResolve) {
          playOneResolve = null;
          resolve();
        }
      };

      const failPlayOne = (err) => {
        playOneResolve = null;
        clearTtsGrace();
        setTtsActive(false);
        reject(err);
      };

      const startPlayback = (blob) => {
        if (cancelled || generation !== playGeneration) {
          finishPlayOne();
          return;
        }
        blobUrl = URL.createObjectURL(blob);
        audio = new Audio(blobUrl);
        audio.playbackRate = TTS_PLAYBACK_RATE;
        audio.volume = duckVolume;
        void playAudioElement(audio)
          .then(() => {
            if (generation !== playGeneration) return;
            cleanupAudio();
            finishPlayOne();
          })
          .catch((err) => {
            if (generation !== playGeneration) return;
            cleanupAudio();
            failPlayOne(err);
          });
      };

      if (preloadedBlob) {
        startPlayback(preloadedBlob);
        return;
      }

      loadSpeechBlob(text)
        .then((blob) => startPlayback(blob))
        .catch((err) => failPlayOne(err));
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
    playGeneration += 1;
    duckVolume = 1;
    syncChunks(newChunks, newIndex);
    cleanupAudio();
    clearTtsGrace();
    setTtsActive(false);
    resolvePendingPlayOne();
    skipNextIndexAdvance = true;
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
        prefetchAhead(index + 1);

        let blob;
        try {
          blob = await loadSpeechBlob(chunks[index]);
        } catch (err) {
          setStatus("Voorlezen gestopt.");
          options.onError?.(err instanceof Error ? err.message : "Voorlezen mislukt.");
          throw err;
        }

        if (cancelled) break;

        setStatus(`Voorlezen… (${index + 1}/${chunks.length})`);
        const chunkIndex = index;
        await playOne(chunks[index], blob);
        if (cancelled) break;
        if (skipNextIndexAdvance) {
          skipNextIndexAdvance = false;
        } else if (index === chunkIndex) {
          index++;
        }
        if (index >= chunks.length) {
          setTtsActiveDeferred(false);
        }
      }

      if (!cancelled && index >= chunks.length) {
        setStatus("Voorlezen klaar.");
      } else if (cancelled) {
        setStatus("");
      }
    } catch (err) {
      if (!cancelled) {
        setStatus("Voorlezen gestopt.");
      }
      const message = err instanceof Error ? err.message : "Voorlezen mislukt.";
      options.onError?.(message);
      throw err;
    } finally {
      active = false;
      paused = false;
      clearTtsGrace();
      setTtsActive(false);
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
      clearTtsGrace();
      setTtsActive(false);
      setStatus("Gepauzeerd.");
    },

    resume() {
      if (!active || !paused) return;
      paused = false;
      if (audio) {
        setTtsActiveDeferred(true);
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
    setDucked,

    playFrom,

    /**
     * @param {string[]} textChunks
     */
    async playAll(textChunks) {
      await playFrom(textChunks, 0);
    },
  };
}
