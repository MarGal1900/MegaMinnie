/**
 * Algemene gespreksopname — vrije opname tijdens klantafspraak.
 * MediaRecorder + chunk-splitting + sequentiële transcriptie + Claude-naverwerking.
 */

import { apiPost, formFields } from "./api.js";

/** Ruimte onder 25 MB multer-limiet. */
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
const SEGMENT_ROLLOVER_BYTES = 20 * 1024 * 1024;
const RECORDER_TIMESLICE_MS = 1000;

/**
 * @typedef {object} ConversationRecordingDeps
 * @property {(visible: boolean) => void} showPanel
 * @property {(recording: boolean) => void} setRecordingUi
 * @property {(seconds: number) => void} updateTimer
 * @property {(level: number) => void} updateAudioLevel
 * @property {(message: string, phase?: "upload"|"transcribe"|"summarize"|null) => void} setStatus
 * @property {(busy: boolean, message?: string) => void} setBusy
 * @property {(phase: object) => void} setProcessingPhase
 * @property {(from: number, to: number, ms: number, fn: () => Promise<unknown>) => Promise<unknown>} runWithProgressTicker
 * @property {(pct: number) => void} applyProgressPct
 * @property {() => { requestId: number, signal: AbortSignal }} beginRequest
 * @property {(requestId: number) => boolean} isRequestActive
 * @property {() => void} clearInputExceptVoice
 * @property {(result: object) => void} onResult
 * @property {(transcript: string) => void} [onTranscriptReady]
 * @property {(message: string) => void} onError
 * @property {() => void} onCancel
 */

const conversationState = {
  /** @type {"idle"|"recording"|"processing"} */
  phase: "idle",
  /** @type {MediaStream | null} */
  mediaStream: null,
  /** @type {MediaRecorder | null} */
  mediaRecorder: null,
  /** @type {Blob[]} */
  currentChunks: [],
  /** @type {Blob[]} */
  completedSegments: [],
  /** @type {ReturnType<typeof setInterval> | null} */
  timerId: null,
  /** @type {ReturnType<typeof setInterval> | null} */
  levelMonitorId: null,
  /** @type {AudioContext | null} */
  audioCtx: null,
  startedAt: 0,
  elapsedBeforeSegment: 0,
  mimeType: "audio/webm",
  /** @type {ConversationRecordingDeps | null} */
  deps: null,
};

/** @param {ConversationRecordingDeps} deps */
export function initConversationRecording(deps) {
  conversationState.deps = deps;
}

/** @returns {boolean} */
export function isConversationActive() {
  return conversationState.phase !== "idle";
}

/** @returns {boolean} */
export function isConversationRecording() {
  return conversationState.phase === "recording";
}

function getDeps() {
  if (!conversationState.deps) {
    throw new Error("Gespreksopname niet geïnitialiseerd");
  }
  return conversationState.deps;
}

function stopLevelMonitor() {
  if (conversationState.levelMonitorId) {
    clearInterval(conversationState.levelMonitorId);
    conversationState.levelMonitorId = null;
  }
  if (conversationState.audioCtx) {
    conversationState.audioCtx.close().catch(() => {});
    conversationState.audioCtx = null;
  }
  getDeps().updateAudioLevel(0);
}

/** @param {MediaStream} stream */
function startLevelMonitor(stream) {
  stopLevelMonitor();
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    conversationState.audioCtx = ctx;
    const data = new Uint8Array(analyser.frequencyBinCount);

    conversationState.levelMonitorId = setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      getDeps().updateAudioLevel(sum / data.length / 255);
    }, 120);
  } catch {
    /* audio-indicator optioneel */
  }
}

function stopTimer() {
  if (conversationState.timerId) {
    clearInterval(conversationState.timerId);
    conversationState.timerId = null;
  }
}

function startTimer() {
  stopTimer();
  conversationState.startedAt = Date.now();
  conversationState.timerId = setInterval(() => {
    const elapsed =
      conversationState.elapsedBeforeSegment +
      Math.floor((Date.now() - conversationState.startedAt) / 1000);
    getDeps().updateTimer(elapsed);
  }, 500);
}

function resetConversationState() {
  stopTimer();
  stopLevelMonitor();
  if (conversationState.mediaStream) {
    conversationState.mediaStream.getTracks().forEach((t) => t.stop());
  }
  conversationState.phase = "idle";
  conversationState.mediaStream = null;
  conversationState.mediaRecorder = null;
  conversationState.currentChunks = [];
  conversationState.completedSegments = [];
  conversationState.elapsedBeforeSegment = 0;
}

/** @param {Blob[]} chunks @param {string} mimeType */
function chunksToBlob(chunks, mimeType) {
  return new Blob(chunks, { type: mimeType });
}

function currentSegmentBytes() {
  return conversationState.currentChunks.reduce((n, c) => n + c.size, 0);
}

function finalizeCurrentSegment() {
  if (!conversationState.currentChunks.length) return;
  conversationState.completedSegments.push(
    chunksToBlob(conversationState.currentChunks, conversationState.mimeType),
  );
  conversationState.currentChunks = [];
}

/** @param {MediaStream} stream */
function createRecorder(stream) {
  const mimeType = MediaRecorder.isTypeSupported("audio/webm")
    ? "audio/webm"
    : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";
  conversationState.mimeType = mimeType || "audio/webm";
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  recorder.ondataavailable = (e) => {
    if (e.data.size <= 0) return;
    conversationState.currentChunks.push(e.data);
    if (
      conversationState.phase === "recording" &&
      currentSegmentBytes() >= SEGMENT_ROLLOVER_BYTES
    ) {
      void rolloverSegment();
    }
  };

  recorder.onerror = () => {
    getDeps().onError("Opname mislukt — probeer opnieuw.");
    cancelConversationRecording();
  };

  conversationState.mediaRecorder = recorder;
  recorder.start(RECORDER_TIMESLICE_MS);
}

async function rolloverSegment() {
  const recorder = conversationState.mediaRecorder;
  const stream = conversationState.mediaStream;
  if (!recorder || !stream || recorder.state !== "recording") return;

  conversationState.elapsedBeforeSegment += Math.floor(
    (Date.now() - conversationState.startedAt) / 1000,
  );
  conversationState.startedAt = Date.now();

  await new Promise((resolve) => {
    recorder.addEventListener(
      "stop",
      () => {
        finalizeCurrentSegment();
        resolve(undefined);
      },
      { once: true },
    );
    try {
      recorder.stop();
    } catch {
      resolve(undefined);
    }
  });

  if (conversationState.phase !== "recording" || !conversationState.mediaStream) return;
  createRecorder(stream);
}

/** Open gespreksopname-paneel. */
export async function startConversationRecording() {
  if (conversationState.phase === "recording") return;
  if (!navigator.mediaDevices?.getUserMedia) {
    alert(
      "Opnemen werkt alleen via https:// of http://localhost. Open MegaMinnie lokaal of op een beveiligde verbinding.",
    );
    return;
  }

  const deps = getDeps();
  resetConversationState();
  deps.clearInputExceptVoice();
  deps.showPanel(true);
  deps.setStatus("Druk op START om de opname te beginnen.");
  deps.updateTimer(0);
  deps.updateAudioLevel(0);
}

/** MediaRecorder starten (START-knop). */
export async function beginConversationCapture() {
  if (conversationState.phase === "recording") return;

  const deps = getDeps();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === "NotAllowedError";
    alert(
      denied
        ? "Microfoon geweigerd. Sta toegang toe in de browser-instellingen en probeer opnieuw."
        : "Microfoon niet beschikbaar. Controleer je apparaat of probeer een andere browser.",
    );
    return;
  }

  conversationState.mediaStream = stream;
  conversationState.phase = "recording";
  conversationState.currentChunks = [];
  conversationState.completedSegments = [];
  conversationState.elapsedBeforeSegment = 0;

  createRecorder(stream);
  startTimer();
  startLevelMonitor(stream);
  deps.setRecordingUi(true);
  deps.setStatus("Opname loopt — MegaMinnie luistert mee…");
}

/** Stop opname en start verwerking. */
export async function stopConversationRecording() {
  if (conversationState.phase !== "recording") return;

  const deps = getDeps();
  deps.setRecordingUi(false);
  stopTimer();
  stopLevelMonitor();
  conversationState.phase = "processing";

  const recorder = conversationState.mediaRecorder;
  if (recorder && recorder.state !== "inactive") {
    await new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          finalizeCurrentSegment();
          resolve(undefined);
        },
        { once: true },
      );
      try {
        recorder.stop();
      } catch {
        resolve(undefined);
      }
    });
  } else {
    finalizeCurrentSegment();
  }

  if (conversationState.mediaStream) {
    conversationState.mediaStream.getTracks().forEach((t) => t.stop());
    conversationState.mediaStream = null;
  }
  conversationState.mediaRecorder = null;

  const segments = [...conversationState.completedSegments];
  if (!segments.length) {
    deps.onError("Geen audio opgenomen — probeer opnieuw.");
    resetConversationState();
    deps.showPanel(false);
    return;
  }

  await processConversationSegments(segments);
}

/** Annuleer opname zonder verwerking. */
export function cancelConversationRecording() {
  const deps = getDeps();
  resetConversationState();
  deps.setRecordingUi(false);
  deps.showPanel(false);
  deps.onCancel();
}

/**
 * Splits grote blobs in uploadbare chunks (< 25 MB).
 * @param {Blob} blob
 * @returns {Blob[]}
 */
export function splitAudioBlob(blob) {
  if (blob.size <= MAX_CHUNK_BYTES) return [blob];
  const parts = [];
  let offset = 0;
  while (offset < blob.size) {
    parts.push(blob.slice(offset, offset + MAX_CHUNK_BYTES, blob.type));
    offset += MAX_CHUNK_BYTES;
  }
  return parts;
}

/**
 * @param {Blob[]} segments
 * @param {AbortSignal} [signal]
 */
async function transcribeSegments(segments, signal) {
  const deps = getDeps();
  /** @type {string[]} */
  const transcripts = [];
  let uploadIndex = 0;
  const allChunks = segments.flatMap((seg, segIdx) =>
    splitAudioBlob(seg).map((chunk, chunkIdx) => ({
      blob: chunk,
      name: `gesprek-deel-${segIdx + 1}-${chunkIdx + 1}.webm`,
    })),
  );

  for (const { blob, name } of allChunks) {
    uploadIndex += 1;
    deps.setStatus(
      `Deel ${uploadIndex}/${allChunks.length} uploaden…`,
      "upload",
    );
    deps.setProcessingPhase({
      phase: 1,
      transcribing: true,
      progress: Math.round(((uploadIndex - 1) / allChunks.length) * 45),
      message: `Deel ${uploadIndex}/${allChunks.length} uploaden…`,
    });

    const fd = formFields();
    fd.append("audio", blob, name);

    deps.setStatus(
      `Deel ${uploadIndex}/${allChunks.length} transcriberen…`,
      "transcribe",
    );

    const result = await deps.runWithProgressTicker(
      Math.round(((uploadIndex - 1) / allChunks.length) * 45 + 5),
      Math.round((uploadIndex / allChunks.length) * 48),
      Math.max(8000, Math.min(120000, blob.size / 40)),
      () =>
        apiPost("/api/visit-report/conversation/transcribe", {
          method: "POST",
          body: fd,
          signal,
        }),
    );

    if (typeof result.text === "string" && result.text.trim()) {
      transcripts.push(result.text.trim());
    }
  }

  return transcripts.join("\n\n");
}

/** @param {Blob[]} segments */
async function processConversationSegments(segments) {
  const deps = getDeps();
  const { requestId, signal } = deps.beginRequest();

  deps.setBusy(true, "Gesprek verwerken…");
  deps.showPanel(false);
  deps.setProcessingPhase({
    phase: 1,
    transcribing: true,
    progress: 3,
    message: "Transcriberen met sprekerherkenning…",
  });

  try {
    const transcript = await transcribeSegments(segments, signal);
    if (!deps.isRequestActive(requestId)) return;

    if (!transcript.trim()) {
      throw new Error("Geen spraak herkend in de opname.");
    }

    deps.onTranscriptReady?.(transcript);

    deps.setProcessingPhase({
      phase: 2,
      transcribing: false,
      progress: 52,
      message: "MegaMinnie vat het gesprek samen…",
    });
    deps.setStatus("Samenvatten met Claude…", "summarize");

    const result = await deps.runWithProgressTicker(
      52,
      98,
      Math.max(12000, transcript.length * 8),
      () =>
        apiPost("/api/visit-report/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
          signal,
        }),
    );

    if (!deps.isRequestActive(requestId)) return;

    deps.applyProgressPct(100);
    resetConversationState();
    deps.showPanel(false);
    deps.setBusy(false);
    deps.onResult(result);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    deps.setBusy(false);
    deps.onError(err instanceof Error ? err.message : "Verwerken mislukt");
    resetConversationState();
    deps.showPanel(false);
  }
}
