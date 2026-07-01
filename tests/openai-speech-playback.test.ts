import { describe, expect, it } from "vitest";
import {
  REALTIME_QA_OPENING_PLAYBACK_RATE,
  TTS_PLAYBACK_RATE,
} from "../public/js/openai-speech.js";

describe("TTS playback rate", () => {
  it("is iets sneller dan normaal voor voorlezen", () => {
    expect(TTS_PLAYBACK_RATE).toBeGreaterThan(1);
    expect(TTS_PLAYBACK_RATE).toBeLessThanOrEqual(1.25);
  });

  it("gebruikt normale snelheid voor Vraag & Antwoord opening", () => {
    expect(REALTIME_QA_OPENING_PLAYBACK_RATE).toBe(1.0);
    expect(REALTIME_QA_OPENING_PLAYBACK_RATE).toBeLessThan(TTS_PLAYBACK_RATE);
  });
});
