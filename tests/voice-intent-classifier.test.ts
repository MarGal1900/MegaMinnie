import { describe, expect, it } from "vitest";
import {
  classifyVoiceIntent,
  isActionableVoiceIntent,
  normalizeVoiceIntentResult,
  VOICE_INTENT_MIN_CONFIDENCE,
} from "../src/lib/voice-intent-classifier.js";

describe("normalizeVoiceIntentResult", () => {
  it("normaliseert geldige LLM JSON", () => {
    expect(
      normalizeVoiceIntentResult({
        intent: "read_report",
        confidence: 0.91,
        remainder: "",
      }),
    ).toEqual({
      intent: "READ_REPORT",
      confidence: 0.91,
      remainder: "",
    });
  });

  it("valt terug op UNKNOWN bij ongeldige intent", () => {
    expect(normalizeVoiceIntentResult({ intent: "FOO", confidence: 2 })).toEqual({
      intent: "UNKNOWN",
      confidence: 1,
      remainder: "",
    });
  });

  it("beoordeelt actionable intents op confidence-drempel", () => {
    expect(
      isActionableVoiceIntent({ intent: "READ_REPORT", confidence: VOICE_INTENT_MIN_CONFIDENCE }),
    ).toBe(true);
    expect(
      isActionableVoiceIntent({ intent: "READ_REPORT", confidence: VOICE_INTENT_MIN_CONFIDENCE - 0.01 }),
    ).toBe(false);
    expect(isActionableVoiceIntent({ intent: "UNKNOWN", confidence: 1 })).toBe(false);
  });
});

describe("classifyVoiceIntent", () => {
  it("retourneert UNKNOWN voor lege input zonder LLM-call", async () => {
    await expect(classifyVoiceIntent("   ")).resolves.toEqual({
      intent: "UNKNOWN",
      confidence: 0,
      remainder: "",
    });
  });
});
