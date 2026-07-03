import { describe, expect, it } from "vitest";
import {
  buildCaptureDialogueOpeningPrompt,
  REALTIME_QA_OPENING_TEXT,
  buildLiveRealtimeTranscript,
  buildRealtimeCallsRequest,
  readRealtimeTranscriptText,
  requiresRemoteTrackBeforeOpening,
} from "../public/js/realtime-interview.js";

describe("buildCaptureDialogueOpeningPrompt", () => {
  it("gebruikt seed-remainder zonder opnieuw naar onderwerp te vragen", () => {
    const prompt = buildCaptureDialogueOpeningPrompt("task", "klant bellen morgen");
    expect(prompt).toContain("klant bellen morgen");
    expect(prompt).toContain("Vraag niet opnieuw naar het onderwerp");
    expect(prompt).not.toContain("Waar gaat de taak over?");
  });

  it("combineert kernvragen bij agenda zonder seed", () => {
    expect(buildCaptureDialogueOpeningPrompt("event")).toContain(
      "Waar gaat de afspraak over en wanneer",
    );
  });

  it("bevat korte-voorlezen-stijl, geen interview", () => {
    expect(buildCaptureDialogueOpeningPrompt("correction")).toContain("geen interview");
  });
});

describe("requiresRemoteTrackBeforeOpening", () => {
  it("wacht niet op remote track bij correctie/taak/agenda", () => {
    expect(
      requiresRemoteTrackBeforeOpening({ correctionDialogue: true }),
    ).toBe(false);
    expect(
      requiresRemoteTrackBeforeOpening({ captureDialogueKind: "event" }),
    ).toBe(false);
  });

  it("wacht wel op remote track bij Vraag & Antwoord", () => {
    expect(requiresRemoteTrackBeforeOpening()).toBe(true);
  });
});

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
