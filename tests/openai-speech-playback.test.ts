import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  MEGA_MINNIE_SPEECH_PLAYBACK_RATE,
  REALTIME_QA_OPENING_PLAYBACK_RATE,
  TTS_PLAYBACK_RATE,
  prefetchOpenAiSpeech,
} from "../public/js/openai-speech.js";

vi.mock("../public/js/api.js", () => ({
  apiPostBlob: vi.fn(),
}));

import { apiPostBlob } from "../public/js/api.js";

describe("TTS playback rate", () => {
  it("gebruikt overal hetzelfde tempo als de Realtime-wijzigingsdialoog", () => {
    expect(MEGA_MINNIE_SPEECH_PLAYBACK_RATE).toBe(1.0);
    expect(TTS_PLAYBACK_RATE).toBe(MEGA_MINNIE_SPEECH_PLAYBACK_RATE);
    expect(REALTIME_QA_OPENING_PLAYBACK_RATE).toBe(MEGA_MINNIE_SPEECH_PLAYBACK_RATE);
  });
});

describe("prefetchOpenAiSpeech", () => {
  beforeEach(() => {
    vi.mocked(apiPostBlob).mockReset();
    vi.mocked(apiPostBlob).mockResolvedValue(new Blob(["audio"]));
  });

  it("stuurt de echte tekst naar de API, niet de cache-sleutel", async () => {
    const text = "De uitwerking van het verslag is klaar. Zal ik het voorlezen?";
    await prefetchOpenAiSpeech(text);
    expect(apiPostBlob).toHaveBeenCalledWith("/api/realtime/speech", { text });
  });
});
