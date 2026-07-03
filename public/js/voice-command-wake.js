/**
 * Expliciete state machine voor Ok Minnie idle wake + awaiting command.
 * WebRTC/STT-events komen binnen via dispatch(); side-effects via callbacks.
 */

import {
  containsOkMegaMinnieWake,
  detectReviewVoiceCommand,
  resolvePlaybackVoiceCommand,
  extractOkMegaMinnieWakeAnywhere,
  isCaptureDialogueAffirmative,
  isLikelyReviewSpeechEcho,
  isStartVoorlezenCommand,
  isVoorlezenOfferDecline,
  normalizeWakeCommandText,
  parseOkMegaMinnieWakeCommand,
  stripLeadingSpeechEcho,
} from "./interview-commands.js";
import {
  VOICE_COMMAND_WAKE_ACK_SPEECH,
  getVoiceCommandAwaitingMessage,
  getVoiceCommandWakePromptMessage,
} from "./voice-command-router.js";
/** @typedef {"disconnected"|"connecting"|"listen_idle"|"wake_ack"|"awaiting_command"|"executing"|"playback_listen"} VoiceWakePhase */

/** @typedef {"UPDATE_STATUS"|"SET_MIC"|"PLAY_WAKE_ACK"|"EXECUTE_COMMAND"|"PAUSE_PLAYBACK"|"START_CORRECTION"|"SHOW_ACK_FAILED"} VoiceWakeEffect */

/** @typedef {{
 *   phase: VoiceWakePhase;
 *   listenReady: boolean;
 *   awaitingCommand: boolean;
 *   ackInProgress: boolean;
 *   pttActive: boolean;
 *   wakeDedupeKey: string;
 *   wakeDedupeAt: number;
 *   pendingCommandDuringAck: string | null;
 *   ackGeneration: number;
 * }} VoiceWakeState */

export const WAKE_DEDUPE_MS = 1200;

/** @returns {VoiceWakeState} */
export function createInitialVoiceCommandWakeState() {
  return {
    phase: "disconnected",
    listenReady: false,
    awaitingCommand: false,
    ackInProgress: false,
    pttActive: false,
    wakeDedupeKey: "",
    wakeDedupeAt: 0,
    pendingCommandDuringAck: null,
    ackGeneration: 0,
  };
}

/**
 * @param {VoiceWakeState} state
 * @param {number} [now]
 */
export function getVoiceWakeStatusMessage(state, now = Date.now()) {
  if (state.ackInProgress) return "Wat kan ik voor je doen…";
  if (state.awaitingCommand || state.pttActive) return getVoiceCommandAwaitingMessage();
  if (state.phase === "connecting" || !state.listenReady) {
    return "Spraakcommando's verbinden…";
  }
  if (state.phase === "listen_idle") return getVoiceCommandWakePromptMessage();
  return "";
}

/**
 * @param {VoiceWakeState} state
 * @param {string} key
 * @param {number} [now]
 * @param {{ playbackActive?: boolean; inlineCaptureActive?: boolean }} [opts]
 */
export function shouldSkipWakeDuplicate(state, key, now = Date.now(), opts = {}) {
  if (!key || key !== state.wakeDedupeKey) return false;
  if (now - state.wakeDedupeAt >= WAKE_DEDUPE_MS) return false;
  // Tijdens voorlezen (zonder actieve inline-capture): Ok Minnie opnieuw moet altijd
  // luistermodus kunnen openen — stale awaitingCommand na taak/agenda mag dat niet blokkeren.
  if (opts.playbackActive && !opts.inlineCaptureActive) return false;
  return state.awaitingCommand || state.ackInProgress;
}

/**
 * @param {string} text
 */
export function isOkMinnieWakeOnlyPhrase(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const wake = parseOkMegaMinnieWakeCommand(trimmed);
  return wake.wakeDetected && wake.wakeOnly;
}

/**
 * "Ok Minnie" en "Ok MegaMinnie" moeten exact hetzelfde werken — ook voor deduplicatie.
 * De dedupe-key wordt daarom gecanonicaliseerd naar de "minnie"-vorm, zodat een snel
 * herhaalde wake met de andere variant niet als nieuwe wake wordt behandeld.
 * @param {string} text
 */
export function normalizeWakeKey(text) {
  const normalized = normalizeWakeCommandText(text) || String(text || "").trim().toLowerCase();
  return normalized.replace(/\bmegaminnie\b/g, "minnie");
}

/**
 * @param {VoiceWakeState} state
 * @param {{ type: string; [key: string]: unknown }} event
 * @returns {{ state: VoiceWakeState; effects: VoiceWakeEffect[]; handled?: boolean; delegate?: string }}
 */
export function reduceVoiceCommandWake(state, event) {
  /** @type {VoiceWakeEffect[]} */
  const effects = [];

  switch (event.type) {
    case "LISTEN_CONNECTING":
      return {
        state: { ...state, phase: "connecting", listenReady: false },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "LISTEN_READY": {
      const playbackActive = event.playbackActive === true;
      const phase = playbackActive
        ? "playback_listen"
        : state.phase === "playback_listen" || state.phase === "executing"
          ? state.phase
          : "listen_idle";
      return {
        state: { ...state, phase, listenReady: true },
        effects: [{ type: "UPDATE_STATUS" }],
      };
    }

    case "PLAYBACK_LISTEN_RESET":
      return {
        state: {
          ...state,
          phase: "playback_listen",
          awaitingCommand: false,
          ackInProgress: false,
          pendingCommandDuringAck: null,
          wakeDedupeKey: "",
          wakeDedupeAt: 0,
        },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "LISTEN_LOST":
      return {
        state: { ...createInitialVoiceCommandWakeState(), phase: "disconnected" },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "PLAYBACK_STARTED":
      return {
        state: {
          ...state,
          phase: "playback_listen",
          awaitingCommand: false,
          ackInProgress: false,
          pendingCommandDuringAck: null,
        },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "PLAYBACK_STOPPED":
      if (state.phase !== "playback_listen" && state.phase !== "executing") {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          phase: state.listenReady ? "listen_idle" : "connecting",
          awaitingCommand: false,
          ackInProgress: false,
          pendingCommandDuringAck: null,
        },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "PTT_START":
      return {
        state: {
          ...state,
          pttActive: true,
          awaitingCommand: true,
        },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "PTT_STOP":
      return {
        state: {
          ...state,
          pttActive: false,
          awaitingCommand: false,
          pendingCommandDuringAck: null,
          wakeDedupeKey: "",
          wakeDedupeAt: 0,
          phase: state.listenReady
            ? state.phase === "playback_listen"
              ? "playback_listen"
              : "listen_idle"
            : "connecting",
        },
        effects: [{ type: "UPDATE_STATUS" }, { type: "SET_MIC", enabled: true }],
      };

    case "CANCEL":
      return {
        state: {
          ...state,
          awaitingCommand: false,
          ackInProgress: false,
          pendingCommandDuringAck: null,
          wakeDedupeKey: "",
          wakeDedupeAt: 0,
          ackGeneration: state.ackGeneration + 1,
          phase: state.listenReady
            ? state.phase === "playback_listen"
              ? "playback_listen"
              : "listen_idle"
            : state.phase,
        },
        effects: [{ type: "UPDATE_STATUS" }, { type: "SET_MIC", enabled: true }],
      };

    case "WAKE_ACK_SUCCESS": {
      if (state.phase !== "wake_ack" || event.generation !== state.ackGeneration) {
        return { state, effects: [] };
      }
      const key = typeof event.wakeKey === "string" ? event.wakeKey : state.wakeDedupeKey;
      const now = typeof event.now === "number" ? event.now : Date.now();
      const pending = state.pendingCommandDuringAck;
      /** @type {VoiceWakeEffect[]} */
      const nextEffects = [{ type: "UPDATE_STATUS" }, { type: "SET_MIC", enabled: true }];
      if (pending) {
        nextEffects.push({ type: "EXECUTE_COMMAND", text: pending });
      }
      return {
        state: {
          ...state,
          phase: pending ? "executing" : "awaiting_command",
          ackInProgress: false,
          awaitingCommand: true,
          wakeDedupeKey: key,
          wakeDedupeAt: now,
          pendingCommandDuringAck: null,
        },
        effects: nextEffects,
        handled: true,
      };
    }

    case "WAKE_ACK_FAILED": {
      if (state.phase !== "wake_ack" || event.generation !== state.ackGeneration) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          phase: state.listenReady ? "listen_idle" : "connecting",
          ackInProgress: false,
          awaitingCommand: false,
          pendingCommandDuringAck: null,
          wakeDedupeKey: "",
          wakeDedupeAt: 0,
        },
        effects: [
          { type: "SHOW_ACK_FAILED" },
          { type: "UPDATE_STATUS" },
          { type: "SET_MIC", enabled: true },
        ],
        handled: true,
      };
    }

    case "COMMAND_STARTED":
      return {
        state: {
          ...state,
          phase: state.phase === "playback_listen" ? "playback_listen" : "executing",
          awaitingCommand: false,
        },
        effects: [{ type: "UPDATE_STATUS" }],
      };

    case "COMMAND_FINISHED": {
      const phase = state.pttActive
        ? state.listenReady
          ? "listen_idle"
          : "connecting"
        : state.phase === "playback_listen"
          ? "playback_listen"
          : state.listenReady
            ? "listen_idle"
            : "connecting";
      return {
        state: {
          ...state,
          phase,
          awaitingCommand: state.pttActive,
          ackInProgress: false,
        },
        effects: [{ type: "UPDATE_STATUS" }, { type: "SET_MIC", enabled: true }],
      };
    }

    case "VOORLEZEN_OFFER_AWAITING":
      return {
        state: {
          ...state,
          phase: state.listenReady ? "listen_idle" : state.phase,
          awaitingCommand: true,
          ackInProgress: false,
          pendingCommandDuringAck: null,
        },
        effects: [{ type: "UPDATE_STATUS" }, { type: "SET_MIC", enabled: true }],
      };

    case "STT":
      return reduceVoiceCommandWakeStt(state, event, effects);

    default:
      return { state, effects: [] };
  }
}

/**
 * @param {VoiceWakeState} state
 * @param {{ text?: string; source?: string; playbackActive?: boolean; blocked?: boolean; echoText?: string; inlineCaptureActive?: boolean }} event
 * @param {VoiceWakeEffect[]} effects
 */
function reduceVoiceCommandWakeStt(state, event, effects) {
  const text = String(event.text || "").trim();
  if (!text || event.blocked) return { state, effects: [], handled: false };

  const source = String(event.source || "final");
  if (source === "partial") return { state, effects: [], handled: false };

  const wakeOnly = isOkMinnieWakeOnlyPhrase(text);
  const wakeKey = normalizeWakeKey(text);
  const playbackActive = event.playbackActive === true;
  const skipWakeOpts = {
    playbackActive,
    inlineCaptureActive: event.inlineCaptureActive === true,
  };
  if (playbackActive) {
    // Schone "Ok Minnie, maak taak/agenda/correctie …" in één uiting (wake-woord netjes aan
    // het begin, met een echt commando erna): ook tijdens voorlezen direct de actiemodus in,
    // net als buiten voorlezen om — geen aparte "Wat kan ik voor je doen?"-bevestiging nodig
    // als de gebruiker het commando al heeft meegegeven.
    const wakeWithCommand = parseOkMegaMinnieWakeCommand(text);
    if (wakeWithCommand.wakeDetected && !wakeWithCommand.wakeOnly) {
      effects.push({ type: "EXECUTE_COMMAND", text });
      return { state: { ...state, phase: "executing" }, effects, handled: true };
    }
    // Tijdens voorlezen komt het wake-woord vaak niet netjes aan het BEGIN van de uiting
    // terecht (TTS-echo van de eigen stem ervoor) — wakeOnly (^-anchored) mist dat dan.
    // containsOkMegaMinnieWake vangt "ok (mega)minnie" op elke positie, alleen relevant
    // hier tijdens playback (zelfde aanpak als containsReviewCorrectieCommand voor
    // "Correctie"). Dit was de reden dat "Ok Minnie" tijdens voorlezen herhaald moest worden.
    if (wakeOnly || containsOkMegaMinnieWake(text)) {
      if (shouldSkipWakeDuplicate(state, wakeKey, Date.now(), skipWakeOpts)) {
        return { state, effects: [], handled: true };
      }
      // Wake-woord midden in de uiting met een direct herkenbaar commando erna
      // ("...echo... ok minnie maak een taak aan"): meteen uitvoeren, mits de rest geen
      // TTS-echo van de laatst voorgelezen chunk is.
      const echoText = typeof event.echoText === "string" ? event.echoText : "";
      const playbackResolved = resolvePlaybackVoiceCommand(text);
      if (
        playbackResolved &&
        !isLikelyReviewSpeechEcho(playbackResolved.effectiveText, echoText)
      ) {
        effects.push({ type: "EXECUTE_COMMAND", text: playbackResolved.effectiveText });
        return { state: { ...state, phase: "executing" }, effects, handled: true };
      }
      // Tijdens voorlezen GEEN gesproken "Wat kan ik voor je doen?"-bevestiging: het
      // voorlezen wordt gepauzeerd en er wordt direct geluisterd naar de instructie —
      // exact hetzelfde gedrag als het commando "Correctie".
      return startPlaybackWakeListen(state, wakeKey, effects);
    }
    return { state, effects: [], handled: false, delegate: "review" };
  }

  if (!state.listenReady && !state.awaitingCommand && !state.ackInProgress && !state.pttActive) {
    return { state, effects: [], handled: false };
  }

  if (state.phase === "wake_ack" || state.ackInProgress) {
    if (wakeOnly) return { state, effects: [], handled: true };
    // De microfoon blijft AAN tijdens de bevestiging "Wat kan ik voor je doen?" (zie
    // startWakeAck) zodat een instructie die de gebruiker al vroeg/tijdens die bevestiging
    // uitspreekt niet verloren gaat — voorheen werd de mic hier uitgeschakeld, waardoor zo'n
    // vroege instructie nooit bij het model aankwam en er dus letterlijk niets gebeurde.
    // Filter wel de eigen echo van de bevestiging zelf eruit (zelfde aanpak als de TTS-echo-
    // detectie tijdens voorlezen), anders zou de mic zijn eigen "Wat kan ik voor je doen?"
    // als (onzinnig) commando gaan uitvoeren.
    if (isLikelyReviewSpeechEcho(text, VOICE_COMMAND_WAKE_ACK_SPEECH)) {
      // Zonder duidelijke stilte tussen de echo en het echte commando komt dit soms als ÉÉN
      // STT-fragment binnen ("wat kan ik voor je doen maak een agenda aan"). Niet blind de
      // hele uiting weggooien — strip alleen het echo-voorvoegsel en bewaar de rest als
      // commando (was voorheen de reden dat een commando vlak na de bevestiging spoorloos
      // verdween).
      const remainder = stripLeadingSpeechEcho(text, VOICE_COMMAND_WAKE_ACK_SPEECH);
      if (!remainder) {
        return { state, effects: [], handled: true };
      }
      return {
        state: { ...state, pendingCommandDuringAck: remainder },
        effects: [],
        handled: true,
      };
    }
    return {
      state: { ...state, pendingCommandDuringAck: text },
      effects: [],
      handled: true,
    };
  }

  if (state.awaitingCommand || state.pttActive) {
    if (wakeOnly) {
      if (shouldSkipWakeDuplicate(state, wakeKey, Date.now(), skipWakeOpts)) {
        return { state, effects: [], handled: true };
      }
      return startWakeAck(state, wakeKey, effects);
    }
    // Echo-filter: de STT-transcriptie van de eigen bevestiging ("Wat kan ik voor je doen?")
    // of van de laatst voorgelezen chunk komt door STT-latency vaak pas ná WAKE_ACK_SUCCESS
    // binnen — dus in DEZE fase, niet in wake_ack. Voorheen werd die late echo hier blind als
    // commando uitgevoerd ("Commando niet herkend"), waarna de luister-modus werd afgebroken
    // en de echte instructie van de gebruiker in het luchtledige viel.
    const echoSources = [VOICE_COMMAND_WAKE_ACK_SPEECH];
    const awaitingEchoText = typeof event.echoText === "string" ? event.echoText : "";
    if (awaitingEchoText) echoSources.push(awaitingEchoText);
    for (const echoSource of echoSources) {
      if (isLikelyReviewSpeechEcho(text, echoSource)) {
        const remainder = stripLeadingSpeechEcho(text, echoSource);
        if (!remainder || remainder === text) {
          return { state, effects: [], handled: true };
        }
        effects.push({ type: "EXECUTE_COMMAND", text: remainder });
        return {
          state: { ...state, phase: "executing", awaitingCommand: false },
          effects,
          handled: true,
        };
      }
    }
    effects.push({ type: "EXECUTE_COMMAND", text });
    return {
      state: { ...state, phase: "executing", awaitingCommand: false },
      effects,
      handled: true,
    };
  }

  if (state.phase === "listen_idle" && wakeOnly) {
    if (!state.listenReady) return { state, effects: [], handled: false };
    return startWakeAck(state, wakeKey, effects);
  }

  const wake = parseOkMegaMinnieWakeCommand(text);
  if (wake.wakeDetected && !wake.wakeOnly) {
    // Schone prefix-wake met tekst erna. Een direct herkenbaar of substantieel commando
    // wordt uitgevoerd; een kort, onherkenbaar restant ("Ok Minnie. Bedankt." — typische
    // STT-hallucinatie op zachte audio) wordt behandeld als wake-only, zodat de gebruiker
    // gewoon de bevestiging krijgt in plaats van "Commando niet herkend".
    if (state.phase === "listen_idle" && state.listenReady && isLowConfidenceWakeRemainder(wake.commandText)) {
      return startWakeAck(state, wakeKey, effects);
    }
    effects.push({ type: "EXECUTE_COMMAND", text });
    return {
      state: { ...state, phase: "executing" },
      effects,
      handled: true,
    };
  }

  // Idle: wake-woord dat NIET aan het begin van de uiting staat ("eh, ok minnie" — VAD vangt
  // ruis of een aarzeling ervoor mee). Voorheen werd zo'n uiting volledig genegeerd en moest
  // "Ok Minnie" opnieuw gezegd worden — mede-oorzaak van het 5-6x-roepen-probleem op het
  // hoofdscherm. Zelfde aanpak als tijdens playback (containsOkMegaMinnieWake), maar met de
  // bevestigings-ack als vangnet voor onherkenbare restanten.
  if (state.phase === "listen_idle" && state.listenReady) {
    const anywhere = extractOkMegaMinnieWakeAnywhere(text);
    if (anywhere.wakeDetected) {
      if (anywhere.wakeOnly || isLowConfidenceWakeRemainder(anywhere.commandText)) {
        return startWakeAck(state, wakeKey, effects);
      }
      effects.push({ type: "EXECUTE_COMMAND", text: anywhere.commandText });
      return {
        state: { ...state, phase: "executing" },
        effects,
        handled: true,
      };
    }
  }

  return { state, effects: [], handled: false };
}

/**
 * Bepaalt of het restant na een wake-woord te kort/onherkenbaar is om als commando uit te
 * voeren. Direct herkenbare commando's (taak/agenda/correctie/voorlezen/stop, incl. natuurlijke
 * varianten) en langere uitingen (≥ 3 woorden, kandidaat voor de LLM-intent-fallback) worden
 * wél uitgevoerd; korte restjes zijn vrijwel altijd STT-ruis.
 * @param {string} remainder
 */
function isLowConfidenceWakeRemainder(remainder) {
  const trimmed = String(remainder || "").trim();
  if (!trimmed) return true;
  if (isCaptureDialogueAffirmative(trimmed) || isVoorlezenOfferDecline(trimmed)) return false;
  if (detectReviewVoiceCommand(trimmed) || isStartVoorlezenCommand(trimmed)) return false;
  return trimmed.split(/\s+/).length < 3;
}

/**
 * Wake tijdens voorlezen: playback pauzeren en DIRECT luisteren, zonder gesproken
 * "Wat kan ik voor je doen?"-bevestiging — hetzelfde patroon als het commando "Correctie".
 * De fase blijft "playback_listen" zodat PLAYBACK_STOPPED/hervatten normaal blijven werken;
 * awaitingCommand levert de status "Ik luister…" en activeert het dedupe-venster.
 * @param {VoiceWakeState} state
 * @param {string} wakeKey
 * @param {VoiceWakeEffect[]} effects
 */
function startPlaybackWakeListen(state, wakeKey, effects) {
  effects.push({ type: "PAUSE_PLAYBACK" });
  // Alleen pauzeren en luisteren — geen correctiedialoog. Commando's (taak/agenda/correctie)
  // worden daarna via EXECUTE_COMMAND of maybeHandleReviewVoiceCommand afgehandeld.
  effects.push({ type: "SET_MIC", enabled: true });
  effects.push({ type: "UPDATE_STATUS" });
  return {
    state: {
      ...state,
      awaitingCommand: true,
      ackInProgress: false,
      wakeDedupeKey: wakeKey,
      wakeDedupeAt: Date.now(),
      pendingCommandDuringAck: null,
    },
    effects,
    handled: true,
  };
}

/**
 * @param {VoiceWakeState} state
 * @param {string} wakeKey
 * @param {VoiceWakeEffect[]} effects
 */
function startWakeAck(state, wakeKey, effects) {
  const generation = state.ackGeneration + 1;
  effects.push({ type: "PAUSE_PLAYBACK" });
  // Mic bewust AAN laten tijdens de bevestiging (zie reduceVoiceCommandWakeStt hierboven) —
  // anders gaat een instructie die de gebruiker al tijdens "Wat kan ik voor je doen?" zegt
  // verloren. De eigen ack-echo wordt tekstueel gefilterd i.p.v. de mic hardware-matig te
  // dempen.
  effects.push({ type: "PLAY_WAKE_ACK", generation, wakeKey });
  effects.push({ type: "UPDATE_STATUS" });
  return {
    state: {
      ...state,
      phase: "wake_ack",
      ackInProgress: true,
      awaitingCommand: false,
      ackGeneration: generation,
      pendingCommandDuringAck: null,
    },
    effects,
    handled: true,
  };
}

/**
 * @param {{
 *   onStatus?: (message: string) => void;
 *   onMicEnabled?: (enabled: boolean) => void;
 *   onPlayWakeAck?: (generation: number, wakeKey: string) => Promise<void>;
 *   onExecuteCommand?: (text: string) => void;
 *   onPausePlayback?: () => void;
 *   onStartCorrection?: () => void;
 *   onAckFailed?: () => void;
 * }} options
 */
export function createVoiceCommandWakeController(options = {}) {
  /** @type {VoiceWakeState} */
  let state = createInitialVoiceCommandWakeState();

  const applyEffects = (effects) => {
    for (const effect of effects) {
      if (effect.type === "UPDATE_STATUS") {
        options.onStatus?.(getVoiceWakeStatusMessage(state));
      } else if (effect.type === "SET_MIC") {
        options.onMicEnabled?.(effect.enabled === true);
      } else if (effect.type === "PAUSE_PLAYBACK") {
        options.onPausePlayback?.();
      } else if (effect.type === "START_CORRECTION") {
        options.onStartCorrection?.();
      } else if (effect.type === "PLAY_WAKE_ACK") {
        void options.onPlayWakeAck?.(effect.generation, effect.wakeKey)?.catch(() => {
          dispatch({ type: "WAKE_ACK_FAILED", generation: effect.generation });
        });
      } else if (effect.type === "EXECUTE_COMMAND" && effect.text) {
        options.onExecuteCommand?.(effect.text);
      } else if (effect.type === "SHOW_ACK_FAILED") {
        options.onAckFailed?.();
      }
    }
  };

  /** @param {{ type: string; [key: string]: unknown }} event */
  const dispatch = (event) => {
    const result = reduceVoiceCommandWake(state, event);
    state = result.state;
    applyEffects(result.effects);
    return result;
  };

  return {
    dispatch,
    /** @param {{ text: string; source?: string; playbackActive?: boolean; blocked?: boolean; echoText?: string; inlineCaptureActive?: boolean }} ctx */
    handleStt(ctx) {
      return dispatch({ type: "STT", ...ctx });
    },
    getState: () => state,
    isListenReady: () => state.listenReady,
    isAwaitingCommand: () => state.awaitingCommand || state.pttActive,
    isAckInProgress: () => state.ackInProgress,
    isWakeFlowActive: () =>
      state.awaitingCommand || state.ackInProgress || state.pttActive,
    getStatusMessage: () => getVoiceWakeStatusMessage(state),
  };
}
