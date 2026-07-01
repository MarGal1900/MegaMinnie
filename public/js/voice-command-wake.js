/**
 * Expliciete state machine voor Ok Minnie idle wake + awaiting command.
 * WebRTC/STT-events komen binnen via dispatch(); side-effects via callbacks.
 */

import {
  containsOkMegaMinnieWake,
  normalizeWakeCommandText,
  parseOkMegaMinnieWakeCommand,
} from "./interview-commands.js";
import {
  getVoiceCommandAwaitingMessage,
  getVoiceCommandWakePromptMessage,
} from "./voice-command-router.js";

/** @typedef {"disconnected"|"connecting"|"listen_idle"|"wake_ack"|"awaiting_command"|"executing"|"playback_listen"} VoiceWakePhase */

/** @typedef {"UPDATE_STATUS"|"SET_MIC"|"PLAY_WAKE_ACK"|"EXECUTE_COMMAND"|"PAUSE_PLAYBACK"|"SHOW_ACK_FAILED"} VoiceWakeEffect */

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
 */
export function shouldSkipWakeDuplicate(state, key, now = Date.now()) {
  if (!key || key !== state.wakeDedupeKey) return false;
  if (now - state.wakeDedupeAt >= WAKE_DEDUPE_MS) return false;
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
 * @param {string} text
 */
export function normalizeWakeKey(text) {
  return normalizeWakeCommandText(text) || String(text || "").trim().toLowerCase();
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
      const phase =
        state.phase === "playback_listen" || state.phase === "executing"
          ? state.phase
          : "listen_idle";
      return {
        state: { ...state, phase, listenReady: true },
        effects: [{ type: "UPDATE_STATUS" }],
      };
    }

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

    case "STT":
      return reduceVoiceCommandWakeStt(state, event, effects);

    default:
      return { state, effects: [] };
  }
}

/**
 * @param {VoiceWakeState} state
 * @param {{ text?: string; source?: string; playbackActive?: boolean; blocked?: boolean }} event
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
  if (playbackActive) {
    // Tijdens voorlezen komt het wake-woord vaak niet netjes aan het BEGIN van de uiting
    // terecht (TTS-echo van de eigen stem ervoor) — wakeOnly (^-anchored) mist dat dan.
    // containsOkMegaMinnieWake vangt "ok (mega)minnie" op elke positie, alleen relevant
    // hier tijdens playback (zelfde aanpak als containsReviewCorrectieCommand voor
    // "Correctie"). Dit was de reden dat "Ok Minnie" tijdens voorlezen herhaald moest worden.
    if ((wakeOnly || containsOkMegaMinnieWake(text)) && state.listenReady) {
      return startWakeAck(state, wakeKey, effects);
    }
    return { state, effects: [], handled: false, delegate: "review" };
  }

  if (!state.listenReady && !state.awaitingCommand && !state.ackInProgress && !state.pttActive) {
    return { state, effects: [], handled: false };
  }

  if (state.phase === "wake_ack" || state.ackInProgress) {
    if (wakeOnly) return { state, effects: [], handled: true };
    return {
      state: { ...state, pendingCommandDuringAck: text },
      effects: [],
      handled: true,
    };
  }

  if (state.awaitingCommand || state.pttActive) {
    if (wakeOnly) {
      if (shouldSkipWakeDuplicate(state, wakeKey)) return { state, effects: [], handled: true };
      return startWakeAck(state, wakeKey, effects);
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
    effects.push({ type: "EXECUTE_COMMAND", text });
    return {
      state: { ...state, phase: "executing" },
      effects,
      handled: true,
    };
  }

  return { state, effects: [], handled: false };
}

/**
 * @param {VoiceWakeState} state
 * @param {string} wakeKey
 * @param {VoiceWakeEffect[]} effects
 */
function startWakeAck(state, wakeKey, effects) {
  const generation = state.ackGeneration + 1;
  effects.push({ type: "PAUSE_PLAYBACK" });
  effects.push({ type: "SET_MIC", enabled: false });
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
    /** @param {{ text: string; source?: string; playbackActive?: boolean; blocked?: boolean }} ctx */
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
