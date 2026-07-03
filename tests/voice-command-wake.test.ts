import { describe, expect, it } from "vitest";
import {
  createInitialVoiceCommandWakeState,
  createVoiceCommandWakeController,
  getVoiceWakeStatusMessage,
  isOkMinnieWakeOnlyPhrase,
  reduceVoiceCommandWake,
  shouldSkipWakeDuplicate,
} from "../public/js/voice-command-wake.js";

describe("isOkMinnieWakeOnlyPhrase", () => {
  it("herkent wake-only varianten", () => {
    expect(isOkMinnieWakeOnlyPhrase("Ok Minnie")).toBe(true);
    expect(isOkMinnieWakeOnlyPhrase("Ok MegaMinnie")).toBe(true);
    expect(isOkMinnieWakeOnlyPhrase("Ok Minnie, voorlezen")).toBe(false);
  });
});

describe("reduceVoiceCommandWake STT", () => {
  it("negeert wake vóór listen ready", () => {
    const state = { ...createInitialVoiceCommandWakeState(), phase: "connecting" as const };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "Ok Minnie",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(false);
    expect(result.effects).toHaveLength(0);
  });

  it("start wake ack na listen ready", () => {
    const state = {
      ...createInitialVoiceCommandWakeState(),
      phase: "listen_idle" as const,
      listenReady: true,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "Ok Minnie",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("wake_ack");
    expect(result.state.ackInProgress).toBe(true);
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(true);
    expect(result.effects.some((e) => e.type === "SET_MIC" && e.enabled === false)).toBe(
      false,
    );
  });

  it("zet dedupe pas na geslaagde ack", () => {
    const ackState = {
      ...createInitialVoiceCommandWakeState(),
      phase: "wake_ack" as const,
      ackInProgress: true,
      ackGeneration: 1,
    };
    const success = reduceVoiceCommandWake(ackState, {
      type: "WAKE_ACK_SUCCESS",
      generation: 1,
      wakeKey: "ok minnie",
      now: 1000,
    });
    expect(success.state.wakeDedupeKey).toBe("ok minnie");
    expect(success.state.awaitingCommand).toBe(true);
    expect(success.state.phase).toBe("awaiting_command");
  });

  it("cleared dedupe bij ack failure", () => {
    const ackState = {
      ...createInitialVoiceCommandWakeState(),
      phase: "wake_ack" as const,
      ackInProgress: true,
      ackGeneration: 2,
      wakeDedupeKey: "ok minnie",
      wakeDedupeAt: 500,
      listenReady: true,
    };
    const failed = reduceVoiceCommandWake(ackState, {
      type: "WAKE_ACK_FAILED",
      generation: 2,
    });
    expect(failed.state.wakeDedupeKey).toBe("");
    expect(failed.state.phase).toBe("listen_idle");
    expect(failed.effects.some((e) => e.type === "SHOW_ACK_FAILED")).toBe(true);
  });

  it("buffert commando tijdens ack", () => {
    const ackState = {
      ...createInitialVoiceCommandWakeState(),
      phase: "wake_ack" as const,
      ackInProgress: true,
      ackGeneration: 1,
    };
    const result = reduceVoiceCommandWake(ackState, {
      type: "STT",
      text: "lees het verslag voor",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.pendingCommandDuringAck).toBe("lees het verslag voor");
  });

  it("voert gebufferd commando uit na ack success", () => {
    const ackState = {
      ...createInitialVoiceCommandWakeState(),
      phase: "wake_ack" as const,
      ackInProgress: true,
      ackGeneration: 1,
      pendingCommandDuringAck: "voorlezen",
    };
    const success = reduceVoiceCommandWake(ackState, {
      type: "WAKE_ACK_SUCCESS",
      generation: 1,
      wakeKey: "ok minnie",
    });
    expect(success.effects.some((e) => e.type === "EXECUTE_COMMAND" && e.text === "voorlezen")).toBe(
      true,
    );
  });

  it("delegeert STT tijdens playback", () => {
    const state = {
      ...createInitialVoiceCommandWakeState(),
      phase: "playback_listen" as const,
      listenReady: true,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "Correctie",
      source: "final",
      playbackActive: true,
    });
    expect(result.delegate).toBe("review");
    expect(result.handled).toBe(false);
  });

  it("voert ja uit na voorlezen-aanbod (awaiting_command)", () => {
    const state = {
      ...createInitialVoiceCommandWakeState(),
      phase: "listen_idle" as const,
      listenReady: true,
      awaitingCommand: true,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "ja",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND" && e.text === "ja")).toBe(
      true,
    );
  });

  it("voert Ok Minnie ja direct uit i.p.v. wake ack", () => {
    const state = {
      ...createInitialVoiceCommandWakeState(),
      phase: "listen_idle" as const,
      listenReady: true,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "Ok Minnie, ja",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND" && e.text === "Ok Minnie, ja")).toBe(
      true,
    );
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(false);
  });
});

describe("shouldSkipWakeDuplicate", () => {
  it("slaat alleen over in awaiting binnen venster", () => {
    const state = {
      ...createInitialVoiceCommandWakeState(),
      awaitingCommand: true,
      wakeDedupeKey: "ok minnie",
      wakeDedupeAt: 1000,
    };
    expect(shouldSkipWakeDuplicate(state, "ok minnie", 1500)).toBe(true);
    expect(shouldSkipWakeDuplicate(state, "ok minnie", 2500)).toBe(false);
    expect(shouldSkipWakeDuplicate(state, "ok megaminnie", 1500)).toBe(false);
  });

  it("slaat tijdens voorlezen niet over als er geen inline-capture actief is", () => {
    const state = {
      ...createInitialVoiceCommandWakeState(),
      awaitingCommand: true,
      wakeDedupeKey: "ok minnie",
      wakeDedupeAt: 1000,
    };
    expect(
      shouldSkipWakeDuplicate(state, "ok minnie", 1500, {
        playbackActive: true,
        inlineCaptureActive: false,
      }),
    ).toBe(false);
  });
});

describe("createVoiceCommandWakeController", () => {
  it("speelt ack af en gaat naar awaiting", async () => {
    const played: number[] = [];
    const statuses: string[] = [];
    const ctrl = createVoiceCommandWakeController({
      onPlayWakeAck: async (generation) => {
        played.push(generation);
      },
      onStatus: (msg) => statuses.push(msg),
      onMicEnabled: () => {},
      onPausePlayback: () => {},
    });
    ctrl.dispatch({ type: "LISTEN_READY" });
    ctrl.handleStt({ text: "Ok Minnie", source: "final", playbackActive: false });
    expect(played).toEqual([1]);
    expect(ctrl.isAckInProgress()).toBe(true);
    ctrl.dispatch({ type: "WAKE_ACK_SUCCESS", generation: 1, wakeKey: "ok minnie" });
    expect(ctrl.isAwaitingCommand()).toBe(true);
    expect(ctrl.isAckInProgress()).toBe(false);
    expect(statuses.at(-1)).toBe("Ik luister…");
  });

  it("pauzeert en luistert na Ok Minnie tijdens voorlezen (geen correctiedialoog)", () => {
    let paused = false;
    let correctionStarted = false;
    const ctrl = createVoiceCommandWakeController({
      onPausePlayback: () => {
        paused = true;
      },
      onStartCorrection: () => {
        correctionStarted = true;
      },
      onMicEnabled: () => {},
    });
    ctrl.dispatch({ type: "LISTEN_READY" });
    ctrl.dispatch({ type: "PLAYBACK_STARTED" });
    ctrl.handleStt({ text: "Ok Minnie", source: "final", playbackActive: true });
    expect(paused).toBe(true);
    expect(correctionStarted).toBe(false);
    expect(ctrl.isAwaitingCommand()).toBe(true);
  });
});

describe("getVoiceWakeStatusMessage", () => {
  it("toont connecting vóór ready", () => {
    expect(getVoiceWakeStatusMessage(createInitialVoiceCommandWakeState())).toContain("verbinden");
    expect(
      getVoiceWakeStatusMessage({
        ...createInitialVoiceCommandWakeState(),
        phase: "listen_idle",
        listenReady: true,
      }),
    ).toContain("Ok Minnie");
  });
});
