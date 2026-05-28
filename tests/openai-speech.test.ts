import { describe, expect, it, vi } from "vitest";
import {
  normalizeSpeechText,
  synthesizeOpenAiSpeech,
  validateSpeechPrereqs,
} from "../src/lib/openai-speech.js";

describe("validateSpeechPrereqs", () => {
  it("weigert zonder API-sleutel", () => {
    const result = validateSpeechPrereqs("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("accepteert met API-sleutel", () => {
    expect(validateSpeechPrereqs("sk-test").ok).toBe(true);
  });
});

describe("normalizeSpeechText", () => {
  it("trimt en normaliseert witruimte", () => {
    expect(normalizeSpeechText("  Hallo   wereld  ")).toBe("Hallo wereld");
  });

  it("weigert lege tekst", () => {
    expect(normalizeSpeechText("   ")).toBeNull();
  });
});

describe("synthesizeOpenAiSpeech", () => {
  it("roept OpenAI speech endpoint aan", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const buffer = await synthesizeOpenAiSpeech({
      text: "Test zin.",
      apiKey: "sk-test",
      model: "gpt-4o-mini-tts",
      voice: "verse",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    const body = JSON.parse(String(init.body ?? "{}"));
    expect(body).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "verse",
      input: "Test zin.",
      response_format: "mp3",
    });
  });
});
