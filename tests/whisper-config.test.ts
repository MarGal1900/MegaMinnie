import { afterEach, describe, expect, it } from "vitest";
import {
  getTranscriptionProfile,
  getWhisperModel,
  getWhisperLanguage,
} from "../src/lib/whisper-config.js";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("whisper-config", () => {
  it("cloud quality default is gpt-4o-mini-transcribe", () => {
    delete process.env.WHISPER_BASE_URL;
    delete process.env.WHISPER_MODEL;
    delete process.env.WHISPER_PROFILE;
    expect(getWhisperModel()).toBe("gpt-4o-mini-transcribe");
    expect(getTranscriptionProfile()).toBe("quality");
  });

  it("WHISPER_PROFILE=legacy kiest whisper-1", () => {
    delete process.env.WHISPER_BASE_URL;
    delete process.env.WHISPER_MODEL;
    process.env.WHISPER_PROFILE = "legacy";
    expect(getWhisperModel()).toBe("whisper-1");
  });

  it("WHISPER_LANGUAGE default nl", () => {
    delete process.env.WHISPER_LANGUAGE;
    expect(getWhisperLanguage()).toBe("nl");
  });
});
