import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
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
