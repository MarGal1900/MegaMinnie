import { describe, expect, it, vi } from "vitest";
import {
  buildRealtimeSessionPayload,
  createRealtimeSession,
  validateRealtimeSessionPrereqs,
} from "../src/routes/realtime.js";

describe("createRealtimeSession", () => {
  it("faalt netjes als OPENAI_API_KEY ontbreekt", async () => {
    await expect(
      createRealtimeSession({
        apiKey: "",
        model: "gpt-realtime",
        voice: "alloy",
        instructions: "test",
        transcriptionModel: "gpt-4o-mini-transcribe",
      }),
    ).rejects.toThrow("OPENAI_API_KEY ontbreekt");
  });

  it("geeft client secret terug bij succesvolle OpenAI response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "sess_123",
        client_secret: {
          value: "ephemeral_secret_abc",
          expires_at: 1234567890,
        },
      }),
    });

    const result = await createRealtimeSession({
      apiKey: "sk-test",
      model: "gpt-realtime-mini",
      voice: "verse",
      instructions: "test",
      transcriptionModel: "gpt-4o-mini-transcribe",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect((init.headers as Record<string, string>)["OpenAI-Beta"]).toBeUndefined();
    const body = JSON.parse(String(init.body ?? "{}"));
    expect(body.session?.turn_detection).toBeUndefined();
    expect(body.session?.audio?.input?.turn_detection?.type).toBe("server_vad");
    expect(body.session?.audio?.input?.transcription).toEqual({
      model: "gpt-4o-mini-transcribe",
      language: "nl",
    });

    expect(result).toEqual({
      clientSecret: "ephemeral_secret_abc",
      expiresAt: 1234567890,
      sessionId: "sess_123",
      model: "gpt-realtime-mini",
      voice: "verse",
    });
  });

  it("accepteert ook GA payload met data.value", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "sess_456",
        data: { value: "ephemeral_from_data", expires_at: 44 },
      }),
    });

    const result = await createRealtimeSession({
      apiKey: "sk-test",
      model: "gpt-realtime-mini",
      voice: "verse",
      instructions: "test",
      transcriptionModel: "gpt-4o-mini-transcribe",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.clientSecret).toBe("ephemeral_from_data");
    expect(result.expiresAt).toBe(44);
  });
});

describe("buildRealtimeSessionPayload", () => {
  it("zet input transcriptie aan voor stop-herkenning", () => {
    const payload = buildRealtimeSessionPayload({
      model: "gpt-realtime-mini",
      voice: "verse",
      instructions: "test",
      transcriptionModel: "gpt-4o-mini-transcribe",
    });
    expect(payload.session.audio.input.transcription).toEqual({
      model: "gpt-4o-mini-transcribe",
      language: "nl",
    });
  });
});

describe("validateRealtimeSessionPrereqs", () => {
  it("faalt netjes als feature flag uit staat", () => {
    const result = validateRealtimeSessionPrereqs({
      enabled: false,
      apiKey: "sk-test",
    });
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Realtime interview is uitgeschakeld.",
    });
  });

  it("faalt netjes bij missende API key", () => {
    const result = validateRealtimeSessionPrereqs({
      enabled: true,
      apiKey: "",
    });
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "Realtime interview is niet geconfigureerd (OPENAI_API_KEY ontbreekt).",
    });
  });
});
