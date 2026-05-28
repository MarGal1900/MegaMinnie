import { describe, expect, it } from "vitest";
import {
  buildRealtimeCallsRequest,
  readRealtimeTranscriptText,
} from "../public/js/realtime-interview.js";

describe("realtime frontend request builder", () => {
  it("bouwt GA calls request zonder server API key", () => {
    const form = buildRealtimeCallsRequest("v=0\no=- 1 2 IN IP4 127.0.0.1");
    expect(form.get("sdp")).toContain("IN IP4 127.0.0.1");
    expect(form.get("apiKey")).toBeNull();
    expect(form.get("OPENAI_API_KEY")).toBeNull();
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
