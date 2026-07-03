import { apiPost } from "./api.js";
import {
  CAPTURE_DIALOGUE_BRIEF_STYLE,
  CAPTURE_DIALOGUE_CLOSING_INSTRUCTION,
  stripAssistantEchoFromUserSpeech,
} from "./interview-commands.js";
import {
  alertMicrophoneError,
  buildMicrophoneConstraints,
  requestMicrophoneStream,
  stopMediaStream,
} from "./media-permissions.js";

export function requiresRemoteTrackBeforeOpening({
  listenOnly = false,
  passiveListen = false,
  captureDialogueKind = null,
  correctionDialogue = false,
  correctionDialogueActive = false,
} = {}) {
  const captureSession = Boolean(
    captureDialogueKind || correctionDialogue || correctionDialogueActive,
  );
  return !listenOnly && !passiveListen && !captureSession;
}

const OPENAI_REALTIME_WEBRTC_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
export const REALTIME_QA_OPENING_TEXT = "Hallo";
const OPENING_PROMPT =
  `Zeg nu hardop uitsluitend het ene woord "${REALTIME_QA_OPENING_TEXT}". ` +
  "Geen andere woorden, geen extra zin. Wacht daarna stil tot de gebruiker antwoordt.";
const OPENING_GREETING_FALLBACK_MS = 1500;
/** Correctie/taak/agenda: opening niet laten wachten op remote audio-track. */
const CAPTURE_OPENING_GREETING_FALLBACK_MS = 400;
/** Geen assistent-antwoord na opening → opnieuw proberen of fout tonen. */
const CAPTURE_OPENING_RESPONSE_TIMEOUT_MS = 12_000;
/** Mic mag nooit langer dan dit uit blijven (vastgelopen response). */
const ASSISTANT_ECHO_MIC_FAILSAFE_MS = 15_000;
/**
 * Android/Chrome schakelt de audio-output naar een zachtere "communicatie"-modus zodra de
 * microfoon (met echoCancellation/autoGainControl) volledig actief is voor de duplex-sessie.
 * De opening ("Hallo") speelt daardoor merkbaar luider dan de vragen die erna komen, terwijl
 * dezelfde <audio>-output op volume 1 staat. Versterk de ontvangen stem via een Web Audio
 * GainNode om dat verschil te compenseren; alleen actief voor de volledige Vraag & Antwoord-
 * sessie (niet voor de stille listen-only correctieflow).
 */
const REALTIME_QA_OUTPUT_GAIN = 1.6;
/** Mic uit tijdens Mini's antwoord + korte grace — voorkomt dat assistent-echo als gebruiker in STT komt. */
const ASSISTANT_ECHO_MIC_GRACE_MS = 500;

const CORRECTION_OPENING_PROMPT =
  "Zeg exact: 'Wat wil je corrigeren?' Geen inleiding, geen uitleg.";

const TASK_CAPTURE_OPENING_PROMPT =
  "Vraag in één korte zin: 'Waar gaat de taak over en wanneer moet die af?' " +
  "Daarna alleen nog wat echt ontbreekt — maximaal één verduidelijkingsvraag.";

const EVENT_CAPTURE_OPENING_PROMPT =
  "Vraag in één korte zin: 'Waar gaat de afspraak over en wanneer?' " +
  "Daarna alleen nog wat echt ontbreekt — maximaal één verduidelijkingsvraag.";

/**
 * @param {"correction"|"task"|"event"|null | undefined} kind
 * @param {string} [seedRemainder]
 */
export function buildCaptureDialogueOpeningPrompt(kind, seedRemainder = "") {
  const remainder = String(seedRemainder || "").replace(/\s+/g, " ").trim();
  let base;
  if (kind === "task") {
    base = remainder
      ? `De gebruiker gaf al taakinformatie: "${remainder}". Vraag niet opnieuw naar het onderwerp. ` +
        "Vraag alleen in één korte zin naar ontbrekende uiterste datum of verantwoordelijke als dat nog ontbreekt; " +
        "anders ga meteen naar de afsluitvraag."
      : TASK_CAPTURE_OPENING_PROMPT;
  } else if (kind === "event") {
    base = remainder
      ? `De gebruiker gaf al agendainformatie: "${remainder}". Vraag niet opnieuw naar het onderwerp. ` +
        "Vraag alleen in één korte zin naar ontbrekende datum of tijd als dat nog ontbreekt; " +
        "anders ga meteen naar de afsluitvraag."
      : EVENT_CAPTURE_OPENING_PROMPT;
  } else {
    base = remainder
      ? `De gebruiker wil corrigeren en zei al: "${remainder}". Herhaal dat niet. ` +
        "Zeg alleen 'Oké' of stel maximaal één korte verduidelijkingsvraag als iets onduidelijk is."
      : CORRECTION_OPENING_PROMPT;
  }
  return `${base} ${CAPTURE_DIALOGUE_BRIEF_STYLE} ${CAPTURE_DIALOGUE_CLOSING_INSTRUCTION}`;
}
const FALLBACK_REALTIME_ERROR = "Realtime sessie kon niet worden gestart.";

function isDebugRuntime() {
  return (
    window.location.search.includes("realtimeDebug=1") ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function toFriendlyRealtimeError(err, fallback = "Kon geen realtime sessie starten.") {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (!raw.trim()) return fallback;
  if (/Incorrect API key provided|invalid api key|401/i.test(raw)) {
    return "Realtime authenticatie mislukt. Controleer OPENAI_API_KEY op de server.";
  }
  if (/permission|forbidden|403/i.test(raw)) {
    return "Realtime toegang geweigerd. Controleer projectrechten en modeltoegang.";
  }
  if (/realtime interview is uitgeschakeld/i.test(raw)) {
    return "Realtime interview staat uit. Zet REALTIME_INTERVIEW_ENABLED=true.";
  }
  if (/not geconfigureerd|OPENAI_API_KEY ontbreekt/i.test(raw)) {
    return "Realtime is nog niet geconfigureerd op de server.";
  }
  if (/network|failed to fetch|handshake|sdp/i.test(raw)) {
    return "Realtime verbinding mislukt. Controleer internetverbinding en probeer opnieuw.";
  }
  return fallback;
}

/**
 * Builds the GA /v1/realtime/calls request.
 * We keep session configuration server-side in the client secret bootstrap.
 * That avoids conflicting dual config between backend bootstrap and frontend call.
 * @param {string} sdp
 */
export function buildRealtimeCallsRequest(sdp) {
  const formData = new FormData();
  formData.append("sdp", sdp);
  return formData;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
export function readRealtimeTranscriptText(payload) {
  if (typeof payload?.transcript === "string" && payload.transcript.trim()) {
    return payload.transcript.trim();
  }
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }
  if (typeof payload?.delta === "string" && payload.delta.trim()) {
    return payload.delta.trim();
  }
  const item = payload?.item;
  if (item && typeof item === "object") {
    const itemObj = item;
    const fromNested = itemObj.input_audio_transcription;
    if (
      fromNested &&
      typeof fromNested === "object" &&
      typeof fromNested.transcript === "string" &&
      fromNested.transcript.trim()
    ) {
      return fromNested.transcript.trim();
    }
    const content = Array.isArray(itemObj.content) ? itemObj.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (typeof part.transcript === "string" && part.transcript.trim()) {
        return part.transcript.trim();
      }
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return "";
}

/**
 * Bouwt een live transcript inclusief nog niet afgeronde user/assistant regels.
 * @param {{ role: "assistant"|"user"; text: string }[]} turns
 * @param {string} [pendingUser]
 * @param {string} [pendingAssistant]
 * @returns {string}
 */
export function buildLiveRealtimeTranscript(turns, pendingUser = "", pendingAssistant = "") {
  /** @type {string[]} */
  const lines = (turns || []).map((turn) => {
    const label = turn.role === "assistant" ? "Assistent" : "Gebruiker";
    return `[${label}]: ${turn.text}`;
  });
  const userPending = String(pendingUser || "").replace(/\s+/g, " ").trim();
  const assistantPending = String(pendingAssistant || "").replace(/\s+/g, " ").trim();
  if (userPending) lines.push(`[Gebruiker]: ${userPending}`);
  if (assistantPending) lines.push(`[Assistent]: ${assistantPending}`);
  return lines.join("\n");
}

/**
 * @typedef {{
 *   setStatus: (status: string) => void;
 *   onStateChange?: (state: { active: boolean; connecting: boolean }) => void;
 *   onError?: (message: string) => void;
 *   onDebugEvent?: (message: string) => void;
 *   onTranscriptUpdate?: (transcript: string) => void;
 *   onTurn?: (turn: { role: "assistant"|"user"; text: string }) => void;
 *   onSpeechStopped?: (context: { pendingUserText: string; transcript: string }) => void;
 *   onSpeechStoppedEarly?: () => void;
 *   onResponseStarted?: () => void;
 *   onResponseDone?: () => void;
 *   sessionUrl?: string;
 *   listenOnly?: boolean;
 *   correctionDialogue?: boolean;
 *   passiveListen?: boolean;
 *   onSpeechStarted?: () => void;
 *   onConnectionLost?: () => void;
 *   onListenReady?: () => void;
 * }} RealtimeInterviewOptions
 */

/**
 * @param {RealtimeInterviewOptions} options
 */
export function createRealtimeInterviewController(options) {
  const defaultSessionUrl = options.sessionUrl || "/api/realtime/session";
  const defaultListenOnly = options.listenOnly === true;
  const defaultCorrectionDialogue = options.correctionDialogue === true;
  const defaultPassiveListen = options.passiveListen === true;
  /** @type {string} */
  let sessionUrl = defaultSessionUrl;
  let listenOnly = defaultListenOnly;
  let correctionDialogue = defaultCorrectionDialogue;
  let passiveListen = defaultPassiveListen;
  let skipOpeningGreeting = false;
  /** @type {RTCPeerConnection | null} */
  let peer = null;
  /** @type {RTCDataChannel | null} */
  let dataChannel = null;
  /** @type {MediaStream | null} */
  let localStream = null;
  /** @type {HTMLAudioElement | null} */
  let remoteAudio = null;
  /** @type {MediaStream | null} */
  let mutedRemoteStream = null;
  /** @type {AudioContext | null} */
  let outputAudioCtx = null;
  /** @type {GainNode | null} */
  let outputGainNode = null;
  /** @type {MediaStreamAudioSourceNode | null} */
  let outputSourceNode = null;
  let correctionDialogueActive = false;
  /** @type {"correction"|"task"|"event"|null} */
  let captureDialogueKind = null;
  let captureSeedRemainder = "";
  /** @type {ReturnType<typeof setTimeout> | null} */
  let micRestoreTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let micMuteFailsafeTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let openingResponseWatchdog = null;

  const isCaptureDialogueSession = () =>
    Boolean(captureDialogueKind || correctionDialogue || correctionDialogueActive);

  const requiresRemoteTrackForOpening = () =>
    requiresRemoteTrackBeforeOpening({
      listenOnly,
      passiveListen,
      captureDialogueKind,
      correctionDialogue,
      correctionDialogueActive,
    });

  const shouldMuteMicDuringAssistant = () =>
    !passiveListen &&
    Boolean(
      captureDialogueKind ||
        correctionDialogue ||
        correctionDialogueActive ||
        !listenOnly,
    );

  const getAssistantEchoSources = () => {
    /** @type {string[]} */
    const sources = turns.filter((turn) => turn.role === "assistant").map((turn) => turn.text);
    const pending = pendingAssistantTranscript.replace(/\s+/g, " ").trim();
    if (pending) sources.push(pending);
    return sources;
  };

  const sanitizeUserSpeech = (rawText) =>
    stripAssistantEchoFromUserSpeech(rawText, getAssistantEchoSources());

  const muteMicForAssistantEcho = () => {
    if (!shouldMuteMicDuringAssistant()) return;
    if (micRestoreTimer) {
      clearTimeout(micRestoreTimer);
      micRestoreTimer = null;
    }
    if (micMuteFailsafeTimer) clearTimeout(micMuteFailsafeTimer);
    setMicEnabled(false);
    micMuteFailsafeTimer = setTimeout(() => {
      micMuteFailsafeTimer = null;
      setMicEnabled(true);
    }, ASSISTANT_ECHO_MIC_FAILSAFE_MS);
  };

  const restoreMicAfterAssistantEcho = () => {
    if (micMuteFailsafeTimer) {
      clearTimeout(micMuteFailsafeTimer);
      micMuteFailsafeTimer = null;
    }
    if (!shouldMuteMicDuringAssistant()) {
      setMicEnabled(true);
      return;
    }
    if (micRestoreTimer) clearTimeout(micRestoreTimer);
    micRestoreTimer = setTimeout(() => {
      micRestoreTimer = null;
      setMicEnabled(true);
    }, ASSISTANT_ECHO_MIC_GRACE_MS);
  };
  let active = false;
  let connecting = false;
  let openingGreetingSent = false;
  let dataChannelReady = false;
  /** @type {Promise<void> | null} */
  let listenReadyPromise = null;
  /** @type {(() => void) | null} */
  let listenReadyResolve = null;
  /** @type {object | null} Queued speakText payload — verstuurd zodra data channel opent. */
  let pendingSpeakPayload = null;

  const resetListenReadyWaiter = () => {
    listenReadyPromise = new Promise((resolve) => {
      listenReadyResolve = resolve;
    });
  };

  const resolveListenReady = () => {
    if (dataChannelReady) return;
    dataChannelReady = true;
    listenReadyResolve?.();
    listenReadyResolve = null;
  };
  let remoteTrackReady = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let openingGreetingFallbackTimer = null;
  /** @type {{ role: "assistant"|"user"; text: string }[]} */
  let turns = [];
  let pendingUserTranscript = "";
  let pendingAssistantTranscript = "";
  let lastCompletedUserTranscript = "";
  /** @type {ReturnType<typeof setTimeout> | null} */
  let speechStoppedTimer = null;

  const setStatus = (status) => options.setStatus(status);
  const emitState = () => options.onStateChange?.({ active, connecting });
  const emitDebug = (message) => {
    if (window.location.search.includes("realtimeDebug=1")) {
      options.onDebugEvent?.(message);
    }
  };

  const buildTranscript = () =>
    turns
      .map((turn) => {
        const label = turn.role === "assistant" ? "Assistent" : "Gebruiker";
        return `[${label}]: ${turn.text}`;
      })
      .join("\n");

  const buildLiveTranscript = () =>
    buildLiveRealtimeTranscript(turns, pendingUserTranscript, pendingAssistantTranscript);

  const buildUserTranscript = () => {
    const assistantTexts = turns.filter((turn) => turn.role === "assistant").map((turn) => turn.text);
    return turns
      .filter((turn) => turn.role === "user")
      .map((turn) => stripAssistantEchoFromUserSpeech(turn.text, assistantTexts))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const emitTranscript = () => {
    options.onTranscriptUpdate?.(buildLiveTranscript());
  };

  const flushPendingTurns = () => {
    const user = sanitizeUserSpeech(pendingUserTranscript);
    pendingUserTranscript = "";
    if (user) {
      const last = turns[turns.length - 1];
      if (!(last && last.role === "user" && last.text.toLowerCase() === user.toLowerCase())) {
        turns.push({ role: "user", text: user });
      }
    }
    const assistant = pendingAssistantTranscript.replace(/\s+/g, " ").trim();
    if (assistant) {
      pendingAssistantTranscript = "";
      const last = turns[turns.length - 1];
      if (
        !(last && last.role === "assistant" && last.text.toLowerCase() === assistant.toLowerCase())
      ) {
        turns.push({ role: "assistant", text: assistant });
      }
    }
  };

  const resetOpeningGreetingState = () => {
    openingGreetingSent = false;
    dataChannelReady = false;
    remoteTrackReady = false;
    pendingSpeakPayload = null;
    if (openingGreetingFallbackTimer) {
      clearTimeout(openingGreetingFallbackTimer);
      openingGreetingFallbackTimer = null;
    }
    if (openingResponseWatchdog) {
      clearTimeout(openingResponseWatchdog);
      openingResponseWatchdog = null;
    }
  };

  const clearOpeningResponseWatchdog = () => {
    if (openingResponseWatchdog) {
      clearTimeout(openingResponseWatchdog);
      openingResponseWatchdog = null;
    }
  };

  const scheduleOpeningResponseWatchdog = () => {
    if (!isCaptureDialogueSession()) return;
    clearOpeningResponseWatchdog();
    openingResponseWatchdog = setTimeout(() => {
      openingResponseWatchdog = null;
      if (!active || turns.some((turn) => turn.role === "assistant")) return;
      restoreMicAfterAssistantEcho();
      openingGreetingSent = false;
      if (sendOpeningGreeting()) return;
      setStatus("Mini reageert niet — probeer opnieuw.");
      options.onError?.(
        "Mini start het correctiegesprek niet. Zeg opnieuw Correctie of herlaad de pagina.",
      );
    }, CAPTURE_OPENING_RESPONSE_TIMEOUT_MS);
  };

  const ensureRemoteAudio = () => {
    if (remoteAudio) return remoteAudio;
    remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    remoteAudio.volume = 1;
    return remoteAudio;
  };

  const teardownOutputGain = () => {
    try {
      outputSourceNode?.disconnect();
    } catch {
      /* noop */
    }
    try {
      outputGainNode?.disconnect();
    } catch {
      /* noop */
    }
    outputSourceNode = null;
    outputGainNode = null;
  };

  /**
   * Bouwt (of hergebruikt) een Web Audio-graph die de meegegeven stream versterkt af te
   * spelen — zie REALTIME_QA_OUTPUT_GAIN hierboven. Bij falen (bv. geen AudioContext-support)
   * blijft de normale <audio>-output gewoon werken; geeft daarom true terug alleen als de
   * versterkte graph daadwerkelijk actief is (en de <audio>-track dus gedempt mag worden).
   * @param {MediaStream} stream
   * @returns {boolean}
   */
  const attachOutputGain = (stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      if (!outputAudioCtx) outputAudioCtx = new AudioCtx();
      if (outputAudioCtx.state === "suspended") void outputAudioCtx.resume();
      teardownOutputGain();
      outputSourceNode = outputAudioCtx.createMediaStreamSource(stream);
      outputGainNode = outputAudioCtx.createGain();
      outputGainNode.gain.value = REALTIME_QA_OUTPUT_GAIN;
      outputSourceNode.connect(outputGainNode).connect(outputAudioCtx.destination);
      return true;
    } catch {
      teardownOutputGain();
      return false;
    }
  };

  const sendOpeningGreeting = () => {
    if (skipOpeningGreeting || listenOnly || passiveListen || openingGreetingSent) return false;
    if (!dataChannel || dataChannel.readyState !== "open") return false;
    openingGreetingSent = true;
    if (openingGreetingFallbackTimer) {
      clearTimeout(openingGreetingFallbackTimer);
      openingGreetingFallbackTimer = null;
    }
    const isCaptureDialogue =
      captureDialogueKind || correctionDialogue || correctionDialogueActive;
    const instructions = isCaptureDialogue
      ? buildCaptureDialogueOpeningPrompt(
          captureDialogueKind ||
            (correctionDialogue || correctionDialogueActive ? "correction" : null),
          captureSeedRemainder,
        )
      : OPENING_PROMPT;
    dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions,
        },
      }),
    );
    scheduleOpeningResponseWatchdog();
    setStatus(
      captureDialogueKind === "task"
        ? "Taak bespreken…"
        : captureDialogueKind === "event"
          ? "Agenda bespreken…"
          : isCaptureDialogue
            ? "Correctie bespreken…"
            : `MegaMinnie: ${REALTIME_QA_OPENING_TEXT}…`,
    );
    return true;
  };

  const maybeSendOpeningGreeting = () => {
    if (openingGreetingSent || listenOnly || passiveListen) return;
    if (!dataChannelReady) return;
    if (requiresRemoteTrackForOpening() && !remoteTrackReady) return;
    sendOpeningGreeting();
  };

  const scheduleOpeningGreetingFallback = () => {
    if (openingGreetingFallbackTimer) clearTimeout(openingGreetingFallbackTimer);
    const delayMs = isCaptureDialogueSession()
      ? CAPTURE_OPENING_GREETING_FALLBACK_MS
      : OPENING_GREETING_FALLBACK_MS;
    openingGreetingFallbackTimer = setTimeout(() => {
      openingGreetingFallbackTimer = null;
      if (openingGreetingSent || listenOnly || passiveListen) return;
      if (!dataChannelReady) return;
      if (!requiresRemoteTrackForOpening()) {
        sendOpeningGreeting();
        return;
      }
      remoteTrackReady = true;
      sendOpeningGreeting();
    }, delayMs);
  };

  /** @param {"assistant"|"user"} role @param {string} rawText */
  const addTurn = (role, rawText) => {
    let text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (role === "user") text = sanitizeUserSpeech(text);
    if (!text) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role && last.text.toLowerCase() === text.toLowerCase()) return;
    turns.push({ role, text });
    if (role === "user") pendingUserTranscript = "";
    if (role === "assistant") {
      pendingAssistantTranscript = "";
      clearOpeningResponseWatchdog();
    }
    options.onTurn?.({ role, text });
    emitTranscript();
  };

  const updateState = (next) => {
    if (typeof next.active === "boolean") active = next.active;
    if (typeof next.connecting === "boolean") connecting = next.connecting;
    emitState();
  };

  const closeRemoteAudio = () => {
    teardownOutputGain();
    if (outputAudioCtx) {
      try {
        void outputAudioCtx.close();
      } catch {
        /* noop */
      }
      outputAudioCtx = null;
    }
    if (!remoteAudio) return;
    try {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
    } catch {
      /* noop */
    }
    remoteAudio = null;
  };

  const cleanup = () => {
    dataChannelReady = false;
    listenReadyResolve = null;
    listenReadyPromise = null;
    resetOpeningGreetingState();
    if (speechStoppedTimer) {
      clearTimeout(speechStoppedTimer);
      speechStoppedTimer = null;
    }
    pendingUserTranscript = "";
    pendingAssistantTranscript = "";
    lastCompletedUserTranscript = "";
    if (micRestoreTimer) {
      clearTimeout(micRestoreTimer);
      micRestoreTimer = null;
    }
    if (micMuteFailsafeTimer) {
      clearTimeout(micMuteFailsafeTimer);
      micMuteFailsafeTimer = null;
    }
    correctionDialogueActive = false;
    captureDialogueKind = null;
    captureSeedRemainder = "";
    mutedRemoteStream = null;
    if (dataChannel) {
      try {
        dataChannel.close();
      } catch {
        /* noop */
      }
      dataChannel = null;
    }

    if (peer) {
      try {
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.close();
      } catch {
        /* noop */
      }
      peer = null;
    }

    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        try {
          track.enabled = true;
          track.stop();
        } catch {
          /* noop */
        }
      });
      localStream = null;
    }

    closeRemoteAudio();
  };

  /**
   * @param {Record<string, any>} payload
   * @returns {{ role: "assistant"|"user"; text: string }[]}
   */
  const extractTurnsFromPayload = (payload) => {
    const type = typeof payload?.type === "string" ? payload.type : "";
    /** @type {{ role: "assistant"|"user"; text: string }[]} */
    const extracted = [];
    if (
      type === "conversation.item.input_audio_transcription.completed" ||
      type === "input_audio_transcription.completed"
    ) {
      const text = readRealtimeTranscriptText(payload);
      if (text) extracted.push({ role: "user", text });
      return extracted;
    }
    if (
      type === "response.audio_transcript.done" ||
      type === "response.output_audio_transcript.done"
    ) {
      const text = readRealtimeTranscriptText(payload);
      if (text) extracted.push({ role: "assistant", text });
      return extracted;
    }
    if (type === "response.output_text.done") {
      const text = readRealtimeTranscriptText(payload);
      if (text) extracted.push({ role: "assistant", text });
      return extracted;
    }

    if (type === "response.done" && payload.response?.output) {
      for (const outputItem of payload.response.output) {
        if (!outputItem || typeof outputItem !== "object") continue;
        const role = outputItem.role === "user" ? "user" : "assistant";
        const content = Array.isArray(outputItem.content) ? outputItem.content : [];
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const text =
            typeof part.transcript === "string"
              ? part.transcript
              : typeof part.text === "string"
                ? part.text
                : "";
          if (text.trim()) extracted.push({ role, text });
        }
      }
    }
    return extracted;
  };

  const scheduleSpeechStopped = () => {
    if (speechStoppedTimer) clearTimeout(speechStoppedTimer);
    speechStoppedTimer = setTimeout(() => {
      speechStoppedTimer = null;
      const rawPending =
        pendingUserTranscript.replace(/\s+/g, " ").trim() || lastCompletedUserTranscript;
      pendingUserTranscript = "";
      lastCompletedUserTranscript = "";
      const pendingUserText = sanitizeUserSpeech(rawPending);
      options.onSpeechStopped?.({
        pendingUserText,
        transcript: buildLiveTranscript(),
      });
    }, 900);
  };

  const handleTranscriptionSideEffects = (type, payload) => {
    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = typeof payload?.delta === "string" ? payload.delta : "";
      if (delta) {
        pendingUserTranscript += delta;
        emitTranscript();
      }
      return;
    }
    if (
      type === "response.audio_transcript.delta" ||
      type === "response.output_audio_transcript.delta" ||
      type === "response.output_text.delta"
    ) {
      const delta = typeof payload?.delta === "string" ? payload.delta : "";
      if (delta) {
        muteMicForAssistantEcho();
        pendingAssistantTranscript += delta;
        emitTranscript();
      }
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.completed" ||
      type === "input_audio_transcription.completed"
    ) {
      const text = readRealtimeTranscriptText(payload);
      if (text) {
        lastCompletedUserTranscript = sanitizeUserSpeech(text.replace(/\s+/g, " ").trim());
      }
      pendingUserTranscript = "";
      return;
    }
    if (
      type === "response.audio_transcript.done" ||
      type === "response.output_audio_transcript.done" ||
      type === "response.output_text.done"
    ) {
      pendingAssistantTranscript = "";
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      options.onSpeechStoppedEarly?.();
      scheduleSpeechStopped();
    }
  };

  const handleDataEvent = (eventType, payload = {}) => {
    if (!eventType) return;
    if (eventType === "input_audio_buffer.speech_started") {
      pendingUserTranscript = "";
      if (passiveListen) {
        options.onSpeechStarted?.();
      }
      if (!passiveListen) {
        setStatus("Luistert…");
      }
      return;
    }
    if (eventType === "response.created") {
      pendingAssistantTranscript = "";
      muteMicForAssistantEcho();
      setStatus("Assistent antwoordt…");
      options.onResponseStarted?.();
      return;
    }
    if (
      eventType.startsWith("response.audio") ||
      eventType.startsWith("response.output_audio")
    ) {
      setStatus("Assistent antwoordt…");
      return;
    }
    if (eventType === "response.done") {
      pendingAssistantTranscript = "";
      clearOpeningResponseWatchdog();
      restoreMicAfterAssistantEcho();
      setStatus("Luistert…");
      emitTranscript();
      const status = typeof payload?.response?.status === "string" ? payload.response.status : "";
      if (status !== "cancelled" && status !== "incomplete") {
        options.onResponseDone?.();
      }
      return;
    }
    if (eventType === "error") {
      clearOpeningResponseWatchdog();
      restoreMicAfterAssistantEcho();
      if (isCaptureDialogueSession() && !turns.some((turn) => turn.role === "assistant")) {
        setStatus("Fout bij correctiegesprek — probeer opnieuw.");
      }
      return;
    }
  };

  const setupDataChannel = () => {
    if (!peer) return;
    dataChannel = peer.createDataChannel("oai-events");
    dataChannel.addEventListener("open", () => {
      emitDebug("Data channel open");
      resolveListenReady();
      if (pendingSpeakPayload) {
        dataChannel.send(JSON.stringify(pendingSpeakPayload));
        pendingSpeakPayload = null;
      }
      options.onListenReady?.();
      if (listenOnly) {
        if (!passiveListen) {
          setStatus("Spreek je correctie in…");
        }
        return;
      }
      if (isCaptureDialogueSession()) {
        sendOpeningGreeting();
      } else {
        maybeSendOpeningGreeting();
      }
      scheduleOpeningGreetingFallback();
    });
    dataChannel.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        const type = typeof payload?.type === "string" ? payload.type : "";
        if (type) {
          emitDebug(`Realtime event: ${type}`);
          handleTranscriptionSideEffects(type, payload);
          handleDataEvent(type, payload);
          const extractedTurns = extractTurnsFromPayload(payload);
          for (const turn of extractedTurns) {
            addTurn(turn.role, turn.text);
          }
        }
      } catch {
        emitDebug("Realtime event parse mislukt");
      }
    });
  };

  const setupPeer = () => {
    peer = new RTCPeerConnection();
    if (!listenOnly) {
      ensureRemoteAudio();
    }
    peer.ontrack = (event) => {
      if (listenOnly && !correctionDialogueActive) {
        mutedRemoteStream = event.streams[0] ?? null;
        mutedRemoteStream?.getTracks().forEach((track) => {
          track.enabled = false;
        });
        return;
      }
      remoteTrackReady = true;
      const audio = ensureRemoteAudio();
      const stream = event.streams[0];
      audio.srcObject = stream;
      // Versterk de output via Web Audio zodat Vraag & Antwoord even luid klinkt als de
      // "Hallo"-opening (zie REALTIME_QA_OUTPUT_GAIN). Lukt dat niet, dan blijft de gewone
      // <audio>-uitvoer op normaal volume actief.
      audio.muted = stream ? attachOutputGain(stream) : false;
      void audio.play().catch(() => {
        setStatus("Assistent antwoordt…");
      });
      maybeSendOpeningGreeting();
    };
    peer.onconnectionstatechange = () => {
      if (!peer) return;
      emitDebug(`RTCPeerConnection state: ${peer.connectionState}`);
      if (peer.connectionState === "connected") {
        if (!passiveListen && !(isCaptureDialogueSession() && !openingGreetingSent)) {
          setStatus("Luistert…");
        }
      } else if (
        peer.connectionState === "failed" ||
        peer.connectionState === "disconnected"
      ) {
        if (passiveListen) {
          emitDebug(`RTCPeerConnection passive ${peer.connectionState}`);
          cleanup();
          updateState({ active: false, connecting: false });
          options.onConnectionLost?.();
          return;
        }
        stop("Fout bij realtime sessie");
        options.onError?.("Realtime verbinding verbroken.");
      }
    };
    setupDataChannel();
  };

  const connectWebRtc = async (session, prefetchedStream) => {
    if (!peer) throw new Error("Geen peer connection beschikbaar.");
    if (prefetchedStream) {
      localStream = prefetchedStream;
    } else if (!localStream) {
      localStream = await requestMicrophoneStream(buildMicrophoneConstraints());
    }
    localStream.getTracks().forEach((track) => {
      peer?.addTrack(track, localStream);
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const sdpResponse = await fetch(OPENAI_REALTIME_WEBRTC_CALLS_URL, {
      method: "POST",
      body: buildRealtimeCallsRequest(offer.sdp || ""),
      headers: {
        Authorization: `Bearer ${session.clientSecret}`,
      },
    });
    if (!sdpResponse.ok) {
      throw new Error(`Realtime SDP handshake mislukt (${sdpResponse.status}).`);
    }
    const contentType = sdpResponse.headers.get("content-type") || "";
    let answerSdp = "";
    if (contentType.includes("application/json")) {
      const payload = await sdpResponse.json().catch(() => ({}));
      if (typeof payload?.sdp === "string") {
        answerSdp = payload.sdp;
      } else if (
        payload?.answer &&
        typeof payload.answer === "object" &&
        typeof payload.answer.sdp === "string"
      ) {
        answerSdp = payload.answer.sdp;
      }
    } else {
      answerSdp = await sdpResponse.text();
    }
    if (!answerSdp.trim()) {
      throw new Error("Realtime antwoord-SDP ontbreekt.");
    }
    await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
  };

  const start = async (startOverrides = {}) => {
    if (active || connecting) return false;
    sessionUrl = startOverrides.sessionUrl ?? defaultSessionUrl;
    listenOnly = startOverrides.listenOnly ?? defaultListenOnly;
    correctionDialogue = startOverrides.correctionDialogue ?? defaultCorrectionDialogue;
    passiveListen = startOverrides.passiveListen ?? defaultPassiveListen;
    captureDialogueKind = startOverrides.captureDialogueKind ?? null;
    captureSeedRemainder = String(startOverrides.seedRemainder || "").trim();
    skipOpeningGreeting = startOverrides.skipOpeningGreeting === true;
    /** @type {MediaStream | null | undefined} */
    const prefetchedStream = startOverrides.prefetchedStream ?? null;
    let ownedPrefetchedStream = false;
    resetOpeningGreetingState();
    dataChannelReady = false;
    resetListenReadyWaiter();
    turns = [];
    emitTranscript();
    updateState({ connecting: true });
    if (!passiveListen) {
      setStatus("Verbinden…");
    }
    try {
      if (prefetchedStream) {
        localStream = prefetchedStream;
      } else {
        localStream = await requestMicrophoneStream(buildMicrophoneConstraints());
        ownedPrefetchedStream = true;
      }

      const session = await apiPost(sessionUrl, {
        method: "POST",
      });
      emitDebug(`Realtime session bootstrap: ${JSON.stringify({ model: session?.model, voice: session?.voice })}`);
      if (!session?.clientSecret) {
        throw new Error("Realtime sessie gaf geen client secret terug.");
      }
      setupPeer();
      await connectWebRtc(session, prefetchedStream || localStream);
      updateState({ active: true, connecting: false });
      if (!passiveListen) {
        setStatus(
          listenOnly
            ? "Spreek je correctie in…"
            : isCaptureDialogueSession()
              ? "Correctie bespreken…"
              : "Luistert…",
        );
      }
      if (isCaptureDialogueSession()) {
        scheduleOpeningGreetingFallback();
      }
    } catch (err) {
      if (ownedPrefetchedStream) {
        stopMediaStream(localStream);
        localStream = null;
      }
      cleanup();
      updateState({ active: false, connecting: false });
      setStatus("Fout bij realtime sessie");
      if (isDebugRuntime()) {
        console.debug("Realtime start failed", err);
      }
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError" ||
          err.name === "SecurityError")
      ) {
        alertMicrophoneError(err, { feature: "Vraag & Antwoord (realtime)" });
        return false;
      }
      const message = toFriendlyRealtimeError(err, FALLBACK_REALTIME_ERROR);
      options.onError?.(message);
      return false;
    }
    return true;
  };

  const stop = (status = "Gestopt") => {
    cleanup();
    updateState({ active: false, connecting: false });
    if (status) setStatus(status);
  };

  const consumeTranscript = () => {
    flushPendingTurns();
    const transcript = buildTranscript().trim();
    turns = [];
    pendingUserTranscript = "";
    pendingAssistantTranscript = "";
    emitTranscript();
    return transcript;
  };

  const consumeUserTranscript = () => {
    flushPendingTurns();
    const transcript = buildUserTranscript();
    turns = [];
    pendingUserTranscript = "";
    pendingAssistantTranscript = "";
    emitTranscript();
    return transcript;
  };

  const clearTranscript = () => {
    turns = [];
    pendingUserTranscript = "";
    pendingAssistantTranscript = "";
    emitTranscript();
  };

  const beginCorrectionDialogue = () => {
    if (!active || !dataChannel || dataChannel.readyState !== "open") return false;
    correctionDialogueActive = true;
    listenOnly = false;
    if (mutedRemoteStream) {
      mutedRemoteStream.getTracks().forEach((track) => {
        track.enabled = true;
      });
      remoteTrackReady = true;
      const audio = ensureRemoteAudio();
      audio.srcObject = mutedRemoteStream;
      void audio.play().catch(() => {
        setStatus("Correctie bespreken…");
      });
    }
    openingGreetingSent = false;
    sendOpeningGreeting();
    setStatus("Wat wil je corrigeren of aanvullen?");
    return true;
  };

  const endCorrectionDialogue = () => {
    correctionDialogueActive = false;
    listenOnly = defaultListenOnly;
    if (remoteAudio) {
      try {
        remoteAudio.pause();
        remoteAudio.srcObject = null;
      } catch {
        /* noop */
      }
    }
    if (mutedRemoteStream) {
      mutedRemoteStream.getTracks().forEach((track) => {
        track.enabled = false;
      });
    }
  };

  const setMicEnabled = (enabled) => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  };

  /** @param {string} text */
  const seedAssistantTurn = (text) => {
    addTurn("assistant", text);
  };

  /** Stuur tekst naar het model om voor te lezen via response.create.
   *  Als het data channel nog niet open is, wordt het queued en verstuurd bij opening. */
  const speakText = (text) => {
    if (!dataChannel) return false;
    const payload = {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: String(text || "").trim() }],
          },
        ],
      },
    };
    if (dataChannel.readyState === "open") {
      dataChannel.send(JSON.stringify(payload));
    } else {
      pendingSpeakPayload = payload;
    }
    return true;
  };

  /** Annuleer de lopende model-response en verwijder eventuele queued payload. */
  const cancelResponse = () => {
    pendingSpeakPayload = null;
    if (!dataChannel || dataChannel.readyState !== "open") return false;
    dataChannel.send(JSON.stringify({ type: "response.cancel" }));
    return true;
  };

  /**
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<void>}
   */
  const waitForListenReady = ({ timeoutMs = 15000 } = {}) => {
    if (dataChannelReady) return Promise.resolve();
    if (!listenReadyPromise) resetListenReadyWaiter();
    return Promise.race([
      listenReadyPromise,
      new Promise((_, reject) => {
        window.setTimeout(
          () => reject(new Error("Realtime listen data channel timeout")),
          timeoutMs,
        );
      }),
    ]);
  };

  return {
    start,
    stop,
    consumeTranscript,
    consumeUserTranscript,
    clearTranscript,
    beginCorrectionDialogue,
    endCorrectionDialogue,
    setMicEnabled,
    seedAssistantTurn,
    isCorrectionDialogueActive: () => correctionDialogueActive,
    getTranscript: () => buildLiveTranscript().trim(),
    getUserTranscript: () => buildUserTranscript(),
    isActive: () => active,
    isConnecting: () => connecting,
    isListenReady: () => dataChannelReady,
    waitForListenReady,
    speakText,
    cancelResponse,
  };
}
