import { describe, expect, it } from "vitest";
import {
  REALTIME_QA_OPENING_TEXT,
  buildLiveRealtimeTranscript,
  buildRealtimeCallsRequest,
  readRealtimeTranscriptText,
} from "../public/js/realtime-interview.js";

describe("realtime frontend request builder", () => {
  it("gebruikt Hallo als vaste Vraag & Antwoord opening", () => {
    expect(REALTIME_QA_OPENING_TEXT).toBe("Hallo");
  });

  it("bouwt GA calls request zonder server API key", () => {
    const form = buildRealtimeCallsRequest("v=0\no=- 1 2 IN IP4 127.0.0.1");
    expect(form.get("sdp")).toContain("IN IP4 127.0.0.1");
    expect(form.get("apiKey")).toBeNull();
    expect(form.get("OPENAI_API_KEY")).toBeNull();
  });

  it("bouwt live transcript met openstaande user- en assistantregels", () => {
    expect(
      buildLiveRealtimeTranscript(
        [{ role: "assistant", text: "Hallo" }],
        "ik ben",
        "Waar",
      ),
    ).toBe("[Assistent]: Hallo\n[Gebruiker]: ik ben\n[Assistent]: Waar");
  });

  it("leest transcript uit GA transcription events", () => {
    expect(
      readRealtimeTranscriptText({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "stop",
      }),
    ).toBe("stop");
    expect(
      readRealtimeTranscriptText({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "af",
      }),
    ).toBe("af");
    expect(
      readRealtimeTranscriptText({
        item: { input_audio_transcription: { transcript: "afronden" } },
      }),
    ).toBe("afronden");
  });
});
