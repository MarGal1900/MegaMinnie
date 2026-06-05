import {
  $,
  escapeHtml,
  showFeedback,
  showQualityWarning,
  hideFeedback,
  showInputFeedback,
  hideInputFeedback,
  formatSyncFeedback,
} from "./dom.js";
import { apiPost, formFields, setApiKey } from "./api.js";
import {
  detectInterviewCommandAtTail,
  detectRealtimeQaVoiceCommand,
  detectReviewVoiceCommand,
  parseAnswerTranscript,
  stripReviewVoiceCommand,
} from "./interview-commands.js";
import {
  renderTasksAndEvents,
  collectTasksEventsFromUi,
  initTasksEventsControls,
  setTasksEventsToolbarVisible,
} from "./tasks-events.js";
import {
  initConversationRecording,
  startConversationRecording,
  stopConversationRecording,
  cancelConversationRecording,
  isConversationActive,
  isConversationRecording,
} from "./conversation-recording.js";
import { createRealtimeInterviewController, REALTIME_QA_OPENING_TEXT } from "./realtime-interview.js";
import { createOpenAiSpeechPlayback, playOpenAiSpeechOnce, prefetchOpenAiSpeech } from "./openai-speech.js";
import { initShareReportEmail } from "./share-report-email.js";
import { OnboardingTour } from "./onboarding.js";

/** @typedef {{ subject: string; description?: string; activityDate: string; priority: string; status: string; assignee?: string; ownerId?: string }} Task */
/** @typedef {{ subject: string; description?: string; startDateTime: string; endDateTime: string; location?: string }} Event */
/** @typedef {{ accountName?: string; contactName?: string; email?: string; phone?: string; opportunityName?: string }} CustomerHints */
/** @typedef {{ id: string; type: string; name: string; subtitle?: string; score: number }} SalesforceRecordHit */
/** @typedef {{ configured: boolean; extractedCustomer?: CustomerHints; suggestions: SalesforceRecordHit[]; autoSelected: SalesforceRecordHit | null }} SalesforceLinkResult */
/** @typedef {{ salesforceNote: { title: string; body: string }; tasks: Task[]; events: Event[]; summary?: string; customer?: CustomerHints }} MegaMinnieOutput */
/** @typedef {{ source: string; rawInput: string; transcript?: string; extended?: boolean; megaMinnie: MegaMinnieOutput; salesforceLink?: SalesforceLinkResult; salesforce?: { noteId?: string; taskIds: string[]; eventIds: string[]; dryRun: boolean } }} VisitReportResult */
/** @typedef {{ id: string; file: File; url: string }} PhotoItem */

/** Verwerkings-GIF (zelfde asset in prod én test; versie bumpen bij deploy). */
const MEGAMINNIE_PROCESSING_GIF = "/images/megaminnie-animated-web.gif";
const MEGAMINNIE_PROCESSING_GIF_VERSION = 35;

const state = {
  recording: false,
  mediaRecorder: null,
  audioChunks: [],
  /** @type {Blob | File | null} */
  audioBlob: null,
  audioName: "",
  /** @type {PhotoItem[]} */
  photos: [],
  /** @type {string[]} */
  documentNames: [],
  /** Expliciete invoerbron — enige bron voor resolveInputMode() */
  /** @type {"photo"|"voice"|"text"|null} */
  activeInputKind: null,
  lastResult: null,
  dryRun: true,
  keepInput: true,
  salesforceConfigured: false,
  mailSignature: "",
  defaultAccountManager: "Accountmanager",
  /** @type {SalesforceRecordHit | null} */
  sfSelected: null,
  /** Aanvulling op bestaand concept (los van eerste invoerhub) */
  supplement: {
    /** @type {Blob | File | null} */
    audioBlob: null,
    audioName: "",
    /** @type {PhotoItem[]} */
    photos: [],
    recording: false,
    mediaRecorder: null,
    audioChunks: [],
    autoProcessOnStop: false,
  },
  reviewPlayback: {
    active: false,
    paused: false,
    cancelled: false,
    /** @type {string[]} */
    chunks: [],
    index: 0,
    /** @type {{ resumeIndex: number; paragraphKey: string | null } | null} */
    suspendForCorrection: null,
    suppressLoopCleanup: false,
    /** @type {string[]} */
    chunkParagraphKeys: [],
    ttsActive: false,
    lastSpokenChunk: "",
  },
  interview: {
    active: false,
    step: 0,
    speaking: false,
    processingAnswer: false,
    /** @type {{ question: string; audioBlob: Blob | null; transcript?: string }[]} */
    answers: [],
    processingUI: false,
    processingMessage: "",
    voiceCommandLocked: false,
    lastVoiceCommandAt: 0,
    commandPollTimer: null,
    commandPollBusy: false,
    commandPollAbort: null,
    lastCommandCheckAt: 0,
    commandPollBackoffUntil: 0,
    commandSilenceFrame: null,
    commandAudioCtx: null,
    mediaStream: null,
    audioChunks: [],
    mediaRecorder: null,
    recordingAnswer: false,
  },
};

const INTERVIEW_TTS_RATE = 0.94;
const INTERVIEW_TTS_PAUSE_MS = 280;
const INTERVIEW_TTS_PAUSE_PUNCTUATION_MS = 420;
const INTERVIEW_VOICE_POLL_MS = 3500;
const COMMAND_CHECK_MIN_INTERVAL_MS = 2500;
const COMMAND_TAIL_CHUNKS = 45;
const COMMAND_MIN_CHUNKS = 3;
const COMMAND_MIN_BYTES = 600;
const COMMAND_SILENCE_RMS = 0.011;
const COMMAND_SILENCE_MS = 400;
const INTERVIEW_VOICE_COMMAND_DEBOUNCE_MS = 1000;
const WHISPER_COMMAND_PROMPT = "volgende vraag. einde verslag. verslag klaar. ga door.";
const INTERVIEW_RECORDING_STATUS =
  "Spreek je antwoord in. Zeg aan het eind: volgende vraag — of: einde verslag.";

const INTERVIEW_INTRO_1 =
  "Hallo, MegaMinnie hier. Ik ga jou helpen jouw bezoekverslag uit te werken.";
const INTERVIEW_INTRO_2 =
  "Ik stel je zes vragen over je bezoek. Antwoord hardop. Zeg volgende vraag om door te gaan. Zeg einde verslag als je klaar bent.";
const INTERVIEW_NEXT_PROMPT = "Dank je. Volgende vraag.";

/** @param {number} step */
function interviewStepSpokenTexts(step) {
  /** @type {string[]} */
  const texts = [];
  if (step === 0) {
    texts.push(INTERVIEW_INTRO_1, INTERVIEW_INTRO_2);
  } else {
    texts.push(INTERVIEW_NEXT_PROMPT);
  }
  texts.push(INTERVIEW_QUESTIONS[step] ?? "");
  return texts.filter(Boolean);
}

/** @param {string} raw @param {number} step */
function stripStepSpeechFromTranscript(raw, step) {
  const parsed = parseAnswerTranscript(raw);
  let cleaned = parsed.cleaned;
  for (const phrase of interviewStepSpokenTexts(step)) {
    const pattern = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`^\\s*${pattern}\\s*`, "iu"), "");
  }
  return { ...parsed, cleaned: cleaned.replace(/\s+/g, " ").trim() };
}

const TEST_AUDIO_DB = "megaminnie-test-audio";
const TEST_AUDIO_DB_VERSION = 2;
const TEST_RECORDINGS_STORE = "recordings";
const LEGACY_BLOBS_STORE = "blobs";
const LEGACY_MAIN_KEY = "main-input";
const TEST_MODE_STORAGE_KEY = "megaminnie_test_mode";

const INTERVIEW_QUESTIONS = [
  "Wat is het onderwerp van de afspraak geweest?",
  "Op welke datum en tijdstip was dit?",
  "Met wie heb je gesproken?",
  "Wat is er besproken?",
  "Zijn er nog actiepunten?",
  "Wat is er besproken met betrekking tot het vervolg?",
];

let photoIdCounter = 0;
let supplementPhotoIdCounter = 0;
/** @type {"main"|"supplement"} */
let recordContext = "main";
let supplementAudioObjectUrl = null;
/** @type {number} Verhoogt bij elke invoerwijziging; voorkomt verouderde API-antwoorden. */
let inputGeneration = 0;
/** @type {number} Loopt op bij elke nieuwe processReport-aanroep. */
let activeProcessId = 0;
/** @type {1|2|null} Huidige verwerkingssubstap (verwerken / uitwerken). */
let activeProcessingPhase = null;
/** @type {ReturnType<typeof setInterval> | null} */
let progressTickerId = null;
let activeProcessingProgress = 0;

/** @param {number} overallPct @param {1|2|null} phase */
function stepButtonFillPct(overallPct, phase) {
  if (phase === 1) return Math.min(100, Math.max(0, (overallPct / 50) * 100));
  if (phase === 2) return Math.min(100, Math.max(0, ((overallPct - 50) / 50) * 100));
  return 0;
}

/** @param {1|2|null} phase @param {number} overallPct */
function updateProcessingStepButtons(phase, overallPct) {
  const fill = stepButtonFillPct(overallPct, phase);
  for (const container of document.querySelectorAll(".processing-steps")) {
    container.querySelectorAll(".processing-steps__item").forEach((item) => {
      const step = Number(item.dataset.step);
      const isCurrent = phase != null && step === phase;
      item.hidden = !isCurrent;
      item.classList.toggle("is-active", isCurrent);
      item.classList.toggle("is-done", phase != null && step < phase);
      const fillEl = item.querySelector(".processing-steps__item-fill");
      if (isCurrent && fillEl) {
        fillEl.style.width = `${fill}%`;
        item.setAttribute("role", "progressbar");
        item.setAttribute("aria-valuemin", "0");
        item.setAttribute("aria-valuemax", "100");
        item.setAttribute("aria-valuenow", String(Math.round(fill)));
        const labelEl = item.querySelector(".processing-steps__item-label");
        if (labelEl) {
          const name = step === 1 ? "Verwerken" : "Uitwerken";
          labelEl.textContent = `${name} · ${Math.round(fill)}%`;
        }
      } else if (fillEl) {
        fillEl.style.width = "0%";
      }
    });
  }
}

function resetProcessingStepButtons() {
  for (const container of document.querySelectorAll(".processing-steps")) {
    container.querySelectorAll(".processing-steps__item").forEach((item) => {
      item.hidden = Number(item.dataset.step) !== 1;
      item.classList.remove("is-active", "is-done");
      const fillEl = item.querySelector(".processing-steps__item-fill");
      if (fillEl) fillEl.style.width = "0%";
      item.removeAttribute("role");
      item.removeAttribute("aria-valuemin");
      item.removeAttribute("aria-valuemax");
      item.removeAttribute("aria-valuenow");
    });
  }
}

/** @param {number} pct */
function applyProgressPct(pct) {
  activeProcessingProgress = Math.min(100, Math.max(0, pct));
  updateProcessingStepButtons(activeProcessingPhase, activeProcessingProgress);
}

function stopProgressTicker() {
  if (progressTickerId != null) {
    clearInterval(progressTickerId);
    progressTickerId = null;
  }
}

/**
 * Vloeiende voortgang tijdens API-calls — loopt max. tot capRatio van het eindpunt;
 * pas bij afronding naar 100% (geen lang hangen op volle balk).
 * @param {number} from
 * @param {number} to
 * @param {{ durationMs?: number; tickMs?: number; capRatio?: number }} [opts]
 */
function startProgressTicker(from, to, { durationMs = 60000, tickMs = 400, capRatio = 0.82 } = {}) {
  stopProgressTicker();
  applyProgressPct(from);
  const cap = from + (to - from) * capRatio;
  const startTime = Date.now();
  progressTickerId = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const t = Math.min(1, elapsed / durationMs);
    const eased = t ** 0.75;
    applyProgressPct(from + (cap - from) * eased);
    if (t >= 1) stopProgressTicker();
  }, tickMs);
}

/** @param {Blob | null | undefined} blob */
async function estimateTranscribeDurationMs(blob) {
  const bytes = blob?.size ?? 0;
  if (typeof Audio !== "undefined" && blob?.size) {
    try {
      const url = URL.createObjectURL(blob);
      const audioMs = await new Promise((resolve) => {
        const audio = new Audio();
        const finish = (ms) => {
          URL.revokeObjectURL(url);
          resolve(ms);
        };
        audio.preload = "metadata";
        audio.onloadedmetadata = () => {
          finish(
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration * 1000
              : 0,
          );
        };
        audio.onerror = () => finish(0);
        audio.src = url;
      });
      if (audioMs > 0) {
        return Math.min(180000, Math.max(22000, audioMs * 2.8));
      }
    } catch {
      /* fallback op bestandsgrootte */
    }
  }
  return Math.min(180000, Math.max(28000, 14000 + bytes / 80));
}

/** @param {number} [textLength] */
function estimateLlmDurationMs(textLength = 0) {
  return Math.max(28000, Math.min(180000, 28000 + textLength * 20));
}

/** @param {number} photoCount @param {{ file?: File }[]} [photos] */
function estimatePhotoDurationMs(photoCount = 1, photos = []) {
  let bytes = 0;
  for (const p of photos) bytes += p.file?.size ?? 0;
  const perPhoto = 14000;
  const sizeFactor = Math.min(45000, bytes / 500000 * 15000);
  return Math.min(180000, Math.max(30000, 32000 + photoCount * perPhoto + sizeFactor));
}

/**
 * @template T
 * @param {number} from
 * @param {number} to
 * @param {number | Promise<number>} durationMs
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runWithProgressTicker(from, to, durationMs, fn) {
  const resolvedDuration =
    durationMs instanceof Promise ? await durationMs : durationMs;
  startProgressTicker(from, to, { durationMs: resolvedDuration, capRatio: 0.82 });
  try {
    return await fn();
  } finally {
    stopProgressTicker();
    applyProgressPct(to);
  }
}

let activeAbort = null;
let activeRequestId = 0;
let dragDepth = 0;
let sfSearchTimer = 0;

const btnProcess = $("btn-process");
const btnCancelLoading = $("btn-cancel-loading");
const processHint = $("process-hint");
const outputPanel = $("output-panel") ?? document.querySelector(".panel--output");
const mainLayout = $("main-layout");
const inputPanel = document.querySelector(".panel--input");
const dropOverlay = $("drop-overlay");
const dropOverlayText = $("drop-overlay-text");
const inputSummary = $("input-summary");
const textInput = $("text-input");
const manualPanel = $("manual-panel");
const btnManual = $("btn-manual");
const hubProcessSlot = $("hub-process-slot");
const manualProcessSlot = $("manual-process-slot");
const btnInvoer = $("btn-invoer");
const btnConversation = $("btn-conversation");
const conversationLabel = $("conversation-label");
const recordHint = $("record-hint");
let realtimeController = null;
/** @type {ReturnType<typeof createRealtimeInterviewController> | null} */
let supplementRealtimeController = null;
/** @type {ReturnType<typeof createRealtimeInterviewController> | null} */
let reviewInlineListenController = null;

const reviewInlineCorrection = {
  active: false,
  pendingInterrupt: false,
  enteredViaCommand: false,
  /** @type {string[]} */
  segments: [],
  flushedSegmentCount: 0,
  /** @type {ReturnType<typeof setTimeout> | null} */
  debounceTimer: null,
  /** @type {ReturnType<typeof setTimeout> | null} */
  resumeTimer: null,
  /** @type {ReturnType<typeof setTimeout> | null} */
  interruptConfirmTimer: null,
  applyInFlight: false,
  finalizeInFlight: false,
  /** Tijdstempel (ms) tot wanneer onTurn-segmenten worden genegeerd na activatie (echo-buffer). */
  echoGraceUntil: 0,
};

const INLINE_CORRECTION_RESUME_MS = 5500;
const INLINE_CORRECTION_EMPTY_RESUME_MS = 1200;
const INLINE_INTERRUPT_CONFIRM_MS = 450;

/** Passief Realtime-luisteren tijdens voorlezen; spraakcommando "Correctie" + live /extend. */
const REVIEW_INLINE_LISTEN_ENABLED = true;

const REVIEW_PLAYBACK_STATUS = "";
/** @type {ReturnType<typeof createOpenAiSpeechPlayback> | null} */
let reviewSpeechPlayer = null;
let reviewPlaybackSessionId = 0;
let lastRealtimeTranscript = "";
/** @type {"realtime-qa"|"conversation"} */
let conversationPanelMode = "conversation";
let realtimeInterviewEnabled = true;
let realtimeAutoFinishing = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let realtimeFinishCheckTimer = null;
let realtimeQaDraftActive = false;

function setInterviewButtonUi(active) {
  btnInvoer?.classList.toggle("is-recording", active);
  btnInvoer?.setAttribute("aria-pressed", active ? "true" : "false");
}

function setConversationButtonUi(active) {
  btnConversation?.classList.toggle("is-recording", active);
  btnConversation?.setAttribute("aria-pressed", active ? "true" : "false");
  if (conversationLabel) {
    conversationLabel.textContent = active ? "Opname loopt…" : "Opname gesprek";
  }
}

function setRealtimeStatus(message) {
  setConversationStatus(message);
}

function isRealtimeConversationRunning() {
  return Boolean(realtimeController?.isActive() || realtimeController?.isConnecting());
}

function isRecordModeUiActive() {
  return (
    isConversationRecording() ||
    isConversationActive() ||
    isRealtimeConversationRunning()
  );
}

function resetRecordModeUi() {
  setConversationButtonUi(false);
  if (!state.interview.active) {
    setInterviewButtonUi(false);
  }
}

function stopRealtimeInterview(status = "Gestopt") {
  realtimeController?.stop(status);
}

function formatRealtimeQaTranscriptForNote(transcript) {
  const lines = String(transcript || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return lines
    .map((line) => {
      const user = line.match(/^\[Gebruiker\]:\s*(.+)$/i);
      if (user?.[1]) return `Jij: ${user[1].trim()}`;
      const assistant = line.match(/^\[Assistent\]:\s*(.+)$/i);
      if (assistant?.[1]) return `MegaMinnie: ${assistant[1].trim()}`;
      return line;
    })
    .join("\n\n");
}

function setNoteBodyPlainText(text, placeholder = "") {
  const el = $("note-body");
  if (!el) return;
  const content = String(text || "").trim();
  if ("value" in el && typeof el.value === "string") {
    el.value = content;
    el.placeholder = content ? "" : placeholder;
  } else if (content) {
    el.textContent = content;
    el.removeAttribute("data-placeholder");
  } else {
    el.textContent = "";
    if (placeholder) el.setAttribute("data-placeholder", placeholder);
    else el.removeAttribute("data-placeholder");
  }
  resizeNoteBody();
}

function setRealtimeQaDraftEditing(enabled) {
  const title = $("note-title");
  const body = $("note-body");
  if (enabled) {
    title?.removeAttribute("contenteditable");
    body?.removeAttribute("contenteditable");
  } else {
    title?.setAttribute("contenteditable", "true");
    body?.setAttribute("contenteditable", "true");
  }
}

function renderRealtimeQaDraft(transcript) {
  realtimeQaDraftActive = true;
  if (outputPanel) outputPanel.hidden = false;
  mainLayout?.classList.toggle("layout--single", false);
  const resultArea = $("result-area");
  if (resultArea) {
    resultArea.hidden = false;
    resultArea.classList.add("is-realtime-qa-draft");
  }
  if (reviewSection) reviewSection.hidden = true;
  $("tasks-section").hidden = true;
  $("events-section").hidden = true;
  $("tasks-events-actions").hidden = true;

  setNoteTitle("Vraag & Antwoord — live");
  const formatted = formatRealtimeQaTranscriptForNote(transcript);
  setNoteBodyPlainText(
    formatted,
    "Gesprek gestart — spreek je antwoord in. Zeg “stop” om uit te werken.",
  );
  setRealtimeQaDraftEditing(true);
  updateSyncButton();
  updateOutputVisibility();
  if (formatted) {
    const body = $("note-body");
    body?.scrollTo?.({ top: body.scrollHeight, behavior: "smooth" });
  }
}

function endRealtimeQaDraft({ restoreResult = true } = {}) {
  realtimeQaDraftActive = false;
  $("result-area")?.classList.remove("is-realtime-qa-draft");
  setRealtimeQaDraftEditing(false);
  if (restoreResult && state.lastResult) {
    renderResult(state.lastResult);
    return;
  }
  if (!state.lastResult) {
    clearResultFields();
  }
  updateOutputVisibility();
  updateSyncButton();
}

function beginRealtimeQaDraft() {
  renderRealtimeQaDraft("");
}

function updateRealtimeQaDraft(transcript) {
  if (conversationPanelMode !== "realtime-qa") return;
  if (!realtimeQaDraftActive && !isRealtimeConversationRunning()) return;

  const formatted = formatRealtimeQaTranscriptForNote(transcript);
  if (!realtimeQaDraftActive) {
    renderRealtimeQaDraft(transcript);
    return;
  }

  if (outputPanel) outputPanel.hidden = false;
  mainLayout?.classList.toggle("layout--single", false);
  $("result-area").hidden = false;
  setNoteTitle("Vraag & Antwoord — live");
  setNoteBodyPlainText(
    formatted,
    "Gesprek gestart — spreek je antwoord in. Zeg “stop” om uit te werken.",
  );
  const body = $("note-body");
  body?.scrollTo?.({ top: body.scrollHeight, behavior: "smooth" });
}

async function processRealtimeConversationTranscript(transcript) {
  const cleanedTranscript = String(transcript || "").trim();
  if (!cleanedTranscript) {
    showFeedback(
      "Geen transcript ontvangen uit het realtime gesprek. Probeer opnieuw of gebruik Opname gesprek.",
      "error",
    );
    return;
  }

  await persistConversationTranscript(cleanedTranscript, { kind: "realtime-qa" });

  realtimeQaDraftActive = false;
  $("result-area")?.classList.remove("is-realtime-qa-draft");
  setRealtimeQaDraftEditing(false);

  const processId = ++activeProcessId;
  const { requestId, signal } = beginRequest();
  stopReviewPlayback();
  updateFlowSteps();
  setInputBusy(true, "Realtime gesprek verwerken…");
  setProcessingPhase({
    phase: 2,
    progress: 50,
    transcribing: false,
    message: "Uitwerken…",
  });
  hideFeedback();

  try {
    const result = await runWithProgressTicker(
      50,
      98,
      estimateLlmDurationMs(cleanedTranscript.length),
      () =>
        apiPost("/api/visit-report/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: cleanedTranscript }),
          signal,
        }),
    );
    applyProgressPct(100);

    if (!isRequestActive(requestId)) return;
    if (processId !== activeProcessId) return;

    state.lastResult = result;
    updateFlowSteps();
    renderResult(result);
    clearAllInputSources();
    updateProcessUi();
    showFeedback("Realtime gesprek is uitgewerkt.", "success");
    if (outputPanel && !outputPanel.hidden) {
      outputPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch (err) {
    if (!isRequestActive(requestId)) return;
    if (isAbortError(err)) return;
    showProcessingError(
      err instanceof Error ? err.message : "Realtime verwerking mislukt",
    );
  } finally {
    if (isRequestActive(requestId)) {
      activeAbort = null;
      setInputBusy(false);
    }
  }
}

function extractLastRealtimeUserText(transcript) {
  const lines = String(transcript || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const match = line.match(/^\[Gebruiker\]:\s*(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function maybeHandleRealtimeQaVoiceCommand(sourceText) {
  if (conversationPanelMode !== "realtime-qa") return;
  if (!isRealtimeConversationRunning()) return;
  if (realtimeAutoFinishing) return;
  const text = String(sourceText || "").trim();
  if (!text) return;
  const command = detectRealtimeQaVoiceCommand(text);
  if (command === "cancel") {
    cancelRealtimeQaConversation({ fromVoice: true });
    return;
  }
  if (command === "stop") {
    finalizeRealtimeQaConversation({ fromVoice: true });
  }
}

function scheduleRealtimeFinishCheckFromTranscript(transcript) {
  if (realtimeFinishCheckTimer) clearTimeout(realtimeFinishCheckTimer);
  realtimeFinishCheckTimer = setTimeout(() => {
    realtimeFinishCheckTimer = null;
    maybeHandleRealtimeQaVoiceCommand(extractLastRealtimeUserText(transcript));
  }, 350);
}

function cancelRealtimeQaConversation({ fromVoice = false } = {}) {
  if (realtimeFinishCheckTimer) {
    clearTimeout(realtimeFinishCheckTimer);
    realtimeFinishCheckTimer = null;
  }
  realtimeAutoFinishing = false;
  lastRealtimeTranscript = "";
  realtimeController?.consumeTranscript?.();
  stopRealtimeInterview(fromVoice ? "Annuleer — gesprek afgebroken" : "Geannuleerd");
  resetRecordModeUi();
  setConversationRecordingUi(false);
  endRealtimeQaDraft({ restoreResult: true });
  updateProcessUi();
  if (fromVoice) {
    showFeedback("Gesprek geannuleerd.", "success");
  }
}

function finalizeRealtimeQaConversation({ fromVoice = false } = {}) {
  void fromVoice;
  if (realtimeAutoFinishing) return;
  realtimeAutoFinishing = true;
  if (realtimeFinishCheckTimer) {
    clearTimeout(realtimeFinishCheckTimer);
    realtimeFinishCheckTimer = null;
  }

  const completeFinalize = () => {
    const transcript = realtimeController?.consumeTranscript() || lastRealtimeTranscript || "";
    lastRealtimeTranscript = "";
    stopRealtimeInterview("Stopcommando herkend — verwerken…");
    resetRecordModeUi();
    setConversationRecordingUi(false);
    if (transcript.trim()) {
      setNoteTitle("Vraag & Antwoord — uitwerken…");
      setNoteBodyPlainText(formatRealtimeQaTranscriptForNote(transcript), "");
      updateProcessUi();
      void processRealtimeConversationTranscript(transcript).finally(() => {
        realtimeAutoFinishing = false;
      });
      return;
    }
    endRealtimeQaDraft({ restoreResult: true });
    realtimeAutoFinishing = false;
    updateProcessUi();
    showFeedback(
      "Stopcommando gehoord, maar er is nog geen transcript. Start opnieuw met Vraag & Antwoord.",
      "error",
    );
  };

  if (isRealtimeConversationRunning()) {
    setRealtimeStatus("Stopcommando herkend — afronden…");
    setTimeout(completeFinalize, 1200);
    return;
  }

  completeFinalize();
}

/** @param {string} message @param {"upload"|"transcribe"|"summarize"|null} [phase] */
function setConversationStatus(message) {
  if (!recordHint || !message) return;
  recordHint.textContent = message;
  recordHint.hidden = false;
}

/** @param {boolean} recording */
function setConversationRecordingUi(recording) {
  if (conversationPanelMode === "realtime-qa") {
    setInterviewButtonUi(recording);
    return;
  }
  setConversationButtonUi(recording);
}
const audioPreview = $("audio-preview");
const audioReview = $("audio-review");
const btnRemoveAudio = $("btn-remove-audio");
let audioObjectUrl = null;
const fileDropzone = $("file-dropzone");
const inputDropIdle = $("input-drop-idle");
const inputDropBusy = $("input-drop-busy");
const inputDropBusyLabel = $("input-drop-busy-label");
const inputDropBusySteps = $("input-drop-busy-steps");
const miniMegaminnieGif = $("mini-megaminnie-gif");
const btnCancelDrop = $("btn-cancel-drop");
const fileInput = $("file-input");
const inputAttachments = $("input-attachments");
const flowSteps = $("flow-steps");
const sfLink = $("sf-link");
const sfExtracted = $("sf-extracted");
const sfSelectedEl = $("sf-selected");
const sfSuggestionsWrap = $("sf-suggestions-wrap");
const sfSuggestions = $("sf-suggestions");
const sfSearchInput = $("sf-search");
const sfSearchResults = $("sf-search-results");
const sfLinkHint = $("sf-link-hint");
const btnSync = $("btn-sync");
const recordIdInput = $("record-id");
const inputBusy = $("input-busy");
const inputBusyText = $("input-busy-text");
const btnCancelProcess = $("btn-cancel-process");
const supplementFile = $("supplement-file");
const supplementAudioReview = $("supplement-audio-review");
const supplementAudioPreview = $("supplement-audio-preview");
const btnSupplementRemoveAudio = $("btn-supplement-remove-audio");
const supplementAttachments = $("supplement-attachments");
const btnSupplementProcess = $("btn-supplement-process");
const reviewSection = $("review-section");
const btnReviewRead = $("btn-review-read");
const btnReviewPause = $("btn-review-pause");
const btnReviewResume = $("btn-review-resume");
const btnReviewStop = $("btn-review-stop");
const btnVoiceCorrect = $("btn-voice-correct");
const reviewStatus = $("review-status");
const interviewPanel = $("interview-panel");
const interviewStep = $("interview-step");
const interviewQuestion = $("interview-question");
const interviewStatus = $("interview-status");
const interviewAnswerPreview = $("interview-answer-preview");
const interviewDoneList = $("interview-done-list");
const interviewBusy = $("interview-busy");
const interviewBusyText = $("interview-busy-text");
const btnInterviewNext = $("btn-interview-next");
const btnInterviewFinish = $("btn-interview-finish");
const btnInterviewCancel = $("btn-interview-cancel");
const testModeBanner = $("test-mode-banner");
const btnTestMode = $("btn-test-mode");
const testRecordingsSection = $("test-recordings");
const testRecordingsList = $("test-recordings-list");
/** @type {{ id: string; name: string; kind: string; savedAt: number; blob: Blob }[]} */
let testRecordingsCache = [];

const TEST_REC_ICON_UPLOAD =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v6.5M8 2.5 5.8 5.2M8 2.5 10.2 5.2M3.5 10h9M4.5 10v2.3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V10"/></svg>';
const TEST_REC_ICON_PLAY =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.2c0-.7.8-1.1 1.4-.7l7.2 4.3c.6.4.6 1.1 0 1.5l-7.2 4.3c-.6.4-1.4 0-1.4-.7V3.2z"/></svg>';
const TEST_REC_ICON_TRASH =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2.5h5l.5 1h3v1.5h-12V3.5h3l.5-1zm-.5 3h1v7.5h1.5V5.5H9v7.5h1.5V5.5h1v7.5c0 .8-.7 1.5-1.5 1.5h-4c-.8 0-1.5-.7-1.5-1.5V5.5z"/></svg>';
const TEST_REC_ICON_EDIT =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.2 2.6a1.1 1.1 0 0 1 1.6 0l1.6 1.6a1.1 1.1 0 0 1 0 1.6L6.8 12.3 3.5 13l.7-3.3 7-7.1zM5.4 10.6l6.3-6.3-.8-.8-6.3 6.3-.3 1.1 1.1-.3z"/></svg>';

/** @type {HTMLAudioElement | null} */
let testRecPreviewAudio = null;
/** @type {string | null} */
let testRecPreviewUrl = null;
/** @type {string | null} */
let testRecPreviewId = null;

function stopTestRecordingPreview() {
  if (testRecPreviewAudio) {
    testRecPreviewAudio.pause();
    testRecPreviewAudio.onended = null;
    testRecPreviewAudio.onerror = null;
    testRecPreviewAudio = null;
  }
  if (testRecPreviewUrl) {
    URL.revokeObjectURL(testRecPreviewUrl);
    testRecPreviewUrl = null;
  }
  testRecPreviewId = null;
  document
    .querySelectorAll('.test-rec__icon[data-action="listen"].is-active')
    .forEach((el) => el.classList.remove("is-active"));
}

/** @param {{ id: string; blob: Blob }} rec @param {HTMLButtonElement | null | undefined} button */
function listenTestRecording(rec, button) {
  if (
    testRecPreviewId === rec.id &&
    testRecPreviewAudio &&
    !testRecPreviewAudio.paused
  ) {
    testRecPreviewAudio.pause();
    button?.classList.remove("is-active");
    return;
  }

  stopTestRecordingPreview();
  testRecPreviewUrl = URL.createObjectURL(rec.blob);
  testRecPreviewAudio = new Audio(testRecPreviewUrl);
  testRecPreviewId = rec.id;
  testRecPreviewAudio.onended = () => {
    button?.classList.remove("is-active");
    stopTestRecordingPreview();
  };
  testRecPreviewAudio.onerror = () => stopTestRecordingPreview();
  void testRecPreviewAudio.play().catch(() => stopTestRecordingPreview());
  button?.classList.add("is-active");
}

// --- Bestandstypes ---
function isImageFile(f) {
  if (f.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(f.name);
}

function isAudioFile(f) {
  if (f.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(f.name);
}

function isPlainTextDocument(f) {
  if (f.type === "text/plain") return true;
  return /\.(txt|md|markdown)$/i.test(f.name);
}

function isOfficeDocument(f) {
  if (
    f.type === "application/pdf" ||
    f.type.includes("wordprocessingml")
  ) {
    return true;
  }
  return /\.(docx|pdf)$/i.test(f.name);
}

function isTextDocument(f) {
  return isPlainTextDocument(f) || isOfficeDocument(f);
}

function getTextContent() {
  return textInput?.value.trim() ?? "";
}

function bumpInputGeneration() {
  inputGeneration++;
}

function hasValidAudio() {
  return state.audioBlob != null && state.audioBlob.size > 0;
}

/** @returns {Promise<IDBDatabase>} */
function openTestAudioDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(TEST_AUDIO_DB, TEST_AUDIO_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TEST_RECORDINGS_STORE)) {
        db.createObjectStore(TEST_RECORDINGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(LEGACY_BLOBS_STORE)) {
        db.createObjectStore(LEGACY_BLOBS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function migrateLegacyTestAudio(db) {
  if (!db.objectStoreNames.contains(LEGACY_BLOBS_STORE)) return;
  const legacy = await new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_BLOBS_STORE, "readonly");
    const req = tx.objectStore(LEGACY_BLOBS_STORE).get(LEGACY_MAIN_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!legacy?.blob?.size) return;
  const store = db.transaction(TEST_RECORDINGS_STORE, "readwrite").objectStore(
    TEST_RECORDINGS_STORE,
  );
  await new Promise((resolve, reject) => {
    const req = store.put({
      id: `rec-migrated-${Date.now()}`,
      name: legacy.name || "Opname (migrated)",
      kind: "upload",
      savedAt: legacy.savedAt ?? Date.now(),
      blob: legacy.blob,
    });
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_BLOBS_STORE, "readwrite");
    tx.objectStore(LEGACY_BLOBS_STORE).delete(LEGACY_MAIN_KEY);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/** @returns {Promise<{ id: string; name: string; kind: string; savedAt: number; blob?: Blob; photos?: { name: string; blob: Blob; mimeType?: string }[] }[]>} */
async function listTestRecordings() {
  try {
    const db = await openTestAudioDb();
    await migrateLegacyTestAudio(db);
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_RECORDINGS_STORE, "readonly");
      const req = tx.objectStore(TEST_RECORDINGS_STORE).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items
      .filter((item) => item?.blob?.size || item?.photos?.length)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  } catch {
    return [];
  }
}

/** @param {{ id: string; name: string; kind: "interview"|"upload"|"photo"|"realtime-qa"|"conversation"; blob?: Blob; transcript?: string; photos?: { name: string; blob: Blob; mimeType?: string }[]; savedAt?: number }} entry */
async function saveTestRecording(entry) {
  if (!state.keepInput) return;
  const hasTranscript = Boolean(String(entry.transcript || "").trim());
  if (!entry.blob?.size && !entry.photos?.length && !hasTranscript) return;
  try {
    const db = await openTestAudioDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_RECORDINGS_STORE, "readwrite");
      tx.objectStore(TEST_RECORDINGS_STORE).put({
        ...entry,
        savedAt: entry.savedAt ?? Date.now(),
      });
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await renderTestRecordingsPicker();
  } catch {
    /* testopslag is best-effort */
  }
}

/** @param {string} id */
async function deleteTestRecording(id) {
  if (testRecPreviewId === id) stopTestRecordingPreview();
  try {
    const db = await openTestAudioDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_RECORDINGS_STORE, "readwrite");
      tx.objectStore(TEST_RECORDINGS_STORE).delete(id);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await renderTestRecordingsPicker();
  } catch {
    /* ignore */
  }
}

/** @param {string} id @param {string} name */
async function updateTestRecordingName(id, name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const db = await openTestAudioDb();
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_RECORDINGS_STORE, "readonly");
      const req = tx.objectStore(TEST_RECORDINGS_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (
      !existing?.blob?.size &&
      !existing?.photos?.length &&
      !String(existing?.transcript || "").trim()
    ) {
      db.close();
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_RECORDINGS_STORE, "readwrite");
      tx.objectStore(TEST_RECORDINGS_STORE).put({ ...existing, name: trimmed });
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const cached = testRecordingsCache.find((rec) => rec.id === id);
    if (cached) cached.name = trimmed;
    await renderTestRecordingsPicker();
  } catch {
    /* ignore */
  }
}

/** @param {{ id: string; name: string }} rec @param {HTMLElement} row */
function startRenameTestRecording(rec, row) {
  const nameBtn = row.querySelector(".test-rec__name");
  if (!(nameBtn instanceof HTMLButtonElement)) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "test-rec__rename";
  input.value = rec.name;
  input.setAttribute("aria-label", "Omschrijving testopname");
  nameBtn.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const next = input.value.trim();
      if (next && next !== rec.name) {
        await updateTestRecordingName(rec.id, next);
        return;
      }
    }
    await renderTestRecordingsPicker();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener("blur", () => {
    void finish(true);
  });
}

/** @param {{ question: string; audioBlob: Blob | null; transcript?: string }[]} answers @param {{ partial?: boolean }} [opts] */
async function saveInterviewTestRecording(answers, { partial = false } = {}) {
  if (!state.keepInput) return;
  const blobs = answers.filter((a) => a?.audioBlob?.size).map((a) => a.audioBlob);
  if (!blobs.length) return;
  const combined = new Blob(blobs, { type: blobs[0]?.type || "audio/webm" });
  const stamp = new Date().toLocaleString("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const label = partial ? "Interview (deels)" : "Interview";
  await saveTestRecording({
    id: `rec-${Date.now()}`,
    name: `${label} ${stamp}`,
    kind: "interview",
    blob: combined,
  });
  showInputFeedback(`${label} opgeslagen in testmodus.`, "success");
}

/** @param {{ id: string; name: string; kind: string; blob?: Blob; photos?: { name: string; blob: Blob; mimeType?: string }[] }} rec */
function useTestPhotos(rec) {
  clearInputExcept("photo");
  for (const p of rec.photos ?? []) {
    if (!p.blob?.size) continue;
    const file = new File([p.blob], p.name || "foto.jpg", {
      type: p.mimeType || p.blob.type || "image/jpeg",
    });
    state.photos.push({
      id: `p-${++photoIdCounter}`,
      file,
      url: URL.createObjectURL(file),
    });
  }
  if (!state.photos.length) return;
  setActiveInputKind("photo");
  renderAttachments();
  updateProcessUi();
  hideInputFeedback();
}

/** @param {{ id: string; name: string; kind: string; blob?: Blob; photos?: { name: string; blob: Blob; mimeType?: string }[] }} rec */
function useTestLibraryItem(rec) {
  if (rec.kind === "photo" && rec.photos?.length) {
    useTestPhotos(rec);
    return;
  }
  if (rec.kind === "realtime-qa" || rec.kind === "conversation") {
    void useTestConversationTranscript(rec);
    return;
  }
  if (rec.blob?.size) useTestRecording(rec);
}

/** @param {{ id: string; name: string; kind: string; blob: Blob }} rec */
function useTestRecording(rec) {
  clearInputExcept("voice");
  state.audioBlob = rec.blob;
  state.audioName = rec.name.replace(/[^\w\s.-]/g, "").trim() || "testopname.webm";
  if (!state.audioName.includes(".")) state.audioName += ".webm";
  setActiveInputKind("voice");
  showAudioPreview(rec.blob);
  renderAttachments();
  updateProcessUi();
  hideInputFeedback();
}

/** @param {{ id: string; name: string; kind: string; blob?: Blob; transcript?: string; photos?: { name: string; blob: Blob; mimeType?: string }[] }} rec */
function startTestRecordingProcess(rec) {
  if (
    inputPanel?.classList.contains("is-input-busy") ||
    outputPanel?.classList.contains("is-busy")
  ) {
    return;
  }
  stopTestRecordingPreview();
  if (rec.kind === "realtime-qa" || rec.kind === "conversation") {
    void (async () => {
      const transcript = await readTestTranscript(rec);
      if (!transcript) {
        showInputFeedback("Geen transcript om te verwerken.", "error");
        return;
      }
      void processRealtimeConversationTranscript(transcript);
    })();
    return;
  }
  useTestLibraryItem(rec);
  void processReport();
}

async function renderTestRecordingsPicker() {
  if (!testRecordingsSection) return;

  const items = await listTestRecordings();
  testRecordingsCache = items;

  if (!state.keepInput || !items.length) {
    testRecordingsSection.hidden = true;
    if (testRecordingsList) testRecordingsList.innerHTML = "";
    return;
  }

  testRecordingsSection.hidden = false;
  if (!testRecordingsList) return;

  testRecordingsList.innerHTML = "";

  for (const rec of items) {
    const li = document.createElement("li");
    li.className = "test-rec";
    li.dataset.recId = rec.id;
    const isTranscriptKind = rec.kind === "realtime-qa" || rec.kind === "conversation";
    const listenBtn =
      rec.kind === "photo"
        ? ""
        : isTranscriptKind
          ? `<button type="button" class="test-rec__icon" data-action="view" data-rec-id="${escapeHtml(rec.id)}" title="Transcript bekijken" aria-label="Transcript bekijken">${TEST_REC_ICON_EDIT}</button>`
          : `<button type="button" class="test-rec__icon" data-action="listen" data-rec-id="${escapeHtml(rec.id)}" title="Afluisteren" aria-label="Afluisteren">${TEST_REC_ICON_PLAY}</button>`;
    li.innerHTML = `
      <button type="button" class="test-rec__name" title="Alleen laden in invoer">${escapeHtml(rec.name)}</button>
      <span class="test-rec__tools">
        <button type="button" class="test-rec__icon test-rec__icon--upload" data-action="upload" data-rec-id="${escapeHtml(rec.id)}" title="Zet MegaMinnie aan het werk" aria-label="Uploaden">${TEST_REC_ICON_UPLOAD}</button>
        ${listenBtn}
        <button type="button" class="test-rec__icon" data-action="rename" aria-label="Omschrijving wijzigen">${TEST_REC_ICON_EDIT}</button>
        <button type="button" class="test-rec__icon test-rec__icon--danger" data-action="delete" aria-label="Verwijderen">${TEST_REC_ICON_TRASH}</button>
      </span>`;

    li.querySelector(".test-rec__name")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      useTestLibraryItem(rec);
    });

    li.querySelector('[data-action="upload"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startTestRecordingProcess(rec);
    });

    li.querySelector('[data-action="listen"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      listenTestRecording(rec, e.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null);
    });

    li.querySelector('[data-action="view"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void useTestConversationTranscript(rec);
    });

    li.querySelector('[data-action="delete"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void deleteTestRecording(rec.id);
    });

    li.querySelector('[data-action="rename"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startRenameTestRecording(rec, li);
    });

    testRecordingsList.appendChild(li);
  }
}

/** @param {string} name */
function normalizePhotoFileName(name) {
  return (name || "foto.jpg").trim().toLowerCase();
}

/** @param {{ name: string }[]} photos */
function photoSetKey(photos) {
  return photos
    .map((p) => normalizePhotoFileName(p.name))
    .sort()
    .join("\0");
}

/** @param {{ name: string }[]} photos @param {{ kind: string; photos?: { name: string }[] }[] | null} [items] */
async function hasSavedPhotoSet(photos, items = null) {
  const list = items ?? (await listTestRecordings());
  const photoItems = list.filter((item) => item.kind === "photo" && item.photos?.length);
  if (!photoItems.length) return false;

  if (photos.length === 1) {
    const name = normalizePhotoFileName(photos[0].name);
    return photoItems.some((item) =>
      item.photos.some((p) => normalizePhotoFileName(p.name) === name),
    );
  }

  const key = photoSetKey(photos);
  return photoItems.some((item) => photoSetKey(item.photos) === key);
}

/** @param {{ file: File }[]} photos */
async function persistTestPhotos(photos) {
  if (!state.keepInput || !photos.length) return;
  const storedPhotos = photos.map((p) => ({
    name: p.file.name || "foto.jpg",
    blob: p.file,
    mimeType: p.file.type || "image/jpeg",
  }));
  if (await hasSavedPhotoSet(storedPhotos)) return;

  const stamp = new Date().toLocaleString("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const label =
    photos.length === 1
      ? photos[0].file.name.replace(/\.[^.]+$/, "") || "Foto"
      : `${photos.length} foto's`;
  await saveTestRecording({
    id: `rec-${Date.now()}`,
    name: `${label} (${stamp})`,
    kind: "photo",
    photos: storedPhotos,
  });
}

/** @param {Blob} blob @param {string} name */
async function persistTestAudio(blob, name) {
  if (!state.keepInput || !blob?.size) return;
  const stamp = new Date().toLocaleString("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  await saveTestRecording({
    id: `rec-${Date.now()}`,
    name: name?.trim() ? `${name} (${stamp})` : `Opname ${stamp}`,
    kind: "upload",
    blob,
  });
}

/** @param {{ id: string; name: string; kind: string; blob?: Blob; transcript?: string }} rec */
async function readTestTranscript(rec) {
  if (typeof rec.transcript === "string" && rec.transcript.trim()) {
    return rec.transcript.trim();
  }
  if (rec.blob?.size) {
    try {
      return (await rec.blob.text()).trim();
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Bewaar gesprekstranscript in testmodus (IndexedDB).
 * @param {string} transcript
 * @param {{ kind: "realtime-qa"|"conversation"; partial?: boolean }} opts
 */
async function persistConversationTranscript(transcript, { kind, partial = false }) {
  if (!state.keepInput) return;
  const cleaned = String(transcript || "").trim();
  if (!cleaned) return;
  const stamp = new Date().toLocaleString("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const label =
    kind === "realtime-qa"
      ? partial
        ? "Vraag & Antwoord (deels)"
        : "Vraag & Antwoord"
      : partial
        ? "Opname gesprek (deels)"
        : "Opname gesprek";
  await saveTestRecording({
    id: `rec-${Date.now()}`,
    name: `${label} ${stamp}`,
    kind,
    transcript: cleaned,
    blob: new Blob([cleaned], { type: "text/plain;charset=utf-8" }),
  });
  showInputFeedback(`${label} opgeslagen in testmodus.`, "success");
}

/** @param {{ id: string; name: string; kind: string; blob?: Blob; transcript?: string }} rec */
async function useTestConversationTranscript(rec) {
  const text = await readTestTranscript(rec);
  if (!text) {
    showInputFeedback("Geen transcript in dit testbestand.", "error");
    return;
  }
  clearInputExcept("text");
  if (textInput) textInput.value = text;
  showManualPanel();
  setActiveInputKind("text");
  hideInputFeedback();
  renderAttachments();
  updateProcessUi();
}

async function restoreTestAudio() {
  await renderTestRecordingsPicker();
}

/** @param {Blob} blob @param {string} [name] */
function rememberMainAudio(blob, name = "opname.webm") {
  state.audioBlob = blob;
  state.audioName = name;
  setActiveInputKind("voice");
  void persistTestAudio(blob, name);
}

/** @param {"photo"|"voice"|"text"} mode */
function setActiveInputKind(mode) {
  state.activeInputKind = mode;
  bumpInputGeneration();
}

/** Opname heeft altijd voorrang op foto's (voorkomt stille foto-verwerking). */
function isAudioReviewVisible() {
  return Boolean(audioReview && !audioReview.hidden);
}

/** Eén invoertype tegelijk: nieuwe invoer wist foto's, audio en tekst. */
/** @param {"photo"|"voice"|"text"} keep */
function clearInputExcept(keep) {
  if (keep !== "photo") {
    for (const p of state.photos) URL.revokeObjectURL(p.url);
    state.photos = [];
  }
  if (keep !== "voice") {
    state.audioBlob = null;
    state.audioName = "";
    state.mediaRecorder = null;
    state.recording = false;
    hideAudioReview();
    recordHint.textContent = "";
    recordHint.hidden = true;
    setInterviewButtonUi(false);
    resetRecordModeUi();
    if (isConversationActive()) cancelConversationRecording();
    if (isRealtimeConversationRunning()) stopRealtimeInterview();
  }
  if (keep !== "text") {
    if (textInput) textInput.value = "";
    state.documentNames = [];
  }
  state.lastResult = null;
  updateOutputVisibility();
  hideFeedback();
  hideInputFeedback();
  if (inputSummary) {
    inputSummary.hidden = true;
    inputSummary.innerHTML = "";
  }
  state.activeInputKind = keep;
  bumpInputGeneration();
}

/** @returns {"photo"|"voice"|"text"|null} */
function resolveInputMode() {
  if (hasValidAudio()) {
    state.activeInputKind = "voice";
    return "voice";
  }
  if (state.activeInputKind === "voice" || isAudioReviewVisible()) {
    state.activeInputKind = "voice";
    return null;
  }
  if (getTextContent() && state.activeInputKind === "text") {
    state.activeInputKind = "text";
    return "text";
  }
  if (state.photos.length) {
    state.activeInputKind = "photo";
    return "photo";
  }
  if (getTextContent()) {
    state.activeInputKind = "text";
    return "text";
  }
  state.activeInputKind = null;
  return null;
}

/** @param {"photo"|"voice"|"text"} mode */
function expectedSourceForMode(mode) {
  return mode === "text" ? "voice" : mode;
}

let preferredNlVoice = null;
let interviewVoiceUsesPitchBoost = false;

const MALE_VOICE_HINTS =
  /\bmale\b|\bman\b|david|mark\b|guy|george|ryan|maarten|frank|willem|bart|ruben|male\b/i;
const FEMALE_VOICE_HINTS =
  /\bfemale\b|vrouw|woman|colette|fleur|fenna|dena|nadine|maaike|helena|zira|hazel|sabina|anna|claire|linda|emma|lisa|lotte|noor|natural.*dutch/i;

function isLikelyFemaleVoice(voice) {
  const n = voice.name.toLowerCase();
  if (MALE_VOICE_HINTS.test(n)) return false;
  return FEMALE_VOICE_HINTS.test(n);
}

function loadInterviewVoices() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  const females = voices
    .filter((v) => v.lang.startsWith("nl") && isLikelyFemaleVoice(v))
    .sort((a, b) => {
      const score = (v) =>
        (/colette/i.test(v.name) ? 30 : 0) +
        (v.lang === "nl-NL" ? 10 : 0) +
        (/natural|neural|online/i.test(v.name) ? 5 : 0);
      return score(b) - score(a);
    });
  preferredNlVoice = females[0] || null;
  interviewVoiceUsesPitchBoost = !preferredNlVoice;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  loadInterviewVoices();
  window.speechSynthesis.onvoiceschanged = loadInterviewVoices;
}

async function ensureVoicesReady() {
  loadInterviewVoices();
  if (preferredNlVoice) return preferredNlVoice;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 80));
    loadInterviewVoices();
    if (preferredNlVoice) return preferredNlVoice;
  }
  return null;
}

async function ensureInterviewSpeech() {
  if (!window.speechSynthesis) {
    alert(
      "Gesproken interview vereist spraak in de browser. Gebruik Chrome of Edge en zet geluid aan.",
    );
    return false;
  }
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  await ensureVoicesReady();
  if (!preferredNlVoice) {
    showInputFeedback(
      "Geen vrouwenstem gevonden — standaardstem wordt gebruikt. Optioneel: installeer Colette (Nederlands) onder Windows → Spraak.",
      "info",
    );
  }
  return true;
}

/** @returns {Promise<void>} */
function speakInterviewText(text, { requireActive = true } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || (requireActive && !state.interview.active)) {
      resolve();
      return;
    }
    loadInterviewVoices();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "nl-NL";
    utter.rate = INTERVIEW_TTS_RATE;
    utter.pitch = interviewVoiceUsesPitchBoost ? 1.05 : 1.0;
    if (preferredNlVoice) {
      utter.voice = preferredNlVoice;
    }
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

function interviewSpeechPauseFor(text) {
  if (/[.!?]\s*$/.test(text)) return INTERVIEW_TTS_PAUSE_PUNCTUATION_MS;
  return INTERVIEW_TTS_PAUSE_MS;
}

async function speakAndWait(text, { requireActive = true } = {}) {
  if (requireActive && !state.interview.active) return;
  window.speechSynthesis?.cancel();
  await new Promise((r) => setTimeout(r, 80));
  if (requireActive && !state.interview.active) return;
  state.interview.speaking = true;
  renderInterviewUi();
  await speakInterviewText(text, { requireActive });
  if (!requireActive || state.interview.active) {
    await new Promise((r) => setTimeout(r, interviewSpeechPauseFor(text)));
  }
  state.interview.speaking = false;
  renderInterviewUi();
}

function buildReviewSpeechPlan() {
  /** @type {string[]} */
  const chunks = [];
  /** @type {string[]} */
  const chunkParagraphKeys = [];

  /** @param {string} text @param {string} key */
  const addText = (text, key) => {
    for (const chunk of splitSpeechChunks(text)) {
      chunks.push(chunk);
      chunkParagraphKeys.push(key);
    }
  };

  const title = getNoteTitle();
  if (title) addText(`Titel: ${title}.`, "title");

  const body = getNoteBodyForSpeech();
  const titleNorm = title.toLowerCase().replace(/\s+/g, " ").trim();
  const paragraphs = splitNoteBodyForSpeech(body).filter((para) => {
    const paraNorm = para
      .replace(/\*\*/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    return !titleNorm || paraNorm !== titleNorm;
  });

  if (paragraphs.length) {
    paragraphs.forEach((para, i) => {
      const prefix = i === 0 ? "Notitie: " : "";
      addText(`${prefix}${para}`, `body:${i}`);
    });
  } else if (body.trim()) {
    addText(`Notitie: ${body.trim()}`, "body:0");
  }

  document.querySelectorAll("#tasks-list .card-list__item").forEach((li, i) => {
    const subject = li.querySelector(".task-subject")?.value.trim();
    if (!subject) return;
    const desc = li.querySelector(".task-description")?.value.trim();
    const assignee = li.querySelector(".task-assignee")?.value.trim();
    let line = `Taak ${i + 1}: ${subject}`;
    if (assignee) line += `, verantwoordelijke ${assignee}`;
    if (desc) line += `. ${desc}`;
    addText(`${line}.`, `task:${i}`);
  });

  document.querySelectorAll("#events-list .card-list__item").forEach((li, i) => {
    const subject = li.querySelector(".event-subject")?.value.trim();
    if (!subject) return;
    const location = li.querySelector(".event-location")?.value.trim();
    const desc = li.querySelector(".event-description")?.value.trim();
    let line = `Agenda-item ${i + 1}: ${subject}`;
    if (location) line += `, locatie ${location}`;
    if (desc) line += `. ${desc}`;
    addText(`${line}.`, `event:${i}`);
  });

  return { chunks, chunkParagraphKeys };
}

function buildReviewSpeechText() {
  return buildReviewSpeechPlan().chunks.join(" ");
}

/** @param {{ resumeIndex: number; paragraphKey: string | null }} suspend @param {string[]} keys @param {number} chunkCount @param {{ advanceIfEmpty?: boolean }} [opts] */
function resolveReviewResumeChunkIndex(suspend, keys, chunkCount, opts = {}) {
  if (opts.advanceIfEmpty) {
    return Math.min(suspend.resumeIndex + 1, Math.max(0, chunkCount - 1));
  }
  if (suspend.paragraphKey) {
    const paragraphStart = keys.indexOf(suspend.paragraphKey);
    if (paragraphStart >= 0) return paragraphStart;
  }
  return Math.max(0, Math.min(suspend.resumeIndex, Math.max(0, chunkCount - 1)));
}

function normalizeReviewSpeechEchoText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} text */
function isLikelyReviewTtsEcho(text) {
  const spoken = normalizeReviewSpeechEchoText(state.reviewPlayback.lastSpokenChunk);
  const candidate = normalizeReviewSpeechEchoText(text);
  if (!spoken || !candidate) return false;
  if (spoken.includes(candidate) || candidate.includes(spoken)) return true;
  const spokenWords = new Set(spoken.split(" ").filter((w) => w.length > 3));
  const candidateWords = candidate.split(" ").filter((w) => w.length > 3);
  if (!candidateWords.length) return false;
  const overlap = candidateWords.filter((w) => spokenWords.has(w)).length;
  return overlap / candidateWords.length >= 0.6;
}

/** @param {string} text */
function splitSpeechChunks(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+/g);
  if (sentences?.length) {
    /** @type {string[]} */
    const chunks = [];
    let buf = "";
    const maxLen = (chunkIndex) => (chunkIndex === 0 ? 120 : 320);
    let chunkIndex = 0;
    for (const sentence of sentences) {
      const limit = maxLen(chunkIndex);
      if (buf && (buf + sentence).length > limit) {
        chunks.push(buf.trim());
        buf = sentence;
        chunkIndex = chunks.length;
      } else {
        buf += sentence;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  return splitSpeechChunksByLines(normalized);
}

/** @param {string} text */
function splitSpeechChunksByLines(text) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return splitSpeechChunksByLength(text);
  }

  /** @type {string[]} */
  const chunks = [];
  let buf = "";
  const maxLen = (chunkIndex) => (chunkIndex === 0 ? 120 : 320);
  let chunkIndex = 0;
  for (const line of lines) {
    const limit = maxLen(chunkIndex);
    const candidate = buf ? `${buf}\n${line}` : line;
    if (buf && candidate.length > limit) {
      chunks.push(buf);
      buf = line;
      chunkIndex = chunks.length;
    } else {
      buf = candidate;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.length ? chunks : splitSpeechChunksByLength(text);
}

/** @param {string} text @param {number} [maxLen] */
function splitSpeechChunksByLength(text, maxLen = 320) {
  if (text.length <= maxLen) return [text];
  /** @type {string[]} */
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + 40) end = space;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

/** @param {string} body */
function splitNoteBodyForSpeech(body) {
  const cleaned = body.replace(/\*\*/g, "").trim();
  if (!cleaned) return [];

  let blocks = cleaned
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length <= 1 && cleaned.includes("\n")) {
    /** @type {string[]} */
    const lineBlocks = [];
    const lines = cleaned.split(/\n/).map((line) => line.trim());
    let current = "";
    for (const line of lines) {
      if (!line) continue;
      const isHeader = /^[^\n:]{2,64}:$/.test(line);
      if (isHeader && current) {
        lineBlocks.push(current.trim());
        current = line;
      } else if (isHeader) {
        current = line;
      } else if (current) {
        current += `\n${line}`;
      } else {
        current = line;
      }
    }
    if (current.trim()) lineBlocks.push(current.trim());
    if (lineBlocks.length > 1) blocks = lineBlocks;
  }

  return blocks.length ? blocks : [cleaned];
}

function prefetchReviewSpeech() {
  if (!hasUitgewerktResult()) return;
  const plan = buildReviewSpeechPlan();
  if (plan.chunks[0]) void prefetchOpenAiSpeech(plan.chunks[0]);
  if (plan.chunks[1]) void prefetchOpenAiSpeech(plan.chunks[1]);
}

function updateReviewStatus(message) {
  if (!reviewStatus) return;
  reviewStatus.textContent = message;
  reviewStatus.hidden = !message;
}

function isReviewInlineListening() {
  return Boolean(
    reviewInlineListenController?.isActive() || reviewInlineListenController?.isConnecting(),
  );
}

function isSupplementVoiceListening() {
  return Boolean(
    supplementRealtimeController?.isActive() || supplementRealtimeController?.isConnecting(),
  );
}

function resetReviewInlineCorrectionState() {
  if (reviewInlineCorrection.debounceTimer) {
    clearTimeout(reviewInlineCorrection.debounceTimer);
    reviewInlineCorrection.debounceTimer = null;
  }
  if (reviewInlineCorrection.resumeTimer) {
    clearTimeout(reviewInlineCorrection.resumeTimer);
    reviewInlineCorrection.resumeTimer = null;
  }
  if (reviewInlineCorrection.interruptConfirmTimer) {
    clearTimeout(reviewInlineCorrection.interruptConfirmTimer);
    reviewInlineCorrection.interruptConfirmTimer = null;
  }
  reviewInlineCorrection.active = false;
  reviewInlineCorrection.pendingInterrupt = false;
  reviewInlineCorrection.enteredViaCommand = false;
  reviewInlineCorrection.segments = [];
  reviewInlineCorrection.flushedSegmentCount = 0;
  reviewInlineCorrection.applyInFlight = false;
  reviewInlineCorrection.finalizeInFlight = false;
  reviewInlineCorrection.echoGraceUntil = 0;
}

function cancelPendingSpeechInterrupt({ resumePlayback = true } = {}) {
  if (reviewInlineCorrection.interruptConfirmTimer) {
    clearTimeout(reviewInlineCorrection.interruptConfirmTimer);
    reviewInlineCorrection.interruptConfirmTimer = null;
  }
  reviewInlineCorrection.pendingInterrupt = false;
  if (reviewInlineCorrection.active) return;
  if (!resumePlayback || !state.reviewPlayback.active) return;

  if (state.reviewPlayback.suspendForCorrection) {
    state.reviewPlayback.suspendForCorrection = null;
    state.reviewPlayback.paused = false;
    const player = reviewSpeechPlayer;
    if (player?.isActive?.() && player?.isPaused?.()) {
      player.resume();
    }
    updateReviewUi();
    updateReviewStatus(REVIEW_PLAYBACK_STATUS);
    return;
  }

  if (state.reviewPlayback.paused) {
    resumeReviewPlayback();
  }
}

const INLINE_CORRECTION_ECHO_GRACE_MS = 1500;

function beginInlineCorrection() {
  if (reviewInlineCorrection.active) return;
  reviewInlineCorrection.active = true;
  reviewInlineCorrection.pendingInterrupt = false;
  // Grace-periode: negeer onTurn-segmenten die binnenkomen vlak na activatie.
  // Dit filtert TTS-echobuffers die nog in de Realtime API-pipeline zitten.
  reviewInlineCorrection.echoGraceUntil = Date.now() + INLINE_CORRECTION_ECHO_GRACE_MS;
  if (!state.reviewPlayback.suspendForCorrection) {
    captureReviewPlaybackForCorrection();
  }
  updateReviewStatus("Corrigeren — spreek je aanpassing in…");
  updateVoiceCorrectUi();
  void ensureReviewInlineListen();
}

function updateVoiceCorrectUi() {
  const correcting = reviewInlineCorrection.active;
  const rec =
    correcting ||
    (isSupplementVoiceListening() && !isReviewInlineListening());
  btnVoiceCorrect?.classList.toggle("is-recording", rec);
  btnVoiceCorrect?.setAttribute("aria-pressed", rec ? "true" : "false");
  let label = "Mondeling corrigeren";
  if (rec && !correcting) {
    label = "Stoppen & verwerken";
  } else if (correcting) {
    label = "Stoppen & verder voorlezen";
  } else if (
    REVIEW_INLINE_LISTEN_ENABLED &&
    state.reviewPlayback.active &&
    isReviewInlineListening()
  ) {
    label = 'Spreek "Correctie" of je aanpassing in';
  }
  btnVoiceCorrect?.setAttribute("aria-label", label);
  btnVoiceCorrect?.setAttribute("title", label);
  const processingBusy = outputPanel?.classList.contains("is-busy");
  const playbackOnly =
    state.reviewPlayback.active &&
    !REVIEW_INLINE_LISTEN_ENABLED &&
    !correcting;
  btnVoiceCorrect?.toggleAttribute("disabled", Boolean(processingBusy) || playbackOnly);
}

/** @param {VisitReportResult} result */
function applyReportFieldsFromResult(result) {
  setNoteTitle(result.megaMinnie.salesforceNote.title);
  setNoteBodyMarkdown(result.megaMinnie.salesforceNote.body);
  renderTasksAndEvents(result, state.defaultAccountManager);
  state.lastResult = result;
}

async function applyInlineCorrectionToReport(supplementText) {
  const existing = getExistingMegaMinnieFromUi();
  if (!existing) {
    showFeedback("Notitietitel en -tekst mogen niet leeg zijn.", "error");
    return null;
  }
  if (!supplementText.trim()) return null;

  const fd = formFields();
  fd.append("existing", JSON.stringify(existing));
  fd.append("supplementText", supplementText.trim());
  // Geef aan dat dit een gesproken correctie-instructie is, geen nieuwe aanvulling.
  fd.append("supplementSource", "correction");
  const result = await apiPost("/api/visit-report/extend", {
    method: "POST",
    body: fd,
  });
  applyReportFieldsFromResult({ ...result, transcript: supplementText.trim() });
  return result;
}

function waitForInlineCorrectionApply() {
  if (!reviewInlineCorrection.applyInFlight) return Promise.resolve();
  return new Promise((resolve) => {
    const tick = () => {
      if (!reviewInlineCorrection.applyInFlight) {
        resolve();
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

function beginReviewPlaybackSession() {
  reviewPlaybackSessionId += 1;
  return reviewPlaybackSessionId;
}

function invalidateReviewPlaybackSession() {
  reviewPlaybackSessionId += 1;
}

function isCurrentReviewPlaybackSession(sessionId) {
  return sessionId === reviewPlaybackSessionId;
}

/** @param {number} sessionId @param {{ skipInlineListenStop?: boolean }} [opts] */
function finishReviewPlaybackSession(sessionId, opts = {}) {
  if (!isCurrentReviewPlaybackSession(sessionId)) return;
  const _fStack = new Error().stack?.split("\n").slice(1, 5).join(" → ") ?? "";
  console.debug(
    `[correctie] finishReviewPlaybackSession | correctionActive=${reviewInlineCorrection.active} | finalizeInFlight=${reviewInlineCorrection.finalizeInFlight} | suspend=${JSON.stringify(state.reviewPlayback.suspendForCorrection)} | stack: ${_fStack}`,
  );
  if (!opts.skipInlineListenStop) {
    stopReviewInlineListen();
  }
  if (!reviewInlineCorrection.active && !state.reviewPlayback.suspendForCorrection) {
    supplementRealtimeController?.stop("");
  }
  state.reviewPlayback.active = false;
  state.reviewPlayback.paused = false;
  state.reviewPlayback.suppressLoopCleanup = false;
  updateReviewUi();
}

function clearInlineCorrectionTranscript() {
  reviewInlineCorrection.segments = [];
  reviewInlineCorrection.flushedSegmentCount = 0;
}

/** @returns {Promise<boolean>} */
async function flushAllInlineCorrectionSegments() {
  if (reviewInlineCorrection.debounceTimer) {
    clearTimeout(reviewInlineCorrection.debounceTimer);
    reviewInlineCorrection.debounceTimer = null;
  }
  await waitForInlineCorrectionApply();
  while (reviewInlineCorrection.flushedSegmentCount < reviewInlineCorrection.segments.length) {
    const ok = await flushInlineCorrection({ final: true });
    if (!ok) return false;
  }
  return true;
}

function scheduleInlineCorrectionApply() {
  if (reviewInlineCorrection.debounceTimer) {
    clearTimeout(reviewInlineCorrection.debounceTimer);
  }
  reviewInlineCorrection.debounceTimer = setTimeout(() => {
    reviewInlineCorrection.debounceTimer = null;
    void flushInlineCorrection({ final: false });
  }, 450);
}

/** @returns {Promise<boolean>} */
async function flushInlineCorrection({ final = false } = {}) {
  if (reviewInlineCorrection.applyInFlight) {
    if (!final) return false;
    await waitForInlineCorrectionApply();
  }

  const newParts = reviewInlineCorrection.segments.slice(
    reviewInlineCorrection.flushedSegmentCount,
  );
  const supplementText = newParts.join(" ").trim();
  if (!supplementText) return true;

  reviewInlineCorrection.applyInFlight = true;
  updateReviewStatus("Tekst bijwerken…");
  try {
    const result = await applyInlineCorrectionToReport(supplementText);
    if (!result) return false;
    reviewInlineCorrection.flushedSegmentCount = reviewInlineCorrection.segments.length;
    updateReviewStatus(
      reviewInlineCorrection.active
        ? 'Tekst bijgewerkt — spreek verder of zeg "Voorlezen"'
        : "",
    );
    return true;
  } catch (err) {
    showFeedback(
      err instanceof Error ? err.message : "Live correctie mislukt",
      "error",
    );
    return false;
  } finally {
    reviewInlineCorrection.applyInFlight = false;
  }
}

function handleReviewCorrectieCommand(opts = {}) {
  if (!REVIEW_INLINE_LISTEN_ENABLED) return;
  if (!state.reviewPlayback.active || reviewInlineCorrection.finalizeInFlight) {
    console.debug(
      `[correctie] handleReviewCorrectieCommand GEBLOKKEERD | pbActive=${state.reviewPlayback.active} | finalizeInFlight=${reviewInlineCorrection.finalizeInFlight} | corrActive=${reviewInlineCorrection.active}`,
    );
    return;
  }
  if (reviewInlineCorrection.active) return;

  if (reviewInlineCorrection.resumeTimer) {
    clearTimeout(reviewInlineCorrection.resumeTimer);
    reviewInlineCorrection.resumeTimer = null;
  }
  if (reviewInlineCorrection.interruptConfirmTimer) {
    clearTimeout(reviewInlineCorrection.interruptConfirmTimer);
    reviewInlineCorrection.interruptConfirmTimer = null;
  }
  reviewInlineCorrection.pendingInterrupt = false;

  if (!state.reviewPlayback.suspendForCorrection) {
    captureReviewPlaybackForCorrection();
  } else if (!state.reviewPlayback.paused) {
    pauseReviewPlayback();
  }

  reviewInlineCorrection.enteredViaCommand = opts.viaCommand !== false;
  beginInlineCorrection();
}

function appendInlineCorrectionSegment(text) {
  const cleaned = stripReviewVoiceCommand(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  const last = reviewInlineCorrection.segments[reviewInlineCorrection.segments.length - 1];
  if (last && last.toLowerCase() === cleaned.toLowerCase()) return;
  reviewInlineCorrection.segments.push(cleaned);
  scheduleInlineCorrectionApply();
}

function maybeHandleReviewVoiceCommand(text) {
  if (!state.reviewPlayback.active) return false;
  const cmd = detectReviewVoiceCommand(text);
  if (!cmd) return false;

  if (state.reviewPlayback.ttsActive) {
    const remainder = stripReviewVoiceCommand(text).replace(/\s+/g, " ").trim();
    if (cmd !== "correctie" && cmd !== "voorlezen" && remainder && isLikelyReviewTtsEcho(remainder)) {
      return false;
    }
    if (cmd === "voorlezen" && isLikelyReviewTtsEcho(text)) return false;
  } else if (isLikelyReviewTtsEcho(text)) {
    return false;
  }

  if (cmd === "correctie") {
    const alreadyActive = reviewInlineCorrection.active;
    handleReviewCorrectieCommand();
    if (alreadyActive) {
      // Correctie was al actief (bijv. herhaalde detectie via onTranscriptUpdate-delta's).
      // Geef false terug zodat de aanroeper de tekst zelf kan verwerken via
      // appendInlineCorrectionSegment + scheduleInlineCorrectionResume, en voorkomen
      // dat groeiende delta-tekst steeds opnieuw wordt toegevoegd.
      return false;
    }
    const remainder = stripReviewVoiceCommand(text).replace(/\s+/g, " ").trim();
    if (remainder) appendInlineCorrectionSegment(remainder);
    // true als er tekst is (één uiting "Correctie [tekst]"); false als alleen "Correctie"
    return Boolean(remainder);
  }
  if (cmd === "voorlezen") {
    void handleReviewVoorlezenCommand();
    return true;
  }
  return false;
}

/** @param {{ pendingUserText?: string; transcript?: string }} [ctx] */
function tryHandleReviewVoiceCommandFromContext(ctx = {}) {
  const pending = String(ctx.pendingUserText || "").trim();
  if (pending && maybeHandleReviewVoiceCommand(pending)) return true;
  const fromTranscript = extractLastRealtimeUserText(ctx.transcript || "");
  if (fromTranscript && fromTranscript !== pending && maybeHandleReviewVoiceCommand(fromTranscript)) {
    return true;
  }
  return false;
}

async function handleReviewVoorlezenCommand() {
  if (!state.reviewPlayback.active) return;

  if (reviewInlineCorrection.resumeTimer) {
    clearTimeout(reviewInlineCorrection.resumeTimer);
    reviewInlineCorrection.resumeTimer = null;
  }

  if (reviewInlineCorrection.active) {
    await finalizeInlineCorrectionAndResume();
    return;
  }

  if (state.reviewPlayback.suspendForCorrection) {
    resumeReviewPlaybackInPlace();
    return;
  }

  if (state.reviewPlayback.paused) {
    resumeReviewPlayback();
  }
}

function handleReviewInlineSpeechStarted() {
  if (!REVIEW_INLINE_LISTEN_ENABLED || !state.reviewPlayback.active) return;
  // Als correctiemodus actief is, keer terug VÓÓR de timercancellatie.
  // De timer mag alleen worden gereset door handleReviewInlineUserTurn (echte spraak)
  // en nooit door achtergrondgeluid of echo.
  if (
    reviewInlineCorrection.active ||
    reviewInlineCorrection.finalizeInFlight
  ) {
    return;
  }
  if (reviewInlineCorrection.resumeTimer) {
    clearTimeout(reviewInlineCorrection.resumeTimer);
    reviewInlineCorrection.resumeTimer = null;
  }
  if (reviewInlineCorrection.pendingInterrupt) return;

  // Tijdens actieve TTS-uitvoer negeren we speech_started: de microfoon pikt
  // de speaker-audio op als echo. Alleen expliciete "Correctie"-commando's
  // (via onSpeechStopped) mogen het voorlezen onderbreken.
  if (state.reviewPlayback.ttsActive) return;
}

/** @param {string} text */
function handleReviewInlineUserTurn(text) {
  console.debug(
    `[correctie] userTurn | text="${text.slice(0, 60)}" | corrActive=${reviewInlineCorrection.active} | segments=${reviewInlineCorrection.segments.length}`,
  );
  if (maybeHandleReviewVoiceCommand(text)) {
    // Commando afgehandeld (bijv. "Correctie [tekst]" als één uiting). Zorg dat de
    // hervatting ingepland wordt als correctie actief is, ook al is de tekst al
    // toegevoegd via appendInlineCorrectionSegment in maybeHandleReviewVoiceCommand.
    if (reviewInlineCorrection.active) scheduleInlineCorrectionResume();
    return;
  }
  if (!reviewInlineCorrection.active) return;
  // Grace-periode na activatie: negeer onTurn-segmenten die TTS-echobuffer zijn.
  if (Date.now() < reviewInlineCorrection.echoGraceUntil) {
    console.debug(`[correctie] userTurn GENEGEERD (echo grace): "${text.slice(0, 50)}"`);
    return;
  }
  // Als de correctietekst al is ingediend (flushedSegmentCount > 0 en timer loopt), geen
  // verdere segmenten accepteren van ruis/echo — spiegelt de guard in speechStopped.
  if (reviewInlineCorrection.flushedSegmentCount > 0 && reviewInlineCorrection.resumeTimer) {
    return;
  }
  appendInlineCorrectionSegment(text);
  // Plan de hervatting direct vanuit de onTurn-route (betrouwbaar bij create_response:false),
  // onafhankelijk van of onSpeechStopped de resume-timer al heeft gezet.
  scheduleInlineCorrectionResume();
}

function setReviewPlaybackTtsActive(ttsActive) {
  state.reviewPlayback.ttsActive = ttsActive;
}

function scheduleInlineCorrectionResume() {
  const _stack = new Error().stack?.split("\n").slice(2, 4).join(" → ") ?? "";
  console.debug(
    `[correctie] scheduleInlineCorrectionResume | segments=${reviewInlineCorrection.segments.length} | flushed=${reviewInlineCorrection.flushedSegmentCount} | timerActief=${Boolean(reviewInlineCorrection.resumeTimer)} | via: ${_stack}`,
  );
  if (reviewInlineCorrection.resumeTimer) {
    clearTimeout(reviewInlineCorrection.resumeTimer);
  }
  const delay =
    reviewInlineCorrection.segments.length > 0 || reviewInlineCorrection.enteredViaCommand
      ? INLINE_CORRECTION_RESUME_MS
      : INLINE_CORRECTION_EMPTY_RESUME_MS;
  reviewInlineCorrection.resumeTimer = setTimeout(() => {
    reviewInlineCorrection.resumeTimer = null;
    void finalizeInlineCorrectionAndResume();
  }, delay);
}

/** @param {{ pendingUserText?: string; transcript?: string }} [ctx] */
function handleReviewInlineSpeechStopped(ctx = {}) {
  const pending0 = String(ctx.pendingUserText || "").trim();
  console.debug(
    `[correctie] speechStopped | pending="${pending0}" | corrActive=${reviewInlineCorrection.active} | pbActive=${state.reviewPlayback.active} | segments=${reviewInlineCorrection.segments.length} | flushed=${reviewInlineCorrection.flushedSegmentCount}`,
  );
  const handledCommand = tryHandleReviewVoiceCommandFromContext(ctx);

  if (reviewInlineCorrection.pendingInterrupt && !reviewInlineCorrection.active) {
    cancelPendingSpeechInterrupt({ resumePlayback: !handledCommand });
  }

  if (handledCommand) {
    // Zorg dat hervatting ingepland wordt als correctie actief is geworden (bijv.
    // "Correctie [tekst]" als één uiting — de tekst is al toegevoegd in
    // maybeHandleReviewVoiceCommand maar scheduleInlineCorrectionResume is nog niet aangeroepen).
    console.debug(`[correctie] speechStopped → handledCommand=true | corrActive=${reviewInlineCorrection.active}`);
    if (reviewInlineCorrection.active) scheduleInlineCorrectionResume();
    return;
  }

  if (!reviewInlineCorrection.active || reviewInlineCorrection.finalizeInFlight) return;
  if (reviewInlineCorrection.debounceTimer) {
    clearTimeout(reviewInlineCorrection.debounceTimer);
    reviewInlineCorrection.debounceTimer = null;
  }
  const pending = String(ctx.pendingUserText || "").trim();
  // Grace-periode na activatie: negeer segmenten die TTS-echobuffer zijn.
  if (pending && Date.now() < reviewInlineCorrection.echoGraceUntil) {
    console.debug(`[correctie] speechStopped GENEGEERD (echo grace): "${pending.slice(0, 50)}"`);
  } else if (pending) {
    appendInlineCorrectionSegment(pending);
  }
  void flushInlineCorrection({ final: false });
  updateReviewStatus(
    reviewInlineCorrection.segments.length === 0
      ? "Corrigeren — spreek je aanpassing in…"
      : 'Luistert — spreek verder of zeg "Voorlezen"',
  );
  // Als de correctietekst al is ingediend (flushedSegmentCount > 0), mag de herstelTimer
  // niet worden gereset door achtergrondgeluid of TTS-echo's van het hervatte voorlezen.
  // De timer wordt alleen opnieuw gepland als er nog geen lopende timer is.
  // Dit voorkomt dat bij meerdere correcties de hervatting steeds wordt uitgesteld.
  if (reviewInlineCorrection.flushedSegmentCount > 0 && reviewInlineCorrection.resumeTimer) {
    return;
  }
  scheduleInlineCorrectionResume();
}

async function finalizeInlineCorrectionAndResume() {
  if (!reviewInlineCorrection.active || reviewInlineCorrection.finalizeInFlight) return;
  reviewInlineCorrection.finalizeInFlight = true;
  const hadSegments = reviewInlineCorrection.segments.length > 0;
  const enteredViaCommand = reviewInlineCorrection.enteredViaCommand;
  const advanceIfEmpty = !hadSegments && !enteredViaCommand;
  if (reviewInlineCorrection.resumeTimer) {
    clearTimeout(reviewInlineCorrection.resumeTimer);
    reviewInlineCorrection.resumeTimer = null;
  }

  console.debug(
    `[correctie] finalizeInlineCorrectionAndResume start | hadSegments=${hadSegments} | suspend=${JSON.stringify(state.reviewPlayback.suspendForCorrection)} | playerActive=${reviewSpeechPlayer?.isActive?.()} | pbActive=${state.reviewPlayback.active}`,
  );

  const flushOk = await flushAllInlineCorrectionSegments();
  if (hadSegments && !flushOk) {
    console.debug("[correctie] FOUT: flush mislukt, annuleer hervatting");
    reviewInlineCorrection.finalizeInFlight = false;
    updateReviewStatus("Correctie mislukt — spreek opnieuw of zeg \"Voorlezen\"");
    updateVoiceCorrectUi();
    return;
  }

  clearInlineCorrectionTranscript();
  reviewInlineCorrection.active = false;
  reviewInlineCorrection.pendingInterrupt = false;
  reviewInlineCorrection.enteredViaCommand = false;
  updateVoiceCorrectUi();

  if (!state.reviewPlayback.suspendForCorrection) {
    console.debug("[correctie] PROBLEEM: suspendForCorrection is null na flush → geen hervatting");
    reviewInlineCorrection.finalizeInFlight = false;
    return;
  }

  try {
    const resumed = resumeReviewPlaybackInPlace({ advanceIfEmpty });
    console.debug(
      `[correctie] resumeReviewPlaybackInPlace → ${resumed} | playerActive=${reviewSpeechPlayer?.isActive?.()} | pbActive=${state.reviewPlayback.active} | playerIndex=${reviewSpeechPlayer?.getCurrentIndex?.()}`,
    );
    if (!resumed) {
      console.debug("[correctie] in-place mislukt, start nieuw afspeelsessie");
      invalidateReviewPlaybackSession();
      state.reviewPlayback.suppressLoopCleanup = true;
      abortReviewPlaybackLoop();
      await resumeReviewPlaybackAfterCorrection({ advanceIfEmpty });
    }
    void ensureReviewInlineListen();
    if (state.reviewPlayback.active) {
      updateReviewStatus(REVIEW_PLAYBACK_STATUS);
    }
  } finally {
    reviewInlineCorrection.finalizeInFlight = false;
  }
}

/** @param {{ advanceIfEmpty?: boolean }} [opts] */
function resumeReviewPlaybackInPlace(opts = {}) {
  const suspend = state.reviewPlayback.suspendForCorrection;
  if (!suspend) return false;

  const plan = buildReviewSpeechPlan();
  if (!plan.chunks.length) return false;

  const newIndex = resolveReviewResumeChunkIndex(
    suspend,
    plan.chunkParagraphKeys,
    plan.chunks.length,
    opts,
  );
  void prefetchOpenAiSpeech(plan.chunks[newIndex]);
  if (plan.chunks[newIndex + 1]) void prefetchOpenAiSpeech(plan.chunks[newIndex + 1]);

  // Controleer of de speler nog actief is VOORDAT suspend wordt gewist.
  // Als de speler inactief is (bijv. WebRTC-verbinding verbroken), moet
  // suspendForCorrection intact blijven zodat resumeReviewPlaybackAfterCorrection
  // het kan gebruiken om een nieuwe afspeelsessie te starten.
  const player = ensureReviewSpeechPlayer();
  if (!player.isActive()) return false;

  state.reviewPlayback.suspendForCorrection = null;
  state.reviewPlayback.chunks = plan.chunks;
  state.reviewPlayback.chunkParagraphKeys = plan.chunkParagraphKeys;
  state.reviewPlayback.index = newIndex;
  state.reviewPlayback.paused = false;
  state.reviewPlayback.cancelled = false;
  state.reviewPlayback.lastSpokenChunk = plan.chunks[newIndex] ?? "";

  if (!player.resumeAfterCorrection(plan.chunks, newIndex)) return false;

  updateReviewUi();
  updateReviewStatus(REVIEW_PLAYBACK_STATUS);
  return true;
}

async function startReviewInlineListen() {
  if (!REVIEW_INLINE_LISTEN_ENABLED || !realtimeInterviewEnabled || !reviewInlineListenController) {
    return;
  }
  if (isReviewInlineListening()) return;
  await reviewInlineListenController.start({
    listenOnly: true,
    passiveListen: true,
    correctionDialogue: false,
  });
}

async function ensureReviewInlineListen() {
  if (!REVIEW_INLINE_LISTEN_ENABLED) return;
  if (!state.reviewPlayback.active || !realtimeInterviewEnabled) return;
  if (isReviewInlineListening()) return;
  try {
    await startReviewInlineListen();
  } catch {
    /* onError handler retries */
  }
}

function stopReviewRealtimeSessions() {
  reviewInlineListenController?.stop("");
  supplementRealtimeController?.stop("");
}

async function prepareForRealtimeQaStart() {
  if (realtimeFinishCheckTimer) {
    clearTimeout(realtimeFinishCheckTimer);
    realtimeFinishCheckTimer = null;
  }
  realtimeAutoFinishing = false;
  stopReviewPlayback();
  stopReviewRealtimeSessions();
  if (realtimeController?.isConnecting()) {
    realtimeController.stop("");
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function startRealtimeQaConversation() {
  if (!realtimeInterviewEnabled) {
    if (state.interview.active) {
      cancelInterview();
      return;
    }
    if (isConversationActive()) cancelConversationRecording();
    if (isRealtimeConversationRunning()) stopRealtimeInterview();
    resetRecordModeUi();
    void startInterview();
    return;
  }

  conversationPanelMode = "realtime-qa";
  if (state.interview.active) cancelInterview();
  if (isConversationActive()) cancelConversationRecording();

  if (realtimeController?.isConnecting()) {
    setConversationStatus("Vraag & Antwoord verbinden…");
    return;
  }

  if (isRealtimeConversationRunning()) {
    finalizeRealtimeQaConversation({ fromVoice: true });
    return;
  }

  await prepareForRealtimeQaStart();
  showInterviewPanel(false);
  void prefetchOpenAiSpeech(REALTIME_QA_OPENING_TEXT);
  lastRealtimeTranscript = "";
  beginRealtimeQaDraft();
  setConversationStatus(`MegaMinnie: ${REALTIME_QA_OPENING_TEXT}…`);
  const openingPromise = playOpenAiSpeechOnce(REALTIME_QA_OPENING_TEXT);
  try {
    const started = await realtimeController?.start({ skipOpeningGreeting: true });
    if (!started || !isRealtimeConversationRunning()) return;

    realtimeController.setMicEnabled(false);
    realtimeController.seedAssistantTurn(REALTIME_QA_OPENING_TEXT);
    lastRealtimeTranscript = realtimeController.getTranscript();
    updateRealtimeQaDraft(lastRealtimeTranscript);

    try {
      await openingPromise;
    } catch {
      showFeedback("Kon begroeting niet afspelen. Controleer geluid en probeer opnieuw.", "error");
    } finally {
      if (isRealtimeConversationRunning()) {
        realtimeController.setMicEnabled(true);
        setConversationStatus(
          'Luistert… Antwoord hardop. Zeg "stop" om uit te werken of "annuleer" om te stoppen.',
        );
      }
    }
  } catch {
    /* onError in controller */
  }
  updateProcessUi();
}

function stopReviewInlineListen() {
  reviewInlineListenController?.stop("");
  if (!state.reviewPlayback.active) {
    resetReviewInlineCorrectionState();
  }
}

function captureReviewPlaybackForCorrection() {
  if (!state.reviewPlayback.active) return;
  const resumeIndex =
    reviewSpeechPlayer?.getCurrentIndex?.() ?? state.reviewPlayback.index ?? 0;
  const paragraphKey = state.reviewPlayback.chunkParagraphKeys[resumeIndex] ?? null;
  state.reviewPlayback.suspendForCorrection = { resumeIndex, paragraphKey };
  console.debug("[correctie] captureReviewPlaybackForCorrection", { resumeIndex, paragraphKey });
  if (!state.reviewPlayback.paused) {
    pauseReviewPlayback();
  }
}

function abortReviewPlaybackLoop() {
  state.reviewPlayback.cancelled = true;
  reviewSpeechPlayer?.stop();
}

async function resumeReviewPlaybackAfterCorrection(opts = {}) {
  const suspend = state.reviewPlayback.suspendForCorrection;
  state.reviewPlayback.suspendForCorrection = null;
  if (!suspend) return;

  const plan = buildReviewSpeechPlan();
  if (!plan.chunks.length) {
    showFeedback("Geen tekst om verder voor te lezen.", "error");
    return;
  }

  const startIndex = resolveReviewResumeChunkIndex(
    suspend,
    plan.chunkParagraphKeys,
    plan.chunks.length,
    opts,
  );
  void prefetchOpenAiSpeech(plan.chunks[startIndex]);
  if (plan.chunks[startIndex + 1]) void prefetchOpenAiSpeech(plan.chunks[startIndex + 1]);

  const sessionId = beginReviewPlaybackSession();

  state.reviewPlayback = {
    active: true,
    paused: false,
    cancelled: false,
    chunks: plan.chunks,
    chunkParagraphKeys: plan.chunkParagraphKeys,
    index: startIndex,
    suspendForCorrection: null,
    suppressLoopCleanup: false,
    ttsActive: false,
    lastSpokenChunk: plan.chunks[startIndex] ?? "",
  };
  updateReviewUi();
  updateReviewStatus(REVIEW_PLAYBACK_STATUS);

  stopReviewRealtimeSessions();

  if (REVIEW_INLINE_LISTEN_ENABLED && realtimeInterviewEnabled) {
    try {
      await startReviewInlineListen();
    } catch {
      showFeedback("Spraakherkenning voor correctie kon niet starten.", "error");
    }
  }

  try {
    await ensureReviewSpeechPlayer().playFrom(plan.chunks, startIndex, {
      onProgress: (index) => {
        state.reviewPlayback.index = index;
        state.reviewPlayback.lastSpokenChunk = plan.chunks[index] ?? "";
      },
    });
  } catch {
    if (isCurrentReviewPlaybackSession(sessionId) && !reviewSpeechPlayer?.isActive?.()) {
      updateReviewStatus("Voorlezen gestopt.");
    }
  } finally {
    if (!isCurrentReviewPlaybackSession(sessionId)) {
      state.reviewPlayback.suppressLoopCleanup = false;
      return;
    }
    finishReviewPlaybackSession(sessionId);
  }
}

function updateReviewUi() {
  const show = hasUitgewerktResult();
  if (reviewSection) reviewSection.hidden = !show;
  shareReportEmail.updateVisibility(show);
  if (!show) return;

  const pb = state.reviewPlayback;
  const speaking = pb.active && !pb.paused;
  const paused = pb.active && pb.paused;
  const correcting =
    REVIEW_INLINE_LISTEN_ENABLED &&
    (reviewInlineCorrection.active || Boolean(pb.suspendForCorrection));

  reviewSection?.classList.toggle("is-speaking", speaking);
  btnReviewRead?.toggleAttribute("disabled", pb.active);
  if (btnReviewPause) btnReviewPause.hidden = !speaking || correcting;
  if (btnReviewResume) btnReviewResume.hidden = !paused || correcting;
  if (btnReviewStop) btnReviewStop.hidden = !pb.active;
  updateVoiceCorrectUi();
}

function ensureReviewSpeechPlayer() {
  if (!reviewSpeechPlayer) {
    reviewSpeechPlayer = createOpenAiSpeechPlayback({
      onStatus: updateReviewStatus,
      onError: (message) => showFeedback(message, "error"),
      onTtsActive: (active) => setReviewPlaybackTtsActive(active),
    });
  }
  return reviewSpeechPlayer;
}

function stopReviewPlayback() {
  invalidateReviewPlaybackSession();
  state.reviewPlayback.suspendForCorrection = null;
  state.reviewPlayback.cancelled = true;
  state.reviewPlayback.active = false;
  state.reviewPlayback.paused = false;
  reviewSpeechPlayer?.stop();
  stopReviewRealtimeSessions();
  if (isRealtimeConversationRunning()) {
    stopRealtimeInterview("");
  }
  resetReviewInlineCorrectionState();
  window.speechSynthesis?.cancel();
  updateReviewUi();
  if (reviewStatus) reviewStatus.hidden = true;
}

async function runReviewPlayback(startIndex = 0) {
  const plan = buildReviewSpeechPlan();
  if (!plan.chunks.length) {
    showFeedback("Geen tekst om voor te lezen.", "error");
    return;
  }

  const safeStart = Math.max(0, Math.min(startIndex, plan.chunks.length - 1));
  void prefetchOpenAiSpeech(plan.chunks[safeStart]);
  if (plan.chunks[safeStart + 1]) void prefetchOpenAiSpeech(plan.chunks[safeStart + 1]);

  const sessionId = beginReviewPlaybackSession();

  state.reviewPlayback = {
    active: true,
    paused: false,
    cancelled: false,
    chunks: plan.chunks,
    chunkParagraphKeys: plan.chunkParagraphKeys,
    index: safeStart,
    suspendForCorrection: null,
    suppressLoopCleanup: false,
    ttsActive: false,
    lastSpokenChunk: plan.chunks[safeStart] ?? "",
  };
  updateReviewUi();
  updateReviewStatus("");

  stopReviewRealtimeSessions();

  if (REVIEW_INLINE_LISTEN_ENABLED && realtimeInterviewEnabled) {
    try {
      await startReviewInlineListen();
    } catch {
      showFeedback("Spraakherkenning voor correctie kon niet starten.", "error");
    }
  }

  try {
    await ensureReviewSpeechPlayer().playFrom(plan.chunks, safeStart, {
      onProgress: (index) => {
        state.reviewPlayback.index = index;
        state.reviewPlayback.lastSpokenChunk = plan.chunks[index] ?? "";
      },
    });
    console.debug("[correctie] playFrom klaar (normaal einde)");
  } catch (err) {
    console.debug(`[correctie] playFrom FOUT: ${err instanceof Error ? err.message : String(err)}`);
    if (isCurrentReviewPlaybackSession(sessionId) && !reviewSpeechPlayer?.isActive?.()) {
      updateReviewStatus("Voorlezen gestopt.");
    }
  } finally {
    if (!isCurrentReviewPlaybackSession(sessionId)) {
      state.reviewPlayback.suppressLoopCleanup = false;
      return;
    }
    finishReviewPlaybackSession(sessionId);
  }
}

async function startReviewPlayback() {
  if (isRealtimeConversationRunning()) {
    stopRealtimeInterview("");
  }
  stopReviewPlayback();
  await runReviewPlayback(0);
}

function pauseReviewPlayback() {
  if (!state.reviewPlayback.active || state.reviewPlayback.paused) return;
  state.reviewPlayback.paused = true;
  reviewSpeechPlayer?.pause();
  updateReviewUi();
}

function resumeReviewPlayback() {
  if (!state.reviewPlayback.active || !state.reviewPlayback.paused) return;
  state.reviewPlayback.paused = false;
  reviewSpeechPlayer?.resume();
  updateReviewUi();
}

/**
 * @param {{ phase?: 1|2|null; total?: number; progress?: number; transcribing?: boolean; message?: string }} opts
 */
function setProcessingPhase(opts) {
  const { phase = null, total = 2, progress, transcribing = false } = opts;
  activeProcessingPhase = phase;
  const stepContainers = [
    $("loading-steps"),
    $("input-busy-steps"),
    inputDropBusySteps,
  ];
  const busyRoots = [$("loading"), inputBusy];
  const statusLabels = [$("loading-text"), inputBusyText, inputDropBusyLabel];

  if (phase === null) {
    stopProgressTicker();
    for (const el of stepContainers) el?.setAttribute("hidden", "");
    for (const root of busyRoots) root?.classList.remove("is-transcribing");
    fileDropzone?.classList.remove("is-transcribing");
    applyProgressPct(0);
    resetProcessingStepButtons();
    for (const el of statusLabels) el?.removeAttribute("hidden");
    refreshDropzoneProcessingUi();
    updateFlowSteps();
    return;
  }

  for (const el of stepContainers) {
    el?.removeAttribute("hidden");
  }

  const pct = progress ?? (phase / total) * 100;
  applyProgressPct(pct);

  for (const root of busyRoots) {
    root?.classList.toggle("is-transcribing", transcribing);
  }
  fileDropzone?.classList.toggle("is-transcribing", transcribing);

  for (const el of statusLabels) el?.setAttribute("hidden", "");

  refreshDropzoneProcessingUi();
  updateFlowSteps();
}

function processingGifUrl(cacheBust = false) {
  const base = `${MEGAMINNIE_PROCESSING_GIF}?v=${MEGAMINNIE_PROCESSING_GIF_VERSION}`;
  return cacheBust ? `${base}&_=${Date.now()}` : base;
}

/** Zorg dat de verwerkings-GIF geladen wordt (cache-bust na deploy). */
function syncProcessingGif(active) {
  if (!miniMegaminnieGif) return;
  const v = String(MEGAMINNIE_PROCESSING_GIF_VERSION);
  const url = processingGifUrl(active);
  if (miniMegaminnieGif.dataset.gifVersion !== v || active) {
    miniMegaminnieGif.src = url;
    miniMegaminnieGif.dataset.gifVersion = v;
  }
  miniMegaminnieGif.hidden = false;
}

function hideDropzoneProcessingUi() {
  fileDropzone?.classList.remove("is-processing", "is-transcribing");
  inputDropIdle?.removeAttribute("hidden");
  inputDropBusy?.setAttribute("hidden", "");
  inputDropBusySteps?.setAttribute("hidden", "");
  resetProcessingStepButtons();
}

function refreshDropzoneProcessingUi() {
  const hubBusy = inputPanel?.classList.contains("is-input-busy");
  const outputBusy = outputPanel?.classList.contains("is-busy");
  const showDropBusy = hubBusy || outputBusy;

  inputPanel?.classList.toggle("is-megaminnie-processing", showDropBusy);

  if (showDropBusy && activeProcessingPhase) {
    fileDropzone?.classList.add("is-processing");
    inputDropIdle?.setAttribute("hidden", "");
    inputDropBusy?.removeAttribute("hidden");
    inputDropBusyLabel?.setAttribute("hidden", "");
    syncProcessingGif(true);
    if (inputBusy) {
      inputBusy.hidden = true;
    }
    if (btnCancelDrop) btnCancelDrop.hidden = !activeAbort;
    if (btnCancelProcess) btnCancelProcess.hidden = true;
    return;
  }

  if (showDropBusy) {
    fileDropzone?.classList.add("is-processing");
    inputDropIdle?.setAttribute("hidden", "");
    inputDropBusy?.removeAttribute("hidden");
    syncProcessingGif(true);
    if (inputDropBusyLabel && inputBusyText?.textContent) {
      inputDropBusyLabel.textContent = inputBusyText.textContent;
    }
    if (inputBusy) inputBusy.hidden = true;
    if (btnCancelDrop) btnCancelDrop.hidden = !activeAbort;
    if (btnCancelProcess) btnCancelProcess.hidden = true;
    return;
  }

  hideDropzoneProcessingUi();
  if (btnCancelDrop) btnCancelDrop.hidden = true;
  updateInputChrome();
}

function createEmptyInterviewState(overrides = {}) {
  return {
    active: false,
    step: 0,
    speaking: false,
    processingAnswer: false,
    answers: [],
    processingUI: false,
    processingMessage: "",
    voiceCommandLocked: false,
    lastVoiceCommandAt: 0,
    commandPollTimer: null,
    commandPollBusy: false,
    commandPollAbort: null,
    lastCommandCheckAt: 0,
    commandPollBackoffUntil: 0,
    commandSilenceFrame: null,
    commandAudioCtx: null,
    mediaStream: null,
    audioChunks: [],
    mediaRecorder: null,
    recordingAnswer: false,
    ...overrides,
  };
}

function stopInterviewAnswerListening() {
  const iv = state.interview;
  if (iv.mediaRecorder && iv.mediaRecorder.state !== "inactive") {
    try {
      iv.mediaRecorder.stop();
    } catch {
      iv.recordingAnswer = false;
    }
  }
}

function stopVoiceCommandListening() {
  const iv = state.interview;
  if (iv.commandPollTimer) {
    clearInterval(iv.commandPollTimer);
    iv.commandPollTimer = null;
  }
  iv.commandPollAbort?.abort();
  iv.commandPollAbort = null;
  iv.commandPollBusy = false;
  if (iv.commandSilenceFrame) {
    cancelAnimationFrame(iv.commandSilenceFrame);
    iv.commandSilenceFrame = null;
  }
  if (iv.commandAudioCtx) {
    void iv.commandAudioCtx.close().catch(() => {});
    iv.commandAudioCtx = null;
  }
}

function canListenForVoiceCommands() {
  const iv = state.interview;
  return (
    iv.active &&
    iv.recordingAnswer &&
    !iv.speaking &&
    !iv.processingAnswer &&
    !iv.voiceCommandLocked &&
    !iv.processingUI
  );
}

/** @param {"advance"|"finish"} cmd */
function triggerInterviewVoiceCommand(cmd) {
  const iv = state.interview;
  if (!iv.active || iv.voiceCommandLocked || iv.processingAnswer) return;
  if (cmd === "advance" && !iv.recordingAnswer) return;

  iv.voiceCommandLocked = true;
  iv.lastVoiceCommandAt = Date.now();
  stopVoiceCommandListening();

  if (cmd === "finish") {
    endInterviewReport();
  } else {
    setInterviewProcessing(true, "Volgende vraag herkend…");
    nextInterviewQuestion();
  }
}

function tryVoiceCommandFromText(text) {
  const iv = state.interview;
  const now = Date.now();
  if (
    !iv.active ||
    !iv.recordingAnswer ||
    iv.speaking ||
    iv.voiceCommandLocked ||
    iv.processingAnswer ||
    now - iv.lastVoiceCommandAt < INTERVIEW_VOICE_COMMAND_DEBOUNCE_MS
  ) {
    return false;
  }
  const cmd = detectInterviewCommandAtTail(text);
  if (!cmd) return false;
  triggerInterviewVoiceCommand(cmd);
  return true;
}

function recentAnswerAudioBlob(iv, maxChunks = COMMAND_TAIL_CHUNKS) {
  const chunks = iv.audioChunks.slice(-maxChunks);
  if (chunks.length < COMMAND_MIN_CHUNKS) return null;
  const blob = new Blob(chunks, { type: "audio/webm" });
  return blob.size > COMMAND_MIN_BYTES ? blob : null;
}

async function runWhisperCommandCheck() {
  const iv = state.interview;
  if (!canListenForVoiceCommands() || iv.commandPollBusy) return;

  const now = Date.now();
  if (now < iv.commandPollBackoffUntil) return;
  if (now - iv.lastCommandCheckAt < COMMAND_CHECK_MIN_INTERVAL_MS) return;

  const blob = recentAnswerAudioBlob(iv);
  if (!blob) return;

  iv.commandPollAbort?.abort();
  iv.commandPollAbort = new AbortController();
  const { signal } = iv.commandPollAbort;

  iv.commandPollBusy = true;
  iv.lastCommandCheckAt = now;
  if (interviewStatus) {
    interviewStatus.classList.add("is-command-check");
  }

  try {
    const raw = await transcribeInterviewBlob(blob, "voice-cmd.webm", {
      commandHint: true,
      signal,
    });
    if (!signal.aborted) tryVoiceCommandFromText(raw.text);
  } catch (err) {
    if (!isAbortError(err)) {
      const msg = err instanceof Error ? err.message : "";
      if (/429|te veel verzoeken/i.test(msg)) {
        iv.commandPollBackoffUntil = Date.now() + 60_000;
      }
    }
  } finally {
    iv.commandPollBusy = false;
    if (interviewStatus) {
      interviewStatus.classList.remove("is-command-check");
    }
  }
}

/** Stilte na spraak → meteen Whisper-check (sneller dan alleen polling). */
function startCommandSilenceMonitor(stream) {
  const iv = state.interview;
  if (!stream || iv.commandAudioCtx) return;

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  iv.commandAudioCtx = ctx;

  const samples = new Uint8Array(analyser.fftSize);
  let hadSpeech = false;
  let lastSpeechAt = 0;

  const tick = () => {
    if (!canListenForVoiceCommands()) {
      iv.commandSilenceFrame = null;
      return;
    }

    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = (samples[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = Date.now();

    if (rms > COMMAND_SILENCE_RMS) {
      hadSpeech = true;
      lastSpeechAt = now;
    } else if (hadSpeech && now - lastSpeechAt >= COMMAND_SILENCE_MS) {
      hadSpeech = false;
      void runWhisperCommandCheck();
    }

    iv.commandSilenceFrame = requestAnimationFrame(tick);
  };

  iv.commandSilenceFrame = requestAnimationFrame(tick);
}

function startVoiceCommandListening(stream) {
  stopVoiceCommandListening();
  setTimeout(() => {
    if (!state.interview.recordingAnswer) return;
    startCommandSilenceMonitor(stream);
    const iv = state.interview;
    iv.commandPollTimer = setInterval(() => {
      void runWhisperCommandCheck();
    }, INTERVIEW_VOICE_POLL_MS);
    void runWhisperCommandCheck();
  }, 350);
}

/** Visuele verwerking tijdens interview (spinner + tekst). */
function setInterviewProcessing(busy, message) {
  const iv = state.interview;
  iv.processingUI = busy;
  iv.processingMessage = message || "";

  if (interviewBusy) interviewBusy.hidden = !busy;
  if (interviewBusyText && message) interviewBusyText.textContent = message;
  if (interviewPanel) interviewPanel.classList.toggle("is-processing", busy);

  if (btnInterviewNext) btnInterviewNext.disabled = busy;
  if (btnInterviewFinish) btnInterviewFinish.disabled = busy;

  renderInterviewUi();
}

/** Zelfde actie als knop “Einde verslag”. */
function endInterviewReport() {
  if (!state.interview.active) return;
  setInterviewProcessing(true, "Interview afronden…");
  void finishInterviewAnswer({ advance: false, finish: true });
}

/** Zelfde actie als knop “Volgende vraag”. */
function nextInterviewQuestion() {
  if (!state.interview.active) return;
  if (state.interview.processingAnswer) {
    setInterviewProcessing(true, state.interview.processingMessage || "Nog bezig…");
    return;
  }
  setInterviewProcessing(true, "Volgende vraag — antwoord opslaan…");
  void finishInterviewAnswer({ advance: true, finish: false });
}

async function captureAnswerAudioBlob() {
  const iv = state.interview;
  stopVoiceCommandListening();

  if (iv.recordingAnswer || iv.mediaRecorder) {
    stopInterviewAnswerListening();
    await waitForAnswerRecorderStop();
  }

  if (!iv.audioChunks.length) return null;
  const blob = new Blob(iv.audioChunks, { type: "audio/webm" });
  iv.audioChunks = [];
  return blob.size > 0 ? blob : null;
}

function renderInterviewUi() {
  if (!interviewPanel) return;
  const iv = state.interview;
  const total = INTERVIEW_QUESTIONS.length;
  const step = Math.min(iv.step, total - 1);

  if (interviewStep) {
    interviewStep.textContent = iv.active
      ? `Vraag ${step + 1} van ${total}`
      : "";
  }
  if (interviewQuestion) {
    interviewQuestion.textContent = iv.active ? INTERVIEW_QUESTIONS[step] : "";
  }
  if (interviewStatus) {
    if (iv.processingUI && iv.processingMessage) {
      interviewStatus.textContent = iv.processingMessage;
      interviewStatus.classList.remove("is-listening");
    } else if (iv.speaking) {
      interviewStatus.textContent = "MegaMinnie stelt een vraag…";
      interviewStatus.classList.remove("is-listening");
    } else if (iv.recordingAnswer) {
      interviewStatus.textContent = INTERVIEW_RECORDING_STATUS;
      interviewStatus.classList.add("is-listening");
      interviewStatus.classList.toggle("is-command-check", iv.commandPollBusy);
    } else if (iv.active) {
      interviewStatus.textContent = "Even geduld…";
      interviewStatus.classList.remove("is-listening");
    } else {
      interviewStatus.textContent = "";
      interviewStatus.classList.remove("is-listening");
    }
  }

  if (interviewDoneList) {
    const done = iv.answers.filter(Boolean);
    if (done.length) {
      interviewDoneList.hidden = false;
      interviewDoneList.innerHTML = iv.answers
        .map((a, i) => {
          if (!a) return "";
          const label = a.audioBlob
            ? "✓ opname opgeslagen"
            : a.transcript
              ? escapeHtml(a.transcript)
              : "(geen opname)";
          return `<li><strong>${escapeHtml(INTERVIEW_QUESTIONS[i] ?? `Vraag ${i + 1}`)}</strong> — ${label}</li>`;
        })
        .filter(Boolean)
        .join("");
    } else {
      interviewDoneList.hidden = true;
      interviewDoneList.innerHTML = "";
    }
  }

  if (interviewAnswerPreview) interviewAnswerPreview.hidden = true;
}

function scrollInterviewActionsIntoView() {
  window.requestAnimationFrame(() => {
    const target =
      document.querySelector(".interview__actions") ?? btnInterviewNext ?? interviewPanel;
    target?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
}

function showInterviewPanel(show, { scrollActions = false } = {}) {
  if (interviewPanel) interviewPanel.hidden = !show;
  if (show) {
    if (audioReview) audioReview.hidden = true;
    if (scrollActions) scrollInterviewActionsIntoView();
  } else if (hasValidAudio()) {
    updateAudioReview();
  } else {
    hideAudioReview();
  }
  if (btnProcess) btnProcess.disabled = show || !resolveInputMode();
}

function showProcessingSuccessWithQualityWarning(successMsg, qualityWarning) {
  if (qualityWarning?.trim()) {
    showFeedback(`${successMsg} ${qualityWarning.trim()}`, "warning");
  } else {
    showFeedback(successMsg, "success");
  }
}

async function transcribeInterviewBlob(blob, name, { commandHint = false, signal } = {}) {
  const fd = formFields();
  fd.append("audio", blob, name);
  if (commandHint) fd.append("prompt", WHISPER_COMMAND_PROMPT);
  const data = await apiPost("/api/visit-report/transcribe", {
    method: "POST",
    body: fd,
    signal,
  });
  return {
    text: typeof data.text === "string" ? data.text.trim() : "",
    qualityWarning:
      typeof data.qualityWarning === "string" ? data.qualityWarning : undefined,
  };
}

async function startInterviewMediaRecorder() {
  const iv = state.interview;
  if (iv.mediaRecorder && iv.mediaRecorder.state === "recording") return;

  if (!navigator.mediaDevices?.getUserMedia) {
    alert(
      "Interview werkt alleen via https:// of http://localhost. Open MegaMinnie lokaal of op een beveiligde verbinding.",
    );
    cancelInterview();
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === "NotAllowedError";
    alert(
      denied
        ? "Microfoon geweigerd. Sta toegang toe in de browser."
        : "Microfoon niet beschikbaar.",
    );
    cancelInterview();
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("audio/webm")
    ? "audio/webm"
    : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  iv.mediaRecorder = recorder;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) iv.audioChunks.push(e.data);
  };

  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    iv.mediaStream = null;
    iv.recordingAnswer = false;
    iv.mediaRecorder = null;
    renderInterviewUi();
  };

  iv.mediaStream = stream;
  recorder.start(100);
}

async function beginInterviewStepRecording() {
  const iv = state.interview;
  iv.audioChunks = [];
  iv.voiceCommandLocked = false;
  iv.recordingAnswer = false;
  await startInterviewMediaRecorder();
}

function beginInterviewAnswerListening() {
  const iv = state.interview;
  if (!iv.mediaRecorder || iv.mediaRecorder.state !== "recording" || !iv.mediaStream) {
    return;
  }
  iv.recordingAnswer = true;
  setInterviewProcessing(false);
  startVoiceCommandListening(iv.mediaStream);
  renderInterviewUi();
  scrollInterviewActionsIntoView();
}

async function waitForAnswerRecorderStop() {
  const iv = state.interview;
  const deadline = Date.now() + 8000;
  while (iv.mediaRecorder && iv.mediaRecorder.state !== "inactive") {
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 80));
  }
}

async function finishInterviewAnswer({ advance, finish }) {
  const iv = state.interview;
  if (!iv.active) return;
  if (iv.processingAnswer) return;
  iv.processingAnswer = true;

  try {
    const step = iv.step;
    const shouldAdvance = advance;
    const shouldFinish = finish;

    setInterviewProcessing(
      true,
      shouldFinish ? "Interview afronden…" : "Antwoord opslaan…",
    );

    const audioBlob = await captureAnswerAudioBlob();
    if (!iv.active) return;

    iv.answers[step] = {
      question: INTERVIEW_QUESTIONS[step],
      audioBlob,
    };

    if (interviewAnswerPreview) {
      interviewAnswerPreview.hidden = false;
      interviewAnswerPreview.textContent = audioBlob
        ? "Antwoord opgeslagen — wordt na het interview getranscribeerd."
        : "(Geen opname — je kunt doorgaan of opnieuw antwoorden.)";
    }
    renderInterviewUi();

    const finishNow =
      shouldFinish || (shouldAdvance && step >= INTERVIEW_QUESTIONS.length - 1);

    if (finishNow) {
      if (!iv.active) return;
      await completeInterview();
      return;
    }

    if (shouldAdvance) {
      if (!iv.active) return;
      iv.step += 1;
      if (iv.step >= INTERVIEW_QUESTIONS.length) {
        await completeInterview();
        return;
      }
      setInterviewProcessing(true, `Door naar vraag ${iv.step + 1} van ${INTERVIEW_QUESTIONS.length}…`);
      await presentInterviewStep();
      return;
    }

    setInterviewProcessing(false);
  } finally {
    iv.processingAnswer = false;
    iv.voiceCommandLocked = false;
  }
}

async function presentInterviewStep() {
  const iv = state.interview;
  if (!iv.active || iv.step >= INTERVIEW_QUESTIONS.length) return;

  setInterviewProcessing(
    true,
    iv.step === 0
      ? "Opname gestart — MegaMinnie begint het interview…"
      : "Opname loopt — MegaMinnie stelt de volgende vraag…",
  );
  await beginInterviewStepRecording();
  if (!iv.active || !iv.mediaRecorder) return;

  if (iv.step === 0) {
    await speakAndWait(INTERVIEW_INTRO_1);
    if (!iv.active) return;
    await speakAndWait(INTERVIEW_INTRO_2);
  } else if (iv.active) {
    setInterviewProcessing(true, "MegaMinnie: volgende vraag…");
    await speakAndWait(INTERVIEW_NEXT_PROMPT);
  }

  if (!iv.active) return;

  setInterviewProcessing(
    true,
    `Vraag ${iv.step + 1} van ${INTERVIEW_QUESTIONS.length}…`,
  );
  await speakAndWait(INTERVIEW_QUESTIONS[iv.step]);
  if (!iv.active) return;

  beginInterviewAnswerListening();
}

async function startInterview() {
  if (state.interview.active) return;
  if (isConversationActive()) cancelConversationRecording();
  if (isRealtimeConversationRunning()) stopRealtimeInterview();
  showInterviewPanel(false);
  resetRecordModeUi();
  if (!(await ensureInterviewSpeech())) return;

  stopInterviewAnswerListening();
  state.interview.processingAnswer = false;

  clearInputExcept("voice");
  hideFeedback();
  hideInputFeedback();

  state.interview = createEmptyInterviewState({ active: true });

  showInterviewPanel(true, { scrollActions: true });
  setInterviewButtonUi(true);
  if (recordHint) {
    recordHint.textContent =
      "Gesprek: luister naar MegaMinnie, antwoord hardop. Zet geluid en microfoon aan.";
    recordHint.hidden = false;
  }

  setInterviewProcessing(true, "Interview starten…");
  await presentInterviewStep();
}

function isPwaMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function updateTestModeUi() {
  if (isPwaMode()) {
    if (btnTestMode) btnTestMode.hidden = true;
    if (testModeBanner) testModeBanner.hidden = true;
    if (testRecordingsSection) testRecordingsSection.hidden = true;
    return;
  }
  if (testModeBanner) testModeBanner.hidden = !state.keepInput;
  if (testRecordingsSection) testRecordingsSection.hidden = !state.keepInput;
  if (btnTestMode) {
    btnTestMode.setAttribute("aria-pressed", state.keepInput ? "true" : "false");
    btnTestMode.classList.toggle("is-active", state.keepInput);
    btnTestMode.textContent = state.keepInput ? "Testmodus: aan" : "Testmodus: uit";
    btnTestMode.title = state.keepInput
      ? "Testmodus aan — opnames en gesprekstranscripten worden opgeslagen. Bibliotheek blijft bewaard."
      : "Testmodus uit — opgeslagen testbestanden blijven staan (alleen prullenbak verwijdert). Invoer wordt na verwerking gewist.";
  }
}

function readTestModePreference(serverDefault) {
  const stored = localStorage.getItem(TEST_MODE_STORAGE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return serverDefault;
}

async function applyTestMode(enabled) {
  state.keepInput = enabled;
  localStorage.setItem(TEST_MODE_STORAGE_KEY, enabled ? "true" : "false");
  updateTestModeUi();
  if (enabled) {
    await restoreTestAudio();
    if (hasValidAudio() && recordHint) {
      recordHint.textContent = "Testmodus: opname bewaard — opnieuw verwerken kan.";
      recordHint.hidden = false;
    }
  } else {
    await renderTestRecordingsPicker();
    if (recordHint?.textContent.includes("Testmodus")) {
      recordHint.textContent = "";
      recordHint.hidden = true;
    }
  }
}

function initTestModePreference() {
  if (isPwaMode()) {
    state.keepInput = false;
    updateTestModeUi();
    return;
  }
  const stored = localStorage.getItem(TEST_MODE_STORAGE_KEY);
  if (stored === "true" || stored === "false") {
    state.keepInput = stored === "true";
    updateTestModeUi();
  }
}

function cancelInterview() {
  const iv = state.interview;
  const answersSnapshot = iv.answers?.length ? iv.answers.map((a) => ({ ...a })) : [];
  const hadAudio = answersSnapshot.some((a) => a?.audioBlob?.size);

  iv.active = false;
  iv.speaking = false;
  iv.processingAnswer = false;
  iv.voiceCommandLocked = true;

  window.speechSynthesis?.cancel();
  stopVoiceCommandListening();
  stopInterviewAnswerListening();

  if (iv.mediaStream) {
    iv.mediaStream.getTracks().forEach((t) => t.stop());
    iv.mediaStream = null;
  }

  activeRequestId++;
  activeProcessId++;
  activeAbort?.abort();
  activeAbort = null;
  endProcessingUI();
  setInputBusy(false);
  setProcessingPhase({ phase: null });
  setInterviewProcessing(false);

  state.interview = createEmptyInterviewState();
  showInterviewPanel(false);
  setInterviewButtonUi(false);
  setInterviewButtonUi(false);
  if (recordHint) {
    recordHint.textContent = "";
    recordHint.hidden = true;
  }
  renderInterviewUi();
  updateProcessUi();

  if (state.keepInput && hadAudio) {
    void saveInterviewTestRecording(answersSnapshot, { partial: true });
  }
}

function buildInterviewRawText() {
  const lines = ["Gestructureerd interview — vraag en antwoord:", ""];
  for (let i = 0; i < INTERVIEW_QUESTIONS.length; i++) {
    const q = INTERVIEW_QUESTIONS[i];
    const a = state.interview.answers[i]?.transcript?.trim() || "(niet beantwoord)";
    lines.push(`Vraag: ${q}`, `Antwoord: ${a}`, "");
  }
  return lines.join("\n");
}

function hasAnyInterviewAudio() {
  return state.interview.answers.some((a) => a?.audioBlob?.size);
}

async function transcribeAllInterviewAnswers() {
  const iv = state.interview;
  const total = INTERVIEW_QUESTIONS.length;
  /** @type {string[]} */
  const qualityWarnings = [];

  for (let i = 0; i < total; i++) {
    const entry = iv.answers[i];
    if (!entry) {
      iv.answers[i] = {
        question: INTERVIEW_QUESTIONS[i],
        audioBlob: null,
        transcript: "(niet beantwoord)",
      };
      continue;
    }

    let transcript = entry.transcript?.trim() || "";
    if (!transcript && entry.audioBlob?.size) {
      const from = 5 + (i / total) * 45;
      const to = 5 + ((i + 1) / total) * 45;
      setProcessingPhase({
        phase: 1,
        transcribing: true,
        progress: from,
        message: `Verwerken: antwoord ${i + 1} van ${total}…`,
      });
      if (interviewStatus) {
        interviewStatus.textContent = `Verwerken: antwoord ${i + 1} van ${total}…`;
      }
      try {
        const transcribed = await runWithProgressTicker(
          from,
          to - 0.5,
          estimateTranscribeDurationMs(entry.audioBlob),
          () =>
            transcribeInterviewBlob(entry.audioBlob, `interview-v${i + 1}.webm`),
        );
        applyProgressPct(to);
        setProcessingPhase({
          phase: 1,
          transcribing: true,
          progress: to,
          message: `Verwerken: antwoord ${i + 1} van ${total}…`,
        });
        if (transcribed.qualityWarning) {
          qualityWarnings.push(transcribed.qualityWarning);
        }
        const { cleaned } = stripStepSpeechFromTranscript(transcribed.text, i);
        transcript = cleaned;
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? `Verwerken vraag ${i + 1} mislukt: ${err.message}`
            : `Verwerken vraag ${i + 1} mislukt`,
        );
      }
    }

    iv.answers[i] = {
      question: INTERVIEW_QUESTIONS[i],
      audioBlob: entry.audioBlob,
      transcript: transcript || "(niet beantwoord)",
    };
  }

  return [...new Set(qualityWarnings)];
}

async function completeInterview() {
  const iv = state.interview;
  if (!iv.active) return;

  iv.recordingAnswer = false;
  setInterviewProcessing(true, "Interview afronden…");
  stopVoiceCommandListening();
  stopInterviewAnswerListening();

  await speakAndWait(
    "Prima. Het interview is afgerond. Ik ga nu alles verwerken en je verslag uitwerken.",
    { requireActive: false },
  );

  iv.active = false;
  iv.speaking = false;

  setInterviewButtonUi(false);

  if (!hasAnyInterviewAudio() && !iv.answers.some((a) => a?.transcript?.trim())) {
    showInputFeedback("Geen antwoorden om te verwerken.", "error");
    cancelInterview();
    return;
  }

  showInterviewPanel(false);

  const processId = ++activeProcessId;
  const { requestId, signal } = beginRequest();
  setInterviewProcessing(true, "Alle antwoorden verwerken…");
  setInputBusy(true, "Interview verwerken…");
  setProcessingPhase({
    phase: 1,
    transcribing: true,
    progress: 5,
    message: "Stap 1/2: Interview verwerken…",
  });
  hideFeedback();

  try {
    const qualityWarnings = await transcribeAllInterviewAnswers();
    if (!isRequestActive(requestId)) return;
    if (processId !== activeProcessId) return;

    if (state.keepInput && hasAnyInterviewAudio()) {
      await saveInterviewTestRecording(iv.answers.map((a) => ({ ...a })));
    }

    const rawText = buildInterviewRawText();
    if (!rawText.trim()) {
      showInputFeedback("Geen antwoorden om te verwerken.", "error");
      return;
    }

    setInterviewProcessing(true, "Uitwerken…");
    setInputBusy(true, "Uitwerken…");
    setProcessingPhase({
      phase: 2,
      progress: 50,
      transcribing: false,
      message: "Stap 2/2: Uitwerken…",
    });

    const result = await runWithProgressTicker(
      50,
      98,
      estimateLlmDurationMs(rawText.length),
      () =>
        apiPost("/api/visit-report/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: rawText, source: "interview" }),
          signal,
        }),
    );
    applyProgressPct(100);

    if (!isRequestActive(requestId)) return;
    if (processId !== activeProcessId) return;

    state.lastResult = result;
    updateFlowSteps();
    renderResult(result);
    clearAllInputSources();
    state.interview = createEmptyInterviewState();
    updateProcessUi();
    showProcessingSuccessWithQualityWarning(
      "Verslag op basis van je interview is klaar.",
      qualityWarnings[0],
    );
    if (outputPanel && !outputPanel.hidden) {
      outputPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch (err) {
    if (!isRequestActive(requestId)) return;
    if (isAbortError(err)) return;
    showProcessingError(
      err instanceof Error ? err.message : "Verwerken mislukt",
    );
  } finally {
    if (isRequestActive(requestId)) {
      activeAbort = null;
      setInterviewProcessing(false);
      setInputBusy(false);
    }
  }
}

/**
 * Vastgelegde invoer op klik — niet meer afhankelijk van state tijdens lange API-call.
 * @param {"photo"|"voice"|"text"} mode
 */
function createProcessSnapshot(mode) {
  if (mode === "voice") {
    const audio = state.audioBlob;
    if (!audio?.size) return null;
    return {
      mode: "voice",
      audio,
      audioName:
        audio instanceof File
          ? audio.name
          : state.audioName || "opname.webm",
    };
  }
  if (mode === "photo") {
    if (!state.photos.length) return null;
    return {
      mode: "photo",
      photos: state.photos.map((p) => ({ file: p.file, name: p.file.name })),
    };
  }
  const text = getTextContent();
  if (!text) return null;
  return { mode: "text", text };
}

/** @param {"photo"|"voice"|"text"} mode */
function stripOtherInputsForProcess(mode) {
  if (mode === "voice") {
    for (const p of state.photos) URL.revokeObjectURL(p.url);
    state.photos = [];
    if (textInput) textInput.value = "";
    state.documentNames = [];
  } else if (mode === "photo") {
    hideAudioReview();
    state.audioBlob = null;
    state.audioName = "";
    if (textInput) textInput.value = "";
    state.documentNames = [];
  } else {
    for (const p of state.photos) URL.revokeObjectURL(p.url);
    state.photos = [];
    hideAudioReview();
    state.audioBlob = null;
    state.audioName = "";
  }
  renderAttachments();
}

function isInitialReportProcessing() {
  return Boolean(
    inputPanel?.classList.contains("is-input-busy") && !state.lastResult,
  );
}

function isOutputProcessing() {
  return Boolean(outputPanel?.classList.contains("is-busy"));
}

/** Verwijder concept als nieuwe invoer niet meer bij het getoonde resultaat hoort. */
function invalidateStaleResult() {
  if (!state.lastResult) return;
  const mode = resolveInputMode();
  if (!mode) return;

  const source = state.lastResult.source;
  if (mode === "photo" && source !== "photo") {
    clearDraftResult();
    return;
  }
  if (mode === "voice" && source === "photo") {
    clearDraftResult();
    return;
  }
  if (mode === "text" && source === "photo") {
    clearDraftResult();
  }
}

/** Na verwerking: foto's, opname en tekst uit de invoerhub (concept blijft staan). */
function clearAllInputSources() {
  const keepAudio = state.keepInput && hasValidAudio();
  const keepPhotos = state.keepInput && state.photos.length > 0;
  const savedBlob = keepAudio ? state.audioBlob : null;
  const savedName = keepAudio ? state.audioName : "";

  if (!keepPhotos) {
    for (const p of state.photos) URL.revokeObjectURL(p.url);
    state.photos = [];
  }

  if (keepAudio && savedBlob) {
    state.audioBlob = savedBlob;
    state.audioName = savedName;
    state.activeInputKind = keepPhotos ? "photo" : "voice";
    updateAudioReview();
    if (recordHint) {
      recordHint.textContent = "Testmodus: opname bewaard — opnieuw verwerken kan.";
      recordHint.hidden = false;
    }
  } else {
    hideAudioReview();
    state.audioBlob = null;
    state.audioName = "";
    if (!keepPhotos) {
      state.activeInputKind = null;
    } else {
      state.activeInputKind = "photo";
    }
    if (recordHint && !keepPhotos) {
      recordHint.textContent = "";
      recordHint.hidden = true;
    }
  }

  state.mediaRecorder = null;
  state.recording = false;
  setInterviewButtonUi(false);
  resetRecordModeUi();
  if (isConversationActive()) cancelConversationRecording();
  if (isRealtimeConversationRunning()) stopRealtimeInterview();
  if (textInput) textInput.value = "";
  state.documentNames = [];
  hideManualPanel();
  renderAttachments();
  hideInputFeedback();
  if (inputSummary) {
    inputSummary.hidden = true;
    inputSummary.innerHTML = "";
  }
  bumpInputGeneration();
}

function hasUitgewerktResult() {
  if (realtimeQaDraftActive) return false;
  if (!state.lastResult) return false;
  const note = state.lastResult.megaMinnie?.salesforceNote;
  return Boolean(note?.title?.trim() || note?.body?.trim());
}

function updateOutputVisibility() {
  const show = hasUitgewerktResult() || realtimeQaDraftActive;
  if (outputPanel) outputPanel.hidden = !show;
  mainLayout?.classList.toggle("layout--single", !show);
  setTasksEventsToolbarVisible(hasUitgewerktResult());
  if (!show) {
    $("result-area").hidden = true;
    if (reviewSection) reviewSection.hidden = true;
    stopReviewPlayback();
  } else {
    $("result-area").hidden = false;
    updateReviewUi();
  }
  updateSupplementUi();
}

function hasSupplementInput() {
  const s = state.supplement;
  return Boolean(s.audioBlob?.size) || s.photos.length > 0;
}

/** @returns {"photo"|"voice"|null} */
function resolveSupplementMode() {
  if (state.supplement.audioBlob?.size) return "voice";
  if (state.supplement.photos.length) return "photo";
  return null;
}

/** @param {"photo"|"voice"} keep */
function clearSupplementExcept(keep) {
  const s = state.supplement;
  if (keep !== "photo") {
    for (const p of s.photos) URL.revokeObjectURL(p.url);
    s.photos = [];
  }
  if (keep !== "voice") {
    hideSupplementAudioReview();
    s.audioBlob = null;
    s.audioName = "";
    s.mediaRecorder = null;
    s.recording = false;
  }
}

function clearSupplement() {
  const s = state.supplement;
  for (const p of s.photos) URL.revokeObjectURL(p.url);
  s.photos = [];
  hideSupplementAudioReview();
  s.audioBlob = null;
  s.audioName = "";
  s.mediaRecorder = null;
  s.recording = false;
  s.audioChunks = [];
  s.autoProcessOnStop = false;
  updateVoiceCorrectUi();
  renderSupplementAttachments();
  updateSupplementUi();
}

function hideSupplementAudioReview() {
  if (supplementAudioObjectUrl) {
    URL.revokeObjectURL(supplementAudioObjectUrl);
    supplementAudioObjectUrl = null;
  }
  if (supplementAudioPreview) {
    supplementAudioPreview.pause();
    supplementAudioPreview.removeAttribute("src");
  }
  if (supplementAudioReview) supplementAudioReview.hidden = true;
}

function showSupplementAudioPreview(blob) {
  state.supplement.audioBlob = blob;
  if (supplementAudioObjectUrl) URL.revokeObjectURL(supplementAudioObjectUrl);
  supplementAudioObjectUrl = URL.createObjectURL(blob);
  if (supplementAudioPreview) supplementAudioPreview.src = supplementAudioObjectUrl;
  if (supplementAudioReview) supplementAudioReview.hidden = false;
}

function getExistingMegaMinnieFromUi() {
  const base = state.lastResult?.megaMinnie;
  if (!base) return null;
  const title = getNoteTitle();
  const body = getNoteBodyMarkdown();
  if (!title || !body) return null;
  return collectTasksEventsFromUi({
    ...base,
    salesforceNote: { title, body },
  }, state.defaultAccountManager);
}

function renderSupplementAttachments() {
  if (!supplementAttachments) return;
  supplementAttachments.innerHTML = "";
  const s = state.supplement;
  const hasPhotos = s.photos.length > 0;
  const hasAudio = Boolean(s.audioBlob?.size);

  if (!hasPhotos && !hasAudio) {
    supplementAttachments.hidden = true;
    return;
  }

  supplementAttachments.hidden = false;
  if (hasPhotos) {
    const gallery = document.createElement("div");
    gallery.className = "photo-gallery";
    for (const p of s.photos) {
      const wrap = document.createElement("div");
      wrap.className = "photo-thumb";
      wrap.innerHTML = `<img src="${p.url}" alt="" /><button type="button" class="photo-thumb__remove" data-id="${p.id}" aria-label="Verwijder foto">×</button>`;
      wrap.querySelector(".photo-thumb__remove")?.addEventListener("click", () => {
        URL.revokeObjectURL(p.url);
        s.photos = s.photos.filter((x) => x.id !== p.id);
        renderSupplementAttachments();
        updateSupplementUi();
      });
      gallery.appendChild(wrap);
    }
    supplementAttachments.appendChild(gallery);
  }
}

function updateSupplementUi() {
  if (!reviewSection) return;
  const show = hasUitgewerktResult();
  if (!show) return;
  renderSupplementAttachments();
}

async function startSupplementVoiceCorrection() {
  if (!realtimeInterviewEnabled) {
    showFeedback(
      "Mondeling corrigeren gebruikt OpenAI Realtime (zelfde als Vraag en Antwoord). Zet REALTIME_INTERVIEW_ENABLED=true.",
      "error",
    );
    return;
  }
  if (isRealtimeConversationRunning()) {
    showFeedback("Stop eerst Vraag en Antwoord voordat je een correctie inspreekt.", "error");
    return;
  }

  if (state.reviewPlayback.active && isReviewInlineListening()) {
    handleReviewCorrectieCommand();
    return;
  }
  if (state.reviewPlayback.active && !REVIEW_INLINE_LISTEN_ENABLED) {
    return;
  }

  if (isSupplementVoiceListening()) return;

  if (state.reviewPlayback.active) {
    captureReviewPlaybackForCorrection();
  } else {
    stopReviewPlayback();
  }

  stopReviewInlineListen();
  supplementRealtimeController?.stop();
  clearSupplement();
  updateVoiceCorrectUi();
  await supplementRealtimeController?.start({
    listenOnly: false,
    passiveListen: false,
    correctionDialogue: true,
  });
  updateVoiceCorrectUi();
}

async function finishSupplementVoiceCorrection() {
  if (!supplementRealtimeController?.isActive() && !supplementRealtimeController?.isConnecting()) {
    return;
  }

  const resumeAfter = Boolean(state.reviewPlayback.suspendForCorrection);
  const text = supplementRealtimeController.getUserTranscript();
  supplementRealtimeController.stop("Verwerken…");
  updateVoiceCorrectUi();
  if (reviewStatus) reviewStatus.hidden = true;

  if (!text.trim()) {
    showFeedback("Geen correctie verstaan — probeer opnieuw.", "error");
    if (resumeAfter) {
      state.reviewPlayback.cancelled = false;
      if (!resumeReviewPlaybackInPlace()) {
        invalidateReviewPlaybackSession();
        state.reviewPlayback.suppressLoopCleanup = true;
        abortReviewPlaybackLoop();
        await resumeReviewPlaybackAfterCorrection();
      }
    }
    return;
  }

  await processSupplement({ supplementText: text, resumeReviewAfter });
}

function clearResultFields() {
  clearNoteTitle();
  clearNoteBody();
}

function clearDraftResult() {
  stopReviewPlayback();
  supplementRealtimeController?.stop();
  state.lastResult = null;
  clearSupplement();
  clearResultFields();
  updateOutputVisibility();
  $("tasks-section").hidden = true;
  $("events-section").hidden = true;
  $("tasks-events-actions").hidden = true;
  $("tasks-list").innerHTML = "";
  $("events-list").innerHTML = "";
  if (sfLink) sfLink.hidden = true;
  clearSfSelection();
  hideFeedback();
  updateSyncButton();
  updateFlowSteps();
  updateProcessUi();
}

const INPUT_MODE_LABELS = {
  photo: "foto's",
  voice: "je opname",
  text: "je tekst",
};

function hasAnyInput() {
  return resolveInputMode() !== null;
}

function isManualPanelOpen() {
  return manualPanel ? !manualPanel.hidden : false;
}

function showManualPanel() {
  if (!manualPanel) return;
  manualPanel.hidden = false;
  btnManual?.classList.add("is-active");
  btnManual?.setAttribute("aria-expanded", "true");
  setActiveInputKind("text");
  placeProcessButton();
  updateInputChrome();
  textInput?.focus();
  manualPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideManualPanel() {
  if (!manualPanel) return;
  manualPanel.hidden = true;
  btnManual?.classList.remove("is-active");
  btnManual?.setAttribute("aria-expanded", "false");
  placeProcessButton();
  updateInputChrome();
}

function toggleManualPanel() {
  if (isManualPanelOpen()) hideManualPanel();
  else showManualPanel();
}

function placeProcessButton() {
  if (!btnProcess) return;
  const slot =
    isManualPanelOpen() && manualProcessSlot ? manualProcessSlot : hubProcessSlot;
  if (!slot) return;
  slot.append(btnProcess);
  if (processHint) slot.append(processHint);
  if (hubProcessSlot) hubProcessSlot.hidden = slot === manualProcessSlot;
}

function resetDragState() {
  dragDepth = 0;
  hideDropOverlay();
  fileDropzone?.classList.remove("is-dragover");
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @param {boolean} busy @param {string} [message] @param {{ lockActions?: boolean }} [opts] */
function setInputBusy(busy, message, opts = {}) {
  if (!inputBusy) return;
  const lockActions = opts.lockActions ?? Boolean(activeAbort);
  if (busy) {
    if (message && inputBusyText) inputBusyText.textContent = message;
    inputBusy.hidden = false;
    inputPanel?.classList.add("is-input-busy");
    updateInputChrome();
    btnProcess.disabled = true;
    if (lockActions) {
      btnInvoer?.setAttribute("disabled", "");
      btnConversation?.setAttribute("disabled", "");
      btnManual?.setAttribute("disabled", "");
    }
    if (btnCancelProcess) btnCancelProcess.hidden = !activeAbort;
    refreshDropzoneProcessingUi();
    updateInputChrome();
  } else {
    inputBusy.hidden = true;
    inputPanel?.classList.remove("is-input-busy");
    btnInvoer?.removeAttribute("disabled");
    btnConversation?.removeAttribute("disabled");
    btnManual?.removeAttribute("disabled");
    if (btnCancelProcess) btnCancelProcess.hidden = true;
    refreshDropzoneProcessingUi();
    updateProcessUi();
  }
}

// --- Drag & drop ---
if (inputPanel) {
  inputPanel.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    showDropOverlay(e);
  });

  inputPanel.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    showDropOverlay(e);
  });

  inputPanel.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideDropOverlay();
  });

  inputPanel.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    hideDropOverlay();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void ingestFiles(files);
  });
}

/** @param {DragEvent} e */
function hasFiles(e) {
  return [...(e.dataTransfer?.types ?? [])].includes("Files");
}

/** @param {DragEvent} e */
function showDropOverlay(e) {
  const items = e.dataTransfer?.items
    ? [...e.dataTransfer.items].filter((i) => i.kind === "file")
    : [];
  let img = false;
  let aud = false;
  let doc = false;
  for (const item of items) {
    if (item.type.startsWith("image/")) img = true;
    if (item.type.startsWith("audio/")) aud = true;
    if (item.type.startsWith("text/") || item.type.includes("pdf") || item.type.includes("word"))
      doc = true;
  }
  const parts = [];
  if (img) parts.push("foto's");
  if (aud) parts.push("audio");
  if (doc) parts.push("documenten");
  dropOverlayText.textContent =
    parts.length > 0
      ? `Laat los — ${parts.join(", ")}`
      : "Laat los om toe te voegen";
  inputPanel?.classList.add("is-dragover");
  dropOverlay.hidden = false;
  dropOverlay.setAttribute("aria-hidden", "false");
}

function hideDropOverlay() {
  inputPanel?.classList.remove("is-dragover");
  dropOverlay.hidden = true;
  dropOverlay.setAttribute("aria-hidden", "true");
}

/** @param {File[]} files */
async function ingestFiles(files) {
  resetDragState();
  const images = files.filter(isImageFile);
  const audio = files.filter(isAudioFile);
  const docs = files.filter(isTextDocument);
  const unknown = files.filter(
    (f) => !isImageFile(f) && !isAudioFile(f) && !isTextDocument(f),
  );

  if (unknown.length && !images.length && !audio.length && !docs.length) {
    alert(
      "Niet herkend. Gebruik foto's, audio, .txt, .md, .docx of .pdf.",
    );
    return;
  }

  if (unknown.length) {
    showFeedback(
      `${unknown.length} bestand(en) overgeslagen (niet ondersteund).`,
      "error",
    );
  }

  if (audio.length) {
    clearInputExcept("voice");
    setAudio(audio[0]);
    setActiveInputKind("voice");
    if (audio.length > 1) {
      showFeedback("Alleen het eerste audiobestand wordt gebruikt.", "success");
    }
  } else if (images.length) {
    try {
      clearInputExcept("photo");
      await addPhotos(images);
      setActiveInputKind("photo");
    } catch (err) {
      showInputFeedback(
        err instanceof Error ? err.message : "Foto's laden mislukt",
        "error",
      );
    }
  } else if (docs.length) {
    clearInputExcept("text");
    for (const doc of docs) {
      await addTextDocument(doc);
    }
    setActiveInputKind("text");
  }

  renderAttachments();
  updateProcessUi();
}

/** @param {File} file */
function setAudio(file) {
  clearInputExcept("voice");
  state.mediaRecorder = null;
  rememberMainAudio(file, file.name);
  showAudioPreview(file);
  recordHint.textContent = state.keepInput
    ? `Audio toegevoegd: ${file.name} (testmodus: opname bewaard)`
    : `Audio toegevoegd: ${file.name}`;
  recordHint.hidden = false;
  renderAttachments();
}

function hideAudioReview() {
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
  }
  if (audioPreview) {
    audioPreview.pause();
    audioPreview.removeAttribute("src");
  }
  if (audioReview) audioReview.hidden = true;
}

function updateAudioReview() {
  if (!hasValidAudio()) {
    hideAudioReview();
    return;
  }
  if (audioReview) audioReview.hidden = false;
  if (audioPreview && state.audioBlob) {
    if (!audioObjectUrl || audioPreview.src !== audioObjectUrl) {
      if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
      audioObjectUrl = URL.createObjectURL(state.audioBlob);
      audioPreview.src = audioObjectUrl;
    }
  }
}

function clearAudio() {
  hideAudioReview();
  state.audioBlob = null;
  state.audioName = "";
  recordHint.textContent = "";
  recordHint.hidden = true;
  if (state.activeInputKind === "voice") {
    state.activeInputKind = state.photos.length
      ? "photo"
      : getTextContent()
        ? "text"
        : null;
    bumpInputGeneration();
  }
  invalidateStaleResult();
  renderAttachments();
  updateProcessUi();
}

/** @param {File} file */
async function addTextDocument(file) {
  try {
    let text;
    if (isPlainTextDocument(file)) {
      text = (await file.text()).trim();
    } else {
      const fd = new FormData();
      fd.append("document", file, file.name);
      const data = await apiPost("/api/visit-report/extract-text", {
        method: "POST",
        body: fd,
      });
      text = data.text?.trim() ?? "";
    }

    if (!text) {
      showFeedback(`${file.name}: geen tekst gevonden.`, "error");
      return;
    }

    clearInputExcept("text");
    textInput.value = text;
    state.documentNames = [file.name];
    showManualPanel();
    setActiveInputKind("text");
    hideFeedback();
    hideInputFeedback();
    renderAttachments();
    updateProcessUi();
  } catch (err) {
    showFeedback(
      err instanceof Error ? err.message : `Fout bij ${file.name}`,
      "error",
    );
  }
}

// --- Health ---
async function loadHealth() {
  const badge = $("status-badge");
  try {
    const res = await fetch("/health");
    const data = await res.json();
    state.dryRun = Boolean(data.dryRun);
    state.keepInput = readTestModePreference(Boolean(data.keepInput));
    state.salesforceConfigured = Boolean(data.salesforceConfigured);
    state.mailSignature = typeof data.mailSignature === "string" ? data.mailSignature : "";
    state.defaultAccountManager =
      typeof data.defaultAccountManager === "string" && data.defaultAccountManager.trim()
        ? data.defaultAccountManager.trim()
        : "Accountmanager";
    const realtimeEnabled = data.realtimeInterviewEnabled !== false;
    realtimeInterviewEnabled = realtimeEnabled;
    if (btnInvoer) btnInvoer.toggleAttribute("disabled", !realtimeEnabled);
    if (!realtimeEnabled && conversationPanelMode === "realtime-qa" && isRecordModeUiActive()) {
      stopRealtimeInterview("Realtime uitgeschakeld");
      resetRecordModeUi();
    }

    if (state.keepInput) {
      await restoreTestAudio();
    } else {
      await renderTestRecordingsPicker();
    }
    updateTestModeUi();

    if (data.apiKeyRequired) {
      let key = sessionStorage.getItem("megaminnie_api_key");
      if (!key) {
        key = window.prompt("Voer de MegaMinnie API-sleutel in (MEGAMINNIE_API_KEY):") ?? "";
        if (key) sessionStorage.setItem("megaminnie_api_key", key);
      }
      setApiKey(key);
    }

    if (!data.llmConfigured) {
      badge.textContent =
        data.llmProvider === "anthropic" ? "Claude-key ontbreekt" : "OpenAI-key ontbreekt";
      badge.className = "badge badge--dry";
      badge.title = data.hint ?? "Vul API-sleutel in .env";
      return;
    }

    const llm = data.llmProvider === "anthropic" ? "Claude" : "OpenAI";
    let whisperLabel = "";
    if (data.whisperProvider === "local") {
      whisperLabel = data.whisperReachable ? " · Whisper" : " · Whisper uit";
    } else if (data.whisperConfigured) {
      whisperLabel = " · Whisper cloud";
    }

    let sfLabel = "";
    if (!data.salesforceConfigured) {
      sfLabel = " · SF uit";
    } else if (data.salesforceReachable === false) {
      sfLabel = " · SF mislukt";
    } else if (data.salesforceDryRun) {
      sfLabel = " · SF preview";
    } else {
      sfLabel = " · SF live";
    }

    badge.title = data.hint ?? "";
    if (state.keepInput) {
      badge.title = badge.title
        ? `${badge.title} Testmodus: opnames worden bewaard.`
        : "Testmodus: opnames worden bewaard.";
    }
    if (data.whisperProvider === "local" && !data.whisperReachable) {
      badge.textContent = `${llm} · start Whisper`;
      badge.className = "badge badge--dry";
      badge.title =
        data.hint ??
        "Voer npm run whisper:up uit (Docker). Eerste start duurt enkele minuten.";
      return;
    }

    if (!data.salesforceConfigured || data.salesforceReachable === false) {
      badge.textContent = `${llm}${whisperLabel}${sfLabel}`;
      badge.className = "badge badge--dry";
      return;
    }

    badge.textContent = `${llm}${whisperLabel}${sfLabel}`;
    badge.className = `badge ${data.dryRun || data.salesforceDryRun ? "badge--dry" : "badge--live"}`;
  } catch {
    badge.textContent = "Offline";
    badge.className = "badge badge--muted";
    realtimeInterviewEnabled = false;
    if (btnInvoer) btnInvoer.setAttribute("disabled", "");
    stopRealtimeInterview("Niet verbonden");
    if (conversationPanelMode === "realtime-qa") {
      resetRecordModeUi();
    }
    updateTestModeUi();
  }
}

fileDropzone?.addEventListener("click", (e) => {
  if (
    e.target.closest(
      "#btn-invoer, #btn-conversation, #btn-manual, #btn-cancel-drop, .input-hub__drop-busy, .test-recordings, button, a",
    )
  ) {
    return;
  }
  if (fileDropzone.classList.contains("is-processing")) return;
  fileInput?.click();
});

fileDropzone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  fileDropzone.classList.add("is-dragover");
});

fileDropzone?.addEventListener("dragleave", () => {
  fileDropzone.classList.remove("is-dragover");
});

fileDropzone?.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetDragState();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void ingestFiles(files);
});

fileInput?.addEventListener("change", () => {
  const files = [...(fileInput.files ?? [])];
  if (files.length) void ingestFiles(files);
  fileInput.value = "";
});

btnManual?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (isManualPanelOpen()) {
    hideManualPanel();
  } else {
    clearInputExcept("text");
    showManualPanel();
  }
  updateProcessUi();
});

btnRemoveAudio?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearAudio();
  updateProcessUi();
});

btnTestMode?.addEventListener("click", (e) => {
  e.preventDefault();
  void applyTestMode(!state.keepInput);
});

// --- Opnamemodi: Vraag & Antwoord / Vrij gesprek ---
btnInvoer?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  void startRealtimeQaConversation();
});

btnConversation?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  conversationPanelMode = "conversation";
  if (state.interview.active) {
    cancelInterview();
  }
  if (isRealtimeConversationRunning()) {
    stopRealtimeInterview();
  }
  if (isConversationRecording()) {
    void stopConversationRecording();
    return;
  }
  if (isConversationActive()) {
    return;
  }
  showInterviewPanel(false);
  void startConversationRecording();
});

btnInterviewNext?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  nextInterviewQuestion();
});

document.addEventListener("keydown", (e) => {
  if (!state.interview.active || state.interview.processingAnswer) return;
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
    return;
  }
  if (state.interview.recordingAnswer) {
    e.preventDefault();
    nextInterviewQuestion();
  }
});

btnInterviewFinish?.addEventListener("click", (e) => {
  e.preventDefault();
  endInterviewReport();
});

btnInterviewCancel?.addEventListener("click", (e) => {
  e.preventDefault();
  cancelInterview();
});

// --- Supplement (foto + mondelinge correctie) ---

btnSupplementProcess?.addEventListener("click", (e) => {
  e.preventDefault();
  supplementFile?.click();
});

supplementFile?.addEventListener("change", () => {
  const files = [...(supplementFile.files ?? [])];
  if (files.length) void ingestSupplementFiles(files, { autoProcess: true });
  supplementFile.value = "";
});

btnSupplementRemoveAudio?.addEventListener("click", (e) => {
  e.preventDefault();
  clearSupplementExcept("voice");
  renderSupplementAttachments();
  updateSupplementUi();
});

btnVoiceCorrect?.addEventListener("click", (e) => {
  e.preventDefault();
  if (reviewInlineCorrection.active) {
    void finalizeInlineCorrectionAndResume();
    return;
  }
  if (isSupplementVoiceListening()) {
    void finishSupplementVoiceCorrection();
    return;
  }
  if (state.reviewPlayback.active && isReviewInlineListening()) {
    handleReviewCorrectieCommand();
    return;
  }
  if (state.reviewPlayback.active && !REVIEW_INLINE_LISTEN_ENABLED) {
    return;
  }
  void startSupplementVoiceCorrection();
});

btnReviewRead?.addEventListener("click", () => {
  void startReviewPlayback();
});
btnReviewPause?.addEventListener("click", () => pauseReviewPlayback());
btnReviewResume?.addEventListener("click", () => resumeReviewPlayback());
btnReviewStop?.addEventListener("click", () => stopReviewPlayback());

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert(
      "Opnemen werkt alleen via https:// of http://localhost. Open MegaMinnie lokaal of op een beveiligde verbinding.",
    );
    return;
  }

  const isSupplement = recordContext === "supplement";
  const recState = isSupplement ? state.supplement : state;

  if (recState.recording) {
    stopRecording();
    return;
  }

  if (recState.mediaRecorder && recState.mediaRecorder.state !== "inactive") {
    try {
      recState.mediaRecorder.stop();
    } catch {
      /* vorige sessie opruimen */
    }
  }

  if (isSupplement) clearSupplementExcept("voice");
  else clearInputExcept("voice");
  recState.audioChunks = [];

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === "NotAllowedError";
    alert(
      denied
        ? "Microfoon geweigerd. Sta toegang toe in de browser, of kies een audiobestand."
        : "Microfoon niet beschikbaar. Kies een audiobestand of probeer een andere browser.",
    );
    return;
  }

  try {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const blobType = mimeType || recorder.mimeType || "audio/webm";
    recState.mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recState.audioChunks.push(e.data);
    };

    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      recState.recording = false;
      recState.mediaRecorder = null;
      if (isSupplement) {
        recState.autoProcessOnStop = false;
        updateVoiceCorrectUi();
      } else {
        setInterviewButtonUi(false);
      }
      showInputFeedback("Opname mislukt — probeer opnieuw of kies een audiobestand.", "error");
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recState.recording = false;
      if (isSupplement) {
        updateVoiceCorrectUi();
      } else {
        setInterviewButtonUi(false);
      }

      if (!recState.audioChunks.length) {
        showInputFeedback("Geen audio opgenomen — probeer opnieuw.", "error");
        if (isSupplement) {
          recState.autoProcessOnStop = false;
          updateVoiceCorrectUi();
          updateSupplementUi();
        } else {
          renderAttachments();
          updateProcessUi();
        }
        return;
      }

      const blob = new Blob(recState.audioChunks, { type: blobType });
      if (isSupplement) {
        recState.audioBlob = blob;
        recState.audioName = "correctie.webm";
        recState.autoProcessOnStop = false;
        updateVoiceCorrectUi();
        void processSupplement();
      } else {
        rememberMainAudio(blob, "opname.webm");
        showAudioPreview(blob);
        if (recordHint) {
          recordHint.textContent = state.keepInput
            ? "Testmodus: opname bewaard — opnieuw verwerken kan."
            : "";
          recordHint.hidden = !state.keepInput;
        }
        invalidateStaleResult();
        renderAttachments();
        updateProcessUi();
      }
    };

    if (!isSupplement) setActiveInputKind("voice");
    recorder.start(250);
    recState.recording = true;
    if (isSupplement) {
      updateVoiceCorrectUi();
    } else {
      setInterviewButtonUi(true);
      if (recordHint) {
        recordHint.textContent = "Opname loopt…";
        recordHint.hidden = false;
      }
    }
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    alert("Opnemen wordt niet ondersteund in deze browser. Kies een audiobestand.");
  }
}

function stopRecording() {
  const isSupplement = recordContext === "supplement";
  const recState = isSupplement ? state.supplement : state;
  const recorder = recState.mediaRecorder;

  if (!recorder || recorder.state === "inactive") {
    recState.recording = false;
    if (isSupplement) {
      updateVoiceCorrectUi();
    } else {
      setInterviewButtonUi(false);
      setInterviewButtonUi(false);
    }
    return;
  }
  try {
    recorder.stop();
  } catch {
    recState.recording = false;
    if (isSupplement) {
      updateVoiceCorrectUi();
    } else {
      setInterviewButtonUi(false);
      setInterviewButtonUi(false);
    }
  }
}

/** @param {Blob | File} blob */
function showAudioPreview(blob) {
  state.audioBlob = blob;
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(blob);
  if (audioPreview) {
    audioPreview.src = audioObjectUrl;
  }
  if (audioReview) audioReview.hidden = false;
}

// --- Foto's (verwerking/compressie gebeurt op de server met sharp) ---
/** @param {File[]} files */
async function addPhotos(files) {
  const imageFiles = files.filter(isImageFile);
  if (!imageFiles.length) return;

  clearInputExcept("photo");
  setInputBusy(true, "Foto's laden…", { lockActions: false });
  try {
    for (const file of imageFiles) {
      state.photos.push({
        id: `p-${++photoIdCounter}`,
        file,
        url: URL.createObjectURL(file),
      });
      await yieldToMain();
    }

    setActiveInputKind("photo");
    state.lastResult = null;
    updateOutputVisibility();
    hideFeedback();
    hideInputFeedback();
    renderAttachments();
    updateFlowSteps();
    renderInputSummary();
    updateProcessUi();
    if (state.keepInput) {
      void persistTestPhotos(state.photos);
    }
  } finally {
    setInputBusy(false);
  }
}

function removePhoto(id) {
  const item = state.photos.find((p) => p.id === id);
  if (item) URL.revokeObjectURL(item.url);
  state.photos = state.photos.filter((p) => p.id !== id);
  if (!state.photos.length && !state.audioBlob && !getTextContent()) {
    state.lastResult = null;
  } else if (!state.photos.length) {
    if (state.activeInputKind === "photo") {
      state.activeInputKind = hasValidAudio()
        ? "voice"
        : getTextContent()
          ? "text"
          : null;
      bumpInputGeneration();
    }
  }
  invalidateStaleResult();
  renderAttachments();
  updateFlowSteps();
  updateProcessUi();
}

function removeDocument(name) {
  state.documentNames = state.documentNames.filter((n) => n !== name);
  const marker = `\n\n--- ${name} ---\n`;
  const current = textInput?.value ?? "";
  if (current.includes(marker)) {
    textInput.value = current.split(marker).join("").trim();
  }
  if (!getTextContent()) hideManualPanel();
  invalidateStaleResult();
  renderAttachments();
  updateProcessUi();
}

function renderAttachments() {
  if (!inputAttachments) return;

  const hasPhotos = state.photos.length > 0;
  const hasAudio = Boolean(state.audioBlob);
  const hasDocs = state.documentNames.length > 0;
  const hasText = Boolean(getTextContent());

  updateAudioReview();

  if (!hasPhotos && !hasAudio && !hasDocs) {
    inputAttachments.hidden = true;
    inputAttachments.innerHTML = "";
    return;
  }

  inputAttachments.hidden = false;
  inputAttachments.innerHTML = "";

  if (hasPhotos) {
    const gallery = document.createElement("div");
    gallery.className = "photo-gallery";
    for (const p of state.photos) {
      const wrap = document.createElement("div");
      wrap.className = "photo-thumb";
      wrap.innerHTML = `
        <img src="${p.url}" alt="${escapeHtml(p.file.name)}" />
        <button type="button" class="photo-thumb__remove" data-id="${p.id}" aria-label="Verwijder foto">×</button>
      `;
      wrap.querySelector(".photo-thumb__remove")?.addEventListener("click", (e) => {
        e.stopPropagation();
        removePhoto(p.id);
      });
      gallery.appendChild(wrap);
    }
    inputAttachments.appendChild(gallery);
  }

  if (hasDocs) {
    const docs = document.createElement("div");
    docs.className = "attachment-docs";
    for (const name of state.documentNames) {
      const chip = document.createElement("span");
      chip.className = "input-chip";
      chip.innerHTML = `<span>📄 ${escapeHtml(name)}</span><button type="button" aria-label="Verwijder document">×</button>`;
      chip.querySelector("button")?.addEventListener("click", () => removeDocument(name));
      docs.appendChild(chip);
    }
    inputAttachments.appendChild(docs);
  }

  if (hasText && !hasDocs && !isManualPanelOpen()) {
    const note = document.createElement("p");
    note.className = "attachment-note";
    note.textContent = "Handmatige tekst — klik op Handmatige invoer om te bewerken.";
    inputAttachments.appendChild(note);
  }
}

/** Huidige stap 1–4; 5 = alles afgerond (Salesforce geüpload). */
function getWorkflowStep() {
  const uploaded =
    Boolean(state.lastResult?.salesforce?.noteId) &&
    !state.lastResult?.salesforce?.dryRun;
  if (uploaded) return 5;
  if (state.lastResult) return 3;
  if (isInitialReportProcessing() || isOutputProcessing()) return 2;
  if (hasAnyInput()) return 2;
  return 1;
}

function updateFlowSteps() {
  if (!flowSteps) return;

  const current = getWorkflowStep();
  const processing =
    isInitialReportProcessing() ||
    (isOutputProcessing() && !state.lastResult);
  const allDone = current >= 5;
  const progress =
    allDone ? 100 : Math.max(0, Math.min(100, ((current - 1) / 3) * 100));

  flowSteps.style.setProperty("--progress", `${progress}%`);
  flowSteps.classList.toggle("is-processing", processing);
  flowSteps.classList.toggle("is-all-done", allDone);

  flowSteps.querySelectorAll(".workflow-timeline__step").forEach((li, i) => {
    const step = i + 1;
    li.classList.remove("is-done", "is-active");
    li.removeAttribute("aria-current");

    if (allDone) {
      li.classList.add("is-done");
      return;
    }
    if (step < current) li.classList.add("is-done");
    if (step === current) {
      li.classList.add("is-active");
      li.setAttribute("aria-current", "step");
    }
  });

  const step2Label = flowSteps.querySelector(
    '.workflow-timeline__step[data-step="2"] .workflow-timeline__label',
  );
  if (step2Label) {
    if (processing && activeProcessingPhase === 1) {
      step2Label.textContent = "Verwerken…";
    } else if (processing && activeProcessingPhase === 2) {
      step2Label.textContent = "Uitwerken…";
    } else if (processing) {
      step2Label.textContent = "Bezig…";
    } else {
      step2Label.textContent = "Laat MegaMinnie uitwerken";
    }
  }
}

function renderInputSummary() {
  if (!inputSummary) return;
  const chips = [];
  const types =
    (state.photos.length ? 1 : 0) +
    (state.audioBlob ? 1 : 0) +
    (getTextContent() ? 1 : 0);

  if (types < 2) {
    inputSummary.hidden = true;
    inputSummary.innerHTML = "";
    return;
  }

  if (state.photos.length) {
    chips.push({
      label: state.photos.length === 1 ? "1 foto" : `${state.photos.length} foto's`,
      remove: () => {
        state.photos.forEach((p) => URL.revokeObjectURL(p.url));
        state.photos = [];
        renderAttachments();
        updateFlowSteps();
        updateProcessUi();
      },
    });
  }

  if (state.audioBlob) {
    chips.push({
      label: state.audioName || "Audio",
      remove: () => {
        clearAudio();
        updateProcessUi();
      },
    });
  }

  for (const name of state.documentNames) {
    chips.push({
      label: name,
      remove: () => removeDocument(name),
    });
  }

  if (!chips.length) {
    inputSummary.hidden = true;
    inputSummary.innerHTML = "";
    return;
  }

  inputSummary.hidden = false;
  inputSummary.innerHTML = "";
  for (const chip of chips) {
    const el = document.createElement("span");
    el.className = "input-chip";
    el.innerHTML = `<span>${escapeHtml(chip.label)}</span><button type="button" aria-label="Verwijder">×</button>`;
    el.querySelector("button")?.addEventListener("click", chip.remove);
    inputSummary.appendChild(el);
  }
}

textInput?.addEventListener("input", () => {
  if (!getTextContent()) {
    state.documentNames = [];
    if (state.activeInputKind === "text") {
      state.activeInputKind = hasValidAudio()
        ? "voice"
        : state.photos.length
          ? "photo"
          : null;
      bumpInputGeneration();
    }
  } else if (state.activeInputKind !== "text") {
    clearInputExcept("text");
    setActiveInputKind("text");
    invalidateStaleResult();
  } else {
    invalidateStaleResult();
  }
  renderAttachments();
  updateFlowSteps();
  updateProcessUi();
});

textInput?.addEventListener("focus", () => {
  if (!isManualPanelOpen()) showManualPanel();
});

// --- API ---
function beginRequest() {
  activeRequestId++;
  activeAbort?.abort();
  const controller = new AbortController();
  activeAbort = controller;
  return { requestId: activeRequestId, signal: controller.signal, controller };
}

function isRequestActive(requestId) {
  return requestId === activeRequestId;
}

function stopActiveProcessing(feedback) {
  stopProgressTicker();
  activeRequestId++;
  activeProcessId++;
  activeAbort?.abort();
  activeAbort = null;
  endProcessingUI();
  setInputBusy(false);
  if (feedback) showFeedback(feedback, "error");
}

function isAbortError(err) {
  return err?.name === "AbortError";
}

function handleStopClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const hadResult = Boolean(state.lastResult);
  stopActiveProcessing("Verwerking gestopt.");
  if (!hadResult) cancelResultProcessing();
  updateOutputVisibility();
}

outputPanel?.addEventListener("click", (e) => {
  if (e.target.closest("#btn-cancel-loading")) handleStopClick(e);
});

inputPanel?.addEventListener("click", (e) => {
  if (e.target.closest("#btn-cancel-process, #btn-cancel-drop")) handleStopClick(e);
});

btnProcess?.addEventListener("click", () => processReport());

/** @param {VisitReportResult} result @param {"photo"|"voice"|"text"|"interview"} expectedMode */
function assertResultSource(result, expectedMode) {
  const expectedSource =
    expectedMode === "text" ? "voice" : expectedMode;
  if (result.source !== expectedSource) {
    throw new Error(
      expectedMode === "voice"
        ? "Het antwoord kwam van een foto, niet van je opname. Verwijder het concept, neem opnieuw op en klik meteen op Zet MegaMinnie aan het werk."
        : `Verkeerde verwerkingsbron (verwacht ${expectedSource}, ontvangen ${result.source}).`,
    );
  }
}

async function processReport() {
  const mode = resolveInputMode();
  if (!mode) {
    if (isAudioReviewVisible() || state.activeInputKind === "voice") {
      alert(
        "Je opname is leeg of ongeldig. Beluister hem, neem opnieuw op of verwijder hem en probeer opnieuw.",
      );
      return;
    }
    alert("Voeg eerst een foto, audio of tekst toe.");
    return;
  }

  const snapshot = createProcessSnapshot(mode);
  if (!snapshot) {
    alert(
      mode === "voice"
        ? "Geen geldige opname gevonden. Neem opnieuw op of kies een audiobestand."
        : mode === "photo"
          ? "Geen foto's om te verwerken."
          : "Typ eerst tekst in het notitieveld.",
    );
    return;
  }

  const expectedSource = expectedSourceForMode(mode);
  if (state.lastResult?.source && state.lastResult.source !== expectedSource) {
    clearDraftResult();
  }

  const processId = ++activeProcessId;
  const processInputGeneration = inputGeneration;

  stripOtherInputsForProcess(mode);
  stopReviewPlayback();

  const { requestId, signal } = beginRequest();
  const loadingMsg = getLoadingMessage(mode);
  updateFlowSteps();
  setInputBusy(true, loadingMsg);
  hideFeedback();

  try {
    /** @type {VisitReportResult} */
    let result;
    /** @type {string | undefined} */
    let transcriptionQualityWarning;

    if (snapshot.mode === "photo") {
      setProcessingPhase({
        phase: 1,
        transcribing: true,
        progress: 3,
      });
      const fd = formFields();
      for (const p of snapshot.photos) {
        fd.append("photos", p.file, p.name);
      }
      result = await runWithProgressTicker(
        3,
        98,
        estimatePhotoDurationMs(snapshot.photos.length, snapshot.photos),
        () =>
          apiPost("/api/visit-report/photo", {
            method: "POST",
            body: fd,
            signal,
          }),
      );
      applyProgressPct(100);
    } else if (snapshot.mode === "voice") {
      setProcessingPhase({
        phase: 1,
        transcribing: true,
        progress: 3,
        message: "Stap 1/2: Verwerken van je opname…",
      });
      const fdTranscribe = formFields();
      fdTranscribe.append("audio", snapshot.audio, snapshot.audioName);
      const transcribeResult = await runWithProgressTicker(
        3,
        48,
        estimateTranscribeDurationMs(snapshot.audio),
        () =>
          apiPost("/api/visit-report/transcribe", {
            method: "POST",
            body: fdTranscribe,
            signal,
          }),
      );
      const transcript =
        typeof transcribeResult.text === "string" ? transcribeResult.text : "";
      transcriptionQualityWarning = transcribeResult.qualityWarning;

      setProcessingPhase({
        phase: 2,
        progress: 50,
        transcribing: false,
        message: "Stap 2/2: Uitwerken…",
      });
      result = await runWithProgressTicker(
        50,
        98,
        estimateLlmDurationMs(transcript.length),
        () =>
          apiPost("/api/visit-report/text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: transcript,
              source: "voice",
            }),
            signal,
          }),
      );
      applyProgressPct(100);
      result = { ...result, transcript };
    } else {
      setProcessingPhase({
        phase: 1,
        transcribing: false,
        progress: 3,
        message: "Uitwerken…",
      });
      result = await runWithProgressTicker(
        3,
        98,
        estimateLlmDurationMs(snapshot.text.length),
        () =>
          apiPost("/api/visit-report/text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: snapshot.text,
              source: "voice",
            }),
            signal,
          }),
      );
      applyProgressPct(100);
    }

    if (!isRequestActive(requestId)) return;
    if (processId !== activeProcessId) {
      showProcessingError("Verwerking afgebroken door een nieuwe actie.");
      return;
    }
    if (processInputGeneration !== inputGeneration) {
      showProcessingError(
        "Invoer gewijzigd tijdens verwerken. Klik opnieuw op Zet MegaMinnie aan het werk.",
      );
      return;
    }

    assertResultSource(result, mode);

    state.lastResult = result;
    updateFlowSteps();
    renderResult(result);
    if (transcriptionQualityWarning) showQualityWarning(transcriptionQualityWarning);
    clearAllInputSources();
    updateProcessUi();
    if (outputPanel && !outputPanel.hidden) {
      outputPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch (err) {
    if (!isRequestActive(requestId)) return;
    if (isAbortError(err)) return;
    showProcessingError(
      err instanceof Error ? err.message : "Verwerken mislukt",
    );
  } finally {
    if (isRequestActive(requestId)) {
      activeAbort = null;
      setInputBusy(false);
    }
  }
}

/** @param {File[]} files @param {{ autoProcess?: boolean }} [opts] */
async function ingestSupplementFiles(files, opts = {}) {
  const images = files.filter(isImageFile);
  if (images.length) {
    clearSupplementExcept("photo");
    for (const file of images) {
      state.supplement.photos.push({
        id: `s-${++supplementPhotoIdCounter}`,
        file,
        url: URL.createObjectURL(file),
      });
    }
  } else {
    alert(
      "Kies een foto om te verwerken. Voor mondelinge correcties gebruik 'Mondeling corrigeren'.",
    );
    return;
  }
  renderSupplementAttachments();
  updateSupplementUi();
  if (opts.autoProcess) {
    await processSupplement();
  }
}

/** @param {{ supplementText?: string; resumeReviewAfter?: boolean }} [opts] */
async function processSupplement(opts = {}) {
  if (!state.lastResult) {
    alert("Laat MegaMinnie eerst een concept uitwerken.");
    return;
  }

  const directText = opts.supplementText?.trim() ?? "";
  const mode = directText ? "voice" : resolveSupplementMode();
  if (!mode) {
    alert("Voeg een foto toe, of spreek een correctie in via 'Mondeling corrigeren'.");
    return;
  }

  const existing = getExistingMegaMinnieFromUi();
  if (!existing) {
    alert("Notitietitel en -tekst mogen niet leeg zijn.");
    return;
  }

  if (directText) {
    const processId = ++activeProcessId;
    const { requestId, signal } = beginRequest();
    const resumeReviewAfter =
      opts.resumeReviewAfter === true && Boolean(state.reviewPlayback.suspendForCorrection);
    if (resumeReviewAfter) {
      invalidateReviewPlaybackSession();
      state.reviewPlayback.suppressLoopCleanup = true;
      abortReviewPlaybackLoop();
    } else {
      stopReviewPlayback();
    }
    setBusy(true, "Mondeling correctie verwerken…");
    setProcessingPhase({
      phase: 2,
      progress: 50,
      transcribing: false,
      message: "Stap 2/2: Uitwerken…",
    });
    hideFeedback();

    try {
      const result = await runWithProgressTicker(
        50,
        98,
        estimateLlmDurationMs(directText.length),
        () => {
          const fd = formFields();
          fd.append("existing", JSON.stringify(existing));
          fd.append("supplementText", directText);
          return apiPost("/api/visit-report/extend", {
            method: "POST",
            body: fd,
            signal,
          });
        },
      );
      applyProgressPct(100);

      if (!isRequestActive(requestId)) return;
      if (processId !== activeProcessId) return;

      state.lastResult = { ...result, transcript: directText };
      renderResult(result);
      clearSupplement();
      updateSupplementUi();
      showProcessingSuccessWithQualityWarning(
        "Concept bijgewerkt met je correctie.",
        undefined,
      );
      if (resumeReviewAfter) {
        state.reviewPlayback.cancelled = false;
        if (!resumeReviewPlaybackInPlace()) {
          await resumeReviewPlaybackAfterCorrection();
        }
      }
    } catch (err) {
      if (!isRequestActive(requestId)) return;
      if (isAbortError(err)) return;
      showProcessingError(
        err instanceof Error ? err.message : "Bijwerken mislukt",
      );
    } finally {
      if (isRequestActive(requestId)) {
        activeAbort = null;
        setBusy(false);
      }
    }
    return;
  }

  const snapshot =
    mode === "voice"
      ? {
          mode: "voice",
          audio: state.supplement.audioBlob,
          audioName: state.supplement.audioName || "aanvulling.webm",
        }
      : {
          mode: "photo",
          photos: state.supplement.photos.map((p) => ({
            file: p.file,
            name: p.file.name,
          })),
        };

  if (mode === "voice" && !snapshot.audio?.size) {
    alert("Geen geldige opname om toe te voegen.");
    return;
  }
  if (mode === "photo" && !snapshot.photos.length) {
    alert("Geen foto's om toe te voegen.");
    return;
  }

  const processId = ++activeProcessId;
  const { requestId, signal } = beginRequest();
  const loadingMsg =
    mode === "voice"
      ? "Mondeling correctie verwerken…"
      : "Extra foto verwerken en concept bijwerken…";
  stopReviewPlayback();
  setBusy(true, loadingMsg);
  if (mode === "voice") {
    setProcessingPhase({
      phase: 1,
      transcribing: true,
      progress: 3,
      message: "Stap 1/2: Verwerken van je correctie…",
    });
  } else {
    setProcessingPhase({
      phase: 1,
      transcribing: true,
      progress: 3,
    });
  }
  hideFeedback();

  try {
    /** @type {VisitReportResult} */
    let result;
    /** @type {string | undefined} */
    let transcriptionQualityWarning;

    if (snapshot.mode === "voice") {
      const fdTranscribe = formFields();
      fdTranscribe.append("audio", snapshot.audio, snapshot.audioName);
      const transcribeResult = await runWithProgressTicker(
        3,
        48,
        estimateTranscribeDurationMs(snapshot.audio),
        () =>
          apiPost("/api/visit-report/transcribe", {
            method: "POST",
            body: fdTranscribe,
            signal,
          }),
      );
      const transcript =
        typeof transcribeResult.text === "string" ? transcribeResult.text : "";
      transcriptionQualityWarning = transcribeResult.qualityWarning;

      setProcessingPhase({
        phase: 2,
        progress: 50,
        transcribing: false,
        message: "Stap 2/2: Uitwerken…",
      });

      const fd = formFields();
      fd.append("existing", JSON.stringify(existing));
      fd.append("supplementText", transcript);
      result = await runWithProgressTicker(
        50,
        98,
        estimateLlmDurationMs(transcript.length),
        () =>
          apiPost("/api/visit-report/extend", {
            method: "POST",
            body: fd,
            signal,
          }),
      );
      applyProgressPct(100);
      result = { ...result, transcript };
    } else {
      const fd = formFields();
      fd.append("existing", JSON.stringify(existing));
      for (const p of snapshot.photos) {
        fd.append("photos", p.file, p.name);
      }
      result = await runWithProgressTicker(
        3,
        98,
        estimatePhotoDurationMs(snapshot.photos.length, snapshot.photos),
        () =>
          apiPost("/api/visit-report/extend", {
            method: "POST",
            body: fd,
            signal,
          }),
      );
      applyProgressPct(100);
    }

    if (!isRequestActive(requestId)) return;
    if (processId !== activeProcessId) return;

    state.lastResult = result;
    renderResult(result);
    clearSupplement();
    updateSupplementUi();
    showProcessingSuccessWithQualityWarning(
      "Concept bijgewerkt met je correctie.",
      transcriptionQualityWarning,
    );
  } catch (err) {
    if (!isRequestActive(requestId)) return;
    if (isAbortError(err)) return;
    showProcessingError(
      err instanceof Error ? err.message : "Bijwerken mislukt",
    );
  } finally {
    if (isRequestActive(requestId)) {
      activeAbort = null;
      setBusy(false);
    }
  }
}

/** @param {"photo"|"voice"|"text"} mode */
function getLoadingMessage(mode) {
  if (mode === "photo") {
    return "Bezig met je foto… je ziet hieronder de voortgang.";
  }
  if (mode === "voice") {
    return "Bezig met je opname… je ziet hieronder de voortgang.";
  }
  return "Bezig met je tekst… je ziet hieronder de voortgang.";
}

function cancelResultProcessing() {
  clearNoteTitle();
  clearNoteBody();
  updateOutputVisibility();
}

function showProcessingError(message) {
  endProcessingUI();
  showInputFeedback(message, "error");
}

function isPhotoInputReady() {
  return (
    !state.interview.active &&
    state.photos.length > 0 &&
    resolveInputMode() === "photo" &&
    !inputPanel?.classList.contains("is-input-busy") &&
    !outputPanel?.classList.contains("is-busy")
  );
}

function updateInputChrome() {
  inputPanel?.classList.toggle("is-photo-ready", isPhotoInputReady());
  inputPanel?.classList.toggle("is-manual-open", isManualPanelOpen());
}

function updateProcessUi() {
  invalidateStaleResult();
  renderInputSummary();
  updateFlowSteps();
  placeProcessButton();
  updateInputChrome();

  if (state.interview.active) {
    btnProcess.disabled = true;
    if (processHint) {
      processHint.textContent = "Interview loopt — maak het verslag af met “Einde verslag”.";
      processHint.hidden = false;
    }
    return;
  }

  if (isRecordModeUiActive()) {
    btnProcess.disabled = true;
    if (processHint) {
      if (conversationPanelMode === "realtime-qa") {
        if (realtimeController?.isConnecting()) {
          processHint.textContent = "Vraag & Antwoord verbinden…";
        } else if (isRealtimeConversationRunning()) {
          processHint.textContent =
            "Vraag & Antwoord loopt — zeg “stop” om uit te werken of “annuleer” om te stoppen zonder verwerking.";
        } else {
          processHint.textContent = "Vraag & Antwoord wordt afgerond…";
        }
      } else if (isConversationRecording()) {
        processHint.textContent =
          "Gespreksopname loopt — klik nogmaals op Opname gesprek om te stoppen.";
      } else if (isConversationActive()) {
        processHint.textContent = "Gesprek wordt verwerkt…";
      }
      processHint.hidden = false;
    }
    return;
  }

  const mode = resolveInputMode();
  btnProcess.disabled = !mode;
  processHint.hidden = false;

  if (!mode) {
    if (state.lastResult) {
      processHint.textContent = "";
      processHint.hidden = true;
    } else {
      processHint.textContent = "";
      processHint.hidden = true;
    }
    return;
  }

  if (state.lastResult) {
    if (mode === "photo") {
      processHint.textContent = "";
      processHint.hidden = true;
    } else {
      const label = INPUT_MODE_LABELS[mode] ?? mode;
      processHint.textContent = `Nieuwe invoer (${label})? Klik opnieuw op Zet MegaMinnie aan het werk.`;
      processHint.hidden = false;
    }
    return;
  }

  const preHints = {
    voice: "",
    photo: "",
    text: "",
  };
  processHint.textContent = preHints[mode] ?? "";
  processHint.hidden = !processHint.textContent;
}

const SF_TYPE_LABELS = {
  Account: "Account",
  Contact: "Contact",
  Opportunity: "Opportunity",
};

/** @param {string} message */
function setSfLinkHint(message) {
  if (!sfLinkHint) return;
  const text = message.trim();
  sfLinkHint.textContent = text;
  sfLinkHint.hidden = !text;
}

/** @param {SalesforceRecordHit} hit */
function selectSfRecord(hit) {
  state.sfSelected = hit;
  if (recordIdInput) recordIdInput.value = hit.id;
  renderSfSelected();
  updateSyncButton();
  setSfLinkHint(
    `Gekoppeld aan ${SF_TYPE_LABELS[hit.type] ?? hit.type}: ${hit.name}`,
  );
}

function clearSfSelection() {
  state.sfSelected = null;
  if (recordIdInput) recordIdInput.value = "";
  if (sfSelectedEl) sfSelectedEl.hidden = true;
  updateSyncButton();
}

function renderSfSelected() {
  if (!sfSelectedEl || !state.sfSelected) {
    if (sfSelectedEl) sfSelectedEl.hidden = true;
    return;
  }
  const hit = state.sfSelected;
  sfSelectedEl.hidden = false;
  sfSelectedEl.innerHTML = `
    <div class="sf-selected__chip">
      <span class="sf-selected__badge">${escapeHtml(SF_TYPE_LABELS[hit.type] ?? hit.type)}</span>
      <span class="sf-selected__name">${escapeHtml(hit.name)}</span>
      ${hit.subtitle ? `<span class="sf-selected__sub">${escapeHtml(hit.subtitle)}</span>` : ""}
      <button type="button" class="sf-selected__change btn btn--ghost btn--compact">Wijzigen</button>
    </div>
  `;
  sfSelectedEl.querySelector(".sf-selected__change")?.addEventListener("click", () => {
    clearSfSelection();
    setSfLinkHint("Kies een voorstel of zoek een andere klant.");
    sfSearchInput?.focus();
  });
}

/** @param {SalesforceRecordHit[]} hits */
function renderSfHitList(listEl, hits, { emptyHidden = true } = {}) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!hits.length) {
    listEl.hidden = emptyHidden;
    return;
  }
  listEl.hidden = false;
  for (const hit of hits) {
    const li = document.createElement("li");
    li.className = "sf-hit";
    li.innerHTML = `
      <button type="button" class="sf-hit__btn">
        <span class="sf-hit__type">${escapeHtml(SF_TYPE_LABELS[hit.type] ?? hit.type)}</span>
        <span class="sf-hit__name">${escapeHtml(hit.name)}</span>
        ${hit.subtitle ? `<span class="sf-hit__sub">${escapeHtml(hit.subtitle)}</span>` : ""}
      </button>
    `;
    li.querySelector(".sf-hit__btn")?.addEventListener("click", () => selectSfRecord(hit));
    listEl.appendChild(li);
  }
}

function formatExtractedCustomer(c) {
  if (!c) return "";
  const parts = [];
  if (c.accountName) parts.push(`bedrijf: ${c.accountName}`);
  if (c.contactName) parts.push(`contact: ${c.contactName}`);
  if (c.email) parts.push(c.email);
  if (c.opportunityName) parts.push(`opportunity: ${c.opportunityName}`);
  return parts.join(" · ");
}

/** @param {VisitReportResult} result */
function renderSalesforceLink(result) {
  if (!sfLink) return;
  sfLink.hidden = false;

  const link = result.salesforceLink;
  const configured = link?.configured ?? state.salesforceConfigured;

  if (sfSearchInput) sfSearchInput.value = "";
  if (sfSearchResults) {
    sfSearchResults.innerHTML = "";
    sfSearchResults.hidden = true;
  }
  const sfSearchWrap = $("sf-search-wrap");
  const sfSearchBlock = $("sf-search-block");
  if (sfSearchInput) sfSearchInput.disabled = !configured;
  if (sfSearchWrap) sfSearchWrap.classList.toggle("is-disabled", !configured);
  if (sfSearchBlock) sfSearchBlock.hidden = false;

  if (!configured) {
    if (sfExtracted) sfExtracted.hidden = true;
    if (sfSuggestionsWrap) sfSuggestionsWrap.hidden = true;
    setSfLinkHint("Salesforce is nog niet gekoppeld.");
    clearSfSelection();
    return;
  }

  setSfLinkHint("");

  const extracted = link?.extractedCustomer ?? result.megaMinnie.customer;
  const extractedText = formatExtractedCustomer(extracted);
  if (sfExtracted) {
    if (extractedText) {
      sfExtracted.hidden = false;
      sfExtracted.textContent = `Uit je invoer: ${extractedText}`;
    } else {
      sfExtracted.hidden = true;
    }
  }

  const suggestions = link?.suggestions ?? [];
  if (sfSuggestionsWrap && sfSuggestions) {
    if (suggestions.length) {
      sfSuggestionsWrap.hidden = false;
      renderSfHitList(sfSuggestions, suggestions, { emptyHidden: true });
    } else {
      sfSuggestionsWrap.hidden = true;
      sfSuggestions.innerHTML = "";
    }
  }

  if (link?.autoSelected) {
    selectSfRecord(link.autoSelected);
    setSfLinkHint("Automatisch gekoppeld — controleer of dit klopt.");
  } else if (suggestions.length) {
    clearSfSelection();
    setSfLinkHint("Geen eenduidige match. Kies een voorstel of zoek de klant.");
  } else {
    clearSfSelection();
    setSfLinkHint(
      extractedText
        ? "Klant niet gevonden in Salesforce. Zoek op bedrijf, contact of opportunity."
        : "Geen klantnaam herkend in je invoer. Zoek handmatig de juiste klant.",
    );
  }
}

function updateSyncButton() {
  if (!btnSync) return;
  const canSync =
    Boolean(state.lastResult) &&
    Boolean(state.sfSelected?.id) &&
    state.salesforceConfigured;
  btnSync.disabled = !canSync;
  if (!canSync) {
    let hint = "Upload naar Salesforce";
    if (!state.lastResult) hint = "Laat MegaMinnie eerst een verslag uitwerken";
    else if (!state.salesforceConfigured) hint = "Salesforce is niet geconfigureerd";
    else if (!state.sfSelected?.id) hint = "Kies eerst een klant in Salesforce";
    btnSync.title = hint;
  } else {
    btnSync.title = "Upload naar Salesforce";
  }
}

async function searchSalesforceManual(query) {
  if (!state.salesforceConfigured || query.length < 2) {
    if (sfSearchResults) {
      sfSearchResults.innerHTML = "";
      sfSearchResults.hidden = true;
    }
    return;
  }
  try {
    const res = await fetch(`/api/salesforce/search?q=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Zoeken mislukt (${res.status})`);
    renderSfHitList(sfSearchResults, data.results ?? [], { emptyHidden: false });
    if (sfSearchResults && !(data.results?.length)) {
      sfSearchResults.hidden = false;
      const li = document.createElement("li");
      li.className = "sf-hit sf-hit--empty";
      li.textContent = "Geen resultaten — probeer een andere zoekterm.";
      sfSearchResults.appendChild(li);
    }
  } catch (err) {
    showFeedback(
      err instanceof Error ? err.message : "Salesforce-zoeken mislukt",
      "error",
    );
  }
}

sfSearchInput?.addEventListener("input", () => {
  const q = sfSearchInput.value.trim();
  clearTimeout(sfSearchTimer);
  sfSearchTimer = window.setTimeout(() => searchSalesforceManual(q), 350);
});

/** @param {string} text */
function formatNoteBodyMarkdownToHtml(text) {
  const lines = text.split("\n");
  /** @type {string[]} */
  const parts = [];
  /** @type {"line"|"gap"|null} */
  let last = null;

  /** @param {string} html */
  const pushLine = (html) => {
    if (last === "line") parts.push("<br>");
    parts.push(html);
    last = "line";
  };

  const pushGap = () => {
    parts.push('<span class="note-body__gap" aria-hidden="true"></span>');
    last = "gap";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      const prev = lines[i - 1]?.trim() ?? "";
      if (/^\*\*[^*]+\*\*:?\s*$/.test(prev)) continue;
      pushGap();
      continue;
    }
    const match = line.match(/^\*\*([^*]+)\*\*(.*)$/);
    if (match) {
      const suffix = match[2] ? escapeHtml(match[2]) : "";
      pushLine(`<strong>${escapeHtml(match[1])}</strong>${suffix}`);
    } else {
      pushLine(escapeHtml(line));
    }
  }
  return parts.join("");
}

/** @param {string} html */
function noteBodyInnerHtmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  /** @param {Node} node */
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeName === "STRONG" || node.nodeName === "B") {
      return `**${node.textContent ?? ""}**`;
    }
    if (
      node.nodeName === "SPAN" &&
      node instanceof HTMLElement &&
      node.classList.contains("note-body__gap")
    ) {
      return "\n\n";
    }
    if (node.nodeName === "BR") return "\n";
    if (node.nodeName === "DIV" || node.nodeName === "P") {
      let inner = "";
      for (const child of node.childNodes) inner += walk(child);
      return `${inner}\n`;
    }
    let out = "";
    for (const child of node.childNodes) out += walk(child);
    return out;
  };
  let text = "";
  for (const child of doc.body.childNodes) text += walk(child);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function getNoteTitle() {
  const el = $("note-title");
  if (!el) return "";
  if ("value" in el && typeof el.value === "string") return el.value.trim();
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** @param {string} text */
function setNoteTitle(text) {
  const el = $("note-title");
  if (!el) return;
  if ("value" in el && typeof el.value === "string") {
    el.value = text;
  } else {
    el.textContent = text;
  }
}

function clearNoteTitle() {
  const el = $("note-title");
  if (!el) return;
  if ("value" in el && typeof el.value === "string") {
    el.value = "";
    el.placeholder = "";
  } else {
    el.textContent = "";
  }
}

function getNoteBodyMarkdown() {
  const el = $("note-body");
  if (!el) return "";
  if ("value" in el && typeof el.value === "string") return el.value.trim();
  return noteBodyInnerHtmlToMarkdown(el.innerHTML);
}

function getNoteBodyForSpeech() {
  const el = $("note-body");
  const fallback = state.lastResult?.megaMinnie?.salesforceNote?.body?.trim() ?? "";
  if (!el) return fallback;
  if ("value" in el && typeof el.value === "string") {
    return el.value.trim() || fallback;
  }
  const fromInnerText = (el.innerText ?? el.textContent ?? "").trim();
  if (fromInnerText) return fromInnerText;
  return noteBodyInnerHtmlToMarkdown(el.innerHTML).trim() || fallback;
}

/** @param {string} text */
function setNoteBodyMarkdown(text) {
  const el = $("note-body");
  if (!el) return;
  if ("value" in el && typeof el.value === "string") {
    el.value = text;
  } else {
    el.innerHTML = formatNoteBodyMarkdownToHtml(text);
  }
  resizeNoteBody();
}

function clearNoteBody() {
  const el = $("note-body");
  if (!el) return;
  if ("value" in el && typeof el.value === "string") {
    el.value = "";
    el.placeholder = "";
  } else {
    el.innerHTML = "";
    el.removeAttribute("data-placeholder");
  }
}

/** Notitieveld: hoogte = volledige inhoud, geen scrollbalk in het veld */
function resizeNoteBody() {
  const el = $("note-body");
  if (!el) return;
  el.style.height = "auto";
  const min = 14 * 16; /* ~14rem */
  el.style.height = `${Math.max(el.scrollHeight, min)}px`;
}

$("note-body")?.addEventListener("input", resizeNoteBody);
$("note-title")?.addEventListener("input", resizeNoteBody);

/** @param {VisitReportResult} result */
function   renderResult(result) {
  updateOutputVisibility();
  $("result-area").style.opacity = "";
  clearNoteTitle();
  clearNoteBody();

  setNoteTitle(result.megaMinnie.salesforceNote.title);
  setNoteBodyMarkdown(result.megaMinnie.salesforceNote.body);

  renderSalesforceLink(result);

  renderTasksAndEvents(result, state.defaultAccountManager);
  updateReviewUi();
  prefetchReviewSpeech();

  const sf = result.salesforce;
  if (sf && !sf.dryRun && sf.noteId) {
    updateFlowSteps();
    const fb = formatSyncFeedback(sf);
    if (fb) showFeedback(fb.msg, fb.type);
  }
}

btnSync?.addEventListener("click", () => syncToSalesforce());

async function syncToSalesforce() {
  if (!state.lastResult) {
    alert("Laat MegaMinnie eerst het verslag uitwerken.");
    return;
  }
  const recordId = state.sfSelected?.id ?? recordIdInput?.value.trim() ?? "";
  if (!recordId) {
    alert("Koppel eerst een klant in Salesforce (voorstel kiezen of zoeken).");
    sfSearchInput?.focus();
    return;
  }
  const title = getNoteTitle();
  const body = getNoteBodyMarkdown();
  if (!title || !body) {
    alert("Notitietitel en -tekst mogen niet leeg zijn.");
    return;
  }

  const { requestId, signal } = beginRequest();
  setBusy(true, "MegaMinnie uploadt naar Salesforce…");
  hideFeedback();

  try {
    const megaMinnie = collectTasksEventsFromUi({
      ...state.lastResult.megaMinnie,
      salesforceNote: { title, body },
    }, state.defaultAccountManager);

    const result = await apiPost("/api/visit-report/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId,
        megaMinnie,
        rawInput: state.lastResult.rawInput,
        source: state.lastResult.source,
      }),
      signal,
    });

    if (!isRequestActive(requestId)) return;
    state.lastResult = result;
    renderResult(result);
    const fb = formatSyncFeedback(result.salesforce);
    if (fb) {
      if (!result.salesforce?.dryRun && result.salesforce?.noteId) updateFlowSteps();
      showFeedback(fb.msg, fb.type);
    }
  } catch (err) {
    if (!isRequestActive(requestId)) return;
    if (isAbortError(err)) return;
    showFeedback(err instanceof Error ? err.message : "Upload mislukt", "error");
  } finally {
    if (isRequestActive(requestId)) {
      setBusy(false);
      activeAbort = null;
    }
  }
}

$("btn-clear-draft")?.addEventListener("click", () => clearDraftResult());

$("btn-copy")?.addEventListener("click", async () => {
  const text = getNoteBodyMarkdown();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showFeedback("Notitie gekopieerd.", "success");
  } catch {
    alert("Kopiëren mislukt");
  }
});

function endProcessingUI() {
  setProcessingPhase({ phase: null });
  const loading = $("loading");
  if (outputPanel) outputPanel.classList.remove("is-busy");
  if (loading) {
    loading.classList.remove("is-open");
    loading.setAttribute("hidden", "");
  }
  if (btnCancelLoading) btnCancelLoading.setAttribute("hidden", "");
  btnProcess.disabled = !hasAnyInput();
  $("btn-sync").disabled = false;
}

function setBusy(busy, message) {
  const loading = $("loading");
  if (busy) {
    if (outputPanel) outputPanel.classList.add("is-busy");
    updateFlowSteps();
    if (loading) {
      loading.classList.add("is-open");
      loading.removeAttribute("hidden");
    }
    if (btnCancelLoading) btnCancelLoading.removeAttribute("hidden");
    if (message) $("loading-text").textContent = message;
    btnProcess.disabled = true;
    $("btn-sync").disabled = true;
    refreshDropzoneProcessingUi();
  } else {
    endProcessingUI();
    updateFlowSteps();
  }
}

placeProcessButton();
initTestModePreference();
initTasksEventsControls({
  getDefaultAssignee: () => state.defaultAccountManager,
  onItemsChanged: () => {
    if (!state.lastResult?.megaMinnie) return;
    const megaMinnie = collectTasksEventsFromUi(
      state.lastResult.megaMinnie,
      state.defaultAccountManager,
    );
    state.lastResult = { ...state.lastResult, megaMinnie };
  },
});

const shareReportEmail = initShareReportEmail({
  getReportContext: () => {
    if (!hasUitgewerktResult()) return null;
    const meetingSubject = getNoteTitle();
    const reportBody = getNoteBodyMarkdown();
    if (!meetingSubject || !reportBody) return null;

    const customer =
      state.lastResult?.megaMinnie?.customer ??
      state.lastResult?.salesforceLink?.extractedCustomer;

    return {
      meetingSubject,
      reportBody,
      contactName: customer?.contactName,
      recipientsInput: customer?.email ?? "",
      mailSignature: state.mailSignature,
    };
  },
  onFeedback: (message, type) => showFeedback(message, type),
});

initConversationRecording({
  showPanel: () => {},
  setRecordingUi: setConversationRecordingUi,
  updateTimer: () => {},
  updateAudioLevel: () => {},
  setStatus: setConversationStatus,
  setBusy: (busy, message) => setInputBusy(busy, message),
  setProcessingPhase,
  runWithProgressTicker,
  applyProgressPct,
  beginRequest,
  isRequestActive,
  clearInputExceptVoice: () => clearInputExcept("voice"),
  onTranscriptReady: (transcript) => {
    void persistConversationTranscript(transcript, { kind: "conversation" });
  },
  onResult: (result) => {
    state.lastResult = result;
    updateFlowSteps();
    renderResult(result);
    clearAllInputSources();
    updateProcessUi();
    if (outputPanel && !outputPanel.hidden) {
      outputPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  },
  onError: (message) => showInputFeedback(message, "error"),
  onCancel: () => updateProcessUi(),
});

realtimeController = createRealtimeInterviewController({
  setStatus: setRealtimeStatus,
  onStateChange: (rtState) => {
    if (conversationPanelMode !== "realtime-qa") return;
    setConversationRecordingUi(Boolean(rtState.active || rtState.connecting));
    if ((rtState.connecting || rtState.active) && !realtimeQaDraftActive) {
      beginRealtimeQaDraft();
    }
    updateProcessUi();
  },
  onTranscriptUpdate: (transcript) => {
    lastRealtimeTranscript = transcript;
    if (conversationPanelMode !== "realtime-qa") return;
    updateRealtimeQaDraft(transcript);
    scheduleRealtimeFinishCheckFromTranscript(transcript);
  },
  onTurn: (turn) => {
    if (conversationPanelMode !== "realtime-qa") return;
    if (isRealtimeConversationRunning()) {
      updateRealtimeQaDraft(realtimeController?.getTranscript?.() || lastRealtimeTranscript);
    }
    if (turn.role !== "user") return;
    if (!isRealtimeConversationRunning()) return;
    maybeHandleRealtimeQaVoiceCommand(turn.text);
  },
  onSpeechStopped: ({ pendingUserText, transcript }) => {
    if (conversationPanelMode !== "realtime-qa") return;
    if (!isRealtimeConversationRunning()) return;
    lastRealtimeTranscript = transcript;
    updateRealtimeQaDraft(transcript);
    maybeHandleRealtimeQaVoiceCommand(pendingUserText);
    scheduleRealtimeFinishCheckFromTranscript(transcript);
  },
  onError: (message) => {
    setRealtimeStatus("Fout bij realtime sessie");
    endRealtimeQaDraft({ restoreResult: true });
    showFeedback(message, "error");
  },
  onDebugEvent: (message) => {
    // Debug-only; active with ?realtimeDebug=1
    console.debug(message);
  },
});

supplementRealtimeController = createRealtimeInterviewController({
  sessionUrl: "/api/realtime/session/supplement",
  correctionDialogue: true,
  setStatus: updateReviewStatus,
  onStateChange: () => updateVoiceCorrectUi(),
  onError: (message) => showFeedback(message, "error"),
});

reviewInlineListenController = createRealtimeInterviewController({
  sessionUrl: "/api/realtime/session/listen",
  listenOnly: true,
  passiveListen: true,
  setStatus: updateReviewStatus,
  onSpeechStarted: () => handleReviewInlineSpeechStarted(),
  onTranscriptUpdate: (transcript) => {
    if (!state.reviewPlayback.active || reviewInlineCorrection.finalizeInFlight) return;
    const userText = extractLastRealtimeUserText(transcript);
    if (userText) maybeHandleReviewVoiceCommand(userText);
  },
  onTurn: (turn) => {
    if (turn.role === "user") handleReviewInlineUserTurn(turn.text);
  },
  onSpeechStopped: (ctx) => {
    handleReviewInlineSpeechStopped(ctx);
  },
  onConnectionLost: () => {
    if (!REVIEW_INLINE_LISTEN_ENABLED || !state.reviewPlayback.active) return;
    updateReviewStatus("Verbinding herstellen…");
    window.setTimeout(() => void ensureReviewInlineListen(), 500);
  },
  onStateChange: ({ active, connecting }) => {
    updateVoiceCorrectUi();
    if (
      !REVIEW_INLINE_LISTEN_ENABLED ||
      active ||
      connecting ||
      !state.reviewPlayback.active ||
      reviewInlineCorrection.finalizeInFlight
    ) {
      return;
    }
    window.setTimeout(() => void ensureReviewInlineListen(), 400);
  },
  onError: () => {
    if (!REVIEW_INLINE_LISTEN_ENABLED) {
      showFeedback("Realtime luisteren mislukt.", "error");
      return;
    }
    if (state.reviewPlayback.active) {
      updateReviewStatus("Verbinding herstellen…");
      window.setTimeout(() => void ensureReviewInlineListen(), 800);
      return;
    }
    showFeedback("Realtime luisteren mislukt.", "error");
  },
});
setRealtimeStatus("Niet verbonden");
setConversationRecordingUi(false);

updateProcessUi();
updateFlowSteps();
updateOutputVisibility();
updateSyncButton();
const onboardingTour = new OnboardingTour();
$("btn-tour-reset")?.addEventListener("click", () => onboardingTour.restart());
loadHealth().finally(() => onboardingTour.start());
syncProcessingGif(false);
