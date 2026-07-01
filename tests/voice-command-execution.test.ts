import { describe, expect, it } from "vitest";
import {
  createVoiceCommandExecutionGate,
  shouldTreatDuplicateWakeAsHandled,
} from "../public/js/voice-command-execution.js";

describe("createVoiceCommandExecutionGate", () => {
  it("start eerste commando direct", () => {
    const gate = createVoiceCommandExecutionGate();
    expect(gate.begin("voorlezen")).toBe("run");
    expect(gate.finish()).toBeNull();
  });

  it("coalesceert naar laatste tekst tijdens busy", () => {
    const gate = createVoiceCommandExecutionGate();
    expect(gate.begin("Ok Minnie, voorlezen")).toBe("run");
    expect(gate.begin("stop")).toBe("queue");
    expect(gate.begin("correctie")).toBe("queue");
    expect(gate.finish()).toBe("correctie");
  });

  it("negeert lege input", () => {
    const gate = createVoiceCommandExecutionGate();
    expect(gate.begin("   ")).toBe("skip");
    expect(gate.begin("")).toBe("skip");
  });

  it("normaliseert whitespace", () => {
    const gate = createVoiceCommandExecutionGate();
    expect(gate.begin("  Ok   Minnie  ")).toBe("run");
  });
});

describe("shouldTreatDuplicateWakeAsHandled", () => {
  it("slaat alleen over als wake-flow actief is", () => {
    const now = Date.now();
    expect(
      shouldTreatDuplicateWakeAsHandled("ok minnie", now, "ok minnie", false),
    ).toBe(false);
    expect(
      shouldTreatDuplicateWakeAsHandled("ok minnie", now, "ok minnie", true),
    ).toBe(true);
  });

  it("laat nieuwe wake na venster toe", () => {
    expect(
      shouldTreatDuplicateWakeAsHandled(
        "ok minnie",
        Date.now() - 1500,
        "ok minnie",
        true,
      ),
    ).toBe(false);
  });
});
