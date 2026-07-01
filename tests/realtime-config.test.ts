import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  REALTIME_POC_INSTRUCTIONS,
  REALTIME_QA_STOP_RESPONSE_TEXT,
  getRealtimeInstructions,
  getRealtimeModel,
  getRealtimeTranscriptionModel,
  getRealtimeVoice,
  isRealtimeInterviewEnabled,
} from "../src/lib/realtime-config.js";

describe("isRealtimeInterviewEnabled", () => {
  afterEach(() => {
    delete process.env.REALTIME_INTERVIEW_ENABLED;
    delete process.env.OPENAI_REALTIME_MODEL;
    delete process.env.OPENAI_REALTIME_VOICE;
    delete process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL;
  });

  it("is false wanneer flag ontbreekt", () => {
    delete process.env.REALTIME_INTERVIEW_ENABLED;
    expect(isRealtimeInterviewEnabled()).toBe(false);
  });

  it("is true bij REALTIME_INTERVIEW_ENABLED=true", () => {
    process.env.REALTIME_INTERVIEW_ENABLED = "true";
    expect(isRealtimeInterviewEnabled()).toBe(true);
  });

  it("heeft GA defaults voor model en voice", () => {
    expect(getRealtimeModel()).toBe("gpt-realtime-mini");
    expect(getRealtimeVoice()).toBe("verse");
    expect(getRealtimeTranscriptionModel()).toBe(DEFAULT_REALTIME_TRANSCRIPTION_MODEL);
  });
});

describe("realtime Q&A stop response", () => {
  afterEach(() => {
    delete process.env.OPENAI_REALTIME_INSTRUCTIONS;
  });

  it("gebruikt vaste stoptekst voor uitwerken", () => {
    expect(REALTIME_QA_STOP_RESPONSE_TEXT).toBe(
      "Oké, dank je wel. Ik ga het verslag nu uitwerken.",
    );
  });

  it("instrueert het model om exact die stoptekst te zeggen", () => {
    expect(REALTIME_POC_INSTRUCTIONS).toContain(REALTIME_QA_STOP_RESPONSE_TEXT);
    expect(getRealtimeInstructions()).toContain(
      "Als de gebruiker 'stop' of 'stoppen' zegt, zeg exact:",
    );
  });

  it("gebruikt custom instructies uit env wanneer gezet", () => {
    process.env.OPENAI_REALTIME_INSTRUCTIONS = "Custom instructies.";
    expect(getRealtimeInstructions()).toBe("Custom instructies.");
  });
});
