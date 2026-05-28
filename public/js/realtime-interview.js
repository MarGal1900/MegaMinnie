import { apiPost } from "./api.js";

const OPENAI_REALTIME_WEBRTC_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const OPENING_PROMPT =
  "Start nu met je openingsvraag voor dit korte salesgesprek in het Nederlands.";
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
 * @typedef {{
 *   setStatus: (status: string) => void;
 *   onStateChange?: (state: { active: boolean; connecting: boolean }) => void;
 *   onError?: (message: string) => void;
 *   onDebugEvent?: (message: string) => void;
 *   onTranscriptUpdate?: (transcript: string) => void;
 *   onTurn?: (turn: { role: "assistant"|"user"; text: string }) => void;
 *   onSpeechStopped?: (context: { pendingUserText: string; transcript: string }) => void;
 * }} RealtimeInterviewOptions
 */

/**
 * @param {RealtimeInterviewOptions} options
 */
export function createRealtimeInterviewController(options) {
  /** @type {RTCPeerConnection | null} */
  let peer = null;
  /** @type {RTCDataChannel | null} */
  let dataChannel = null;
  /** @type {MediaStream | null} */
  let localStream = null;
  /** @type {HTMLAudioElement | null} */
  let remoteAudio = null;
  let active = false;
  let connecting = false;
  /** @type {{ role: "assistant"|"user"; text: string }[]} */
  let turns = [];
  let pendingUserTranscript = "";
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

  const emitTranscript = () => {
    options.onTranscriptUpdate?.(buildTranscript());
  };

  /** @param {"assistant"|"user"} role @param {string} rawText */
  const addTurn = (role, rawText) => {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role && last.text.toLowerCase() === text.toLowerCase()) return;
    turns.push({ role, text });
    options.onTurn?.({ role, text });
    emitTranscript();
  };

  const updateState = (next) => {
    if (typeof next.active === "boolean") active = next.active;
    if (typeof next.connecting === "boolean") connecting = next.connecting;
    emitState();
  };

  const closeRemoteAudio = () => {
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
    if (speechStoppedTimer) {
      clearTimeout(speechStoppedTimer);
      speechStoppedTimer = null;
    }
    pendingUserTranscript = "";
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
      localStream.getTracks().forEach((track) => {
        try {
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
      const pendingUserText = pendingUserTranscript.replace(/\s+/g, " ").trim();
      pendingUserTranscript = "";
      options.onSpeechStopped?.({
        pendingUserText,
        transcript: buildTranscript(),
      });
    }, 900);
  };

  const handleTranscriptionSideEffects = (type, payload) => {
    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = typeof payload?.delta === "string" ? payload.delta : "";
      if (delta) pendingUserTranscript += delta;
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.completed" ||
      type === "input_audio_transcription.completed"
    ) {
      pendingUserTranscript = "";
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      scheduleSpeechStopped();
    }
  };

  const handleDataEvent = (eventType) => {
    if (!eventType) return;
    if (eventType === "input_audio_buffer.speech_started") {
      pendingUserTranscript = "";
      setStatus("Luistert…");
      return;
    }
    if (
      eventType.startsWith("response.audio") ||
      eventType.startsWith("response.output_audio") ||
      eventType === "response.created"
    ) {
      setStatus("Assistent antwoordt…");
      return;
    }
    if (eventType === "response.done") {
      setStatus("Luistert…");
    }
  };

  const setupDataChannel = () => {
    if (!peer) return;
    dataChannel = peer.createDataChannel("oai-events");
    dataChannel.addEventListener("open", () => {
      emitDebug("Data channel open");
      setStatus("Luistert…");
      dataChannel?.send(
        JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            instructions: OPENING_PROMPT,
          },
        }),
      );
    });
    dataChannel.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        const type = typeof payload?.type === "string" ? payload.type : "";
        if (type) {
          emitDebug(`Realtime event: ${type}`);
          handleTranscriptionSideEffects(type, payload);
          handleDataEvent(type);
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
    peer.ontrack = (event) => {
      if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
      }
      remoteAudio.srcObject = event.streams[0];
      void remoteAudio.play().catch(() => {
        setStatus("Assistent antwoordt…");
      });
    };
    peer.onconnectionstatechange = () => {
      if (!peer) return;
      emitDebug(`RTCPeerConnection state: ${peer.connectionState}`);
      if (peer.connectionState === "connected") {
        setStatus("Luistert…");
      } else if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        stop("Fout bij realtime sessie");
        options.onError?.("Realtime verbinding verbroken.");
      }
    };
    setupDataChannel();
  };

  const connectWebRtc = async (session) => {
    if (!peer) throw new Error("Geen peer connection beschikbaar.");
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
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

  const start = async () => {
    if (active || connecting) return;
    turns = [];
    emitTranscript();
    updateState({ connecting: true });
    setStatus("Verbinden…");
    try {
      const session = await apiPost("/api/realtime/session", {
        method: "POST",
      });
      emitDebug(`Realtime session bootstrap: ${JSON.stringify({ model: session?.model, voice: session?.voice })}`);
      if (!session?.clientSecret) {
        throw new Error("Realtime sessie gaf geen client secret terug.");
      }
      setupPeer();
      await connectWebRtc(session);
      updateState({ active: true, connecting: false });
      setStatus("Luistert…");
    } catch (err) {
      cleanup();
      updateState({ active: false, connecting: false });
      setStatus("Fout bij realtime sessie");
      if (isDebugRuntime()) {
        console.debug("Realtime start failed", err);
      }
      const message = toFriendlyRealtimeError(err, FALLBACK_REALTIME_ERROR);
      options.onError?.(message);
    }
  };

  const stop = (status = "Gestopt") => {
    cleanup();
    updateState({ active: false, connecting: false });
    setStatus(status);
  };

  const consumeTranscript = () => {
    const transcript = buildTranscript().trim();
    turns = [];
    emitTranscript();
    return transcript;
  };

  return {
    start,
    stop,
    consumeTranscript,
    getTranscript: () => buildTranscript().trim(),
    isActive: () => active,
    isConnecting: () => connecting,
  };
}
