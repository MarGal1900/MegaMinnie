import { describe, expect, it } from "vitest";
import {
  INLINE_CORRECTION_EMPTY_RESUME_MS,
  INLINE_CORRECTION_RESUME_MS,
  getInlineCaptureProcessingStatus,
  getInlineCaptureStatusMessage,
  isInlineCaptureVoiceCommand,
  isReviewPlaybackStopCommand,
  resolveInlineCaptureIntent,
  resolveInlineCaptureSupplementSource,
  resolveInlineCorrectionResumeDelay,
  shouldCancelCorrectionResumeForUserSpeech,
  shouldDeferCorrectionResume,
  shouldIgnoreCorrectionSpeech,
  shouldPauseCorrectionResumeOnSpeechStart,
  shouldQueueCorrectieDuringFinalize,
  shouldSkipEmptyCorrectionResumeReschedule,
  shouldStartNewCorrectionRound,
} from "../public/js/review-inline-correction.js";

describe("inline correction resume delay", () => {
  it("wacht 3 seconden na correctie met inhoud", () => {
    expect(INLINE_CORRECTION_RESUME_MS).toBe(3000);
    expect(
      resolveInlineCorrectionResumeDelay({ segmentsLength: 1, enteredViaCommand: false }),
    ).toBe(3000);
    expect(
      resolveInlineCorrectionResumeDelay({ segmentsLength: 0, enteredViaCommand: true }),
    ).toBe(3000);
  });

  it("wacht korter na lege correctie zonder inhoud", () => {
    expect(INLINE_CORRECTION_EMPTY_RESUME_MS).toBe(1200);
    expect(
      resolveInlineCorrectionResumeDelay({ segmentsLength: 0, enteredViaCommand: false }),
    ).toBe(1200);
  });
});

describe("isReviewPlaybackStopCommand", () => {
  it("herkent stop als voorlezen-stopcommando", () => {
    expect(isReviewPlaybackStopCommand("stop")).toBe(true);
    expect(isReviewPlaybackStopCommand("correctie")).toBe(false);
    expect(isReviewPlaybackStopCommand("voorlezen")).toBe(false);
    expect(isReviewPlaybackStopCommand(null)).toBe(false);
  });
});

describe("inline capture voice commands", () => {
  it("koppelt spraakcommando aan intent en supplement source", () => {
    expect(isInlineCaptureVoiceCommand("maak_taak")).toBe(true);
    expect(isInlineCaptureVoiceCommand("maak_agenda")).toBe(true);
    expect(isInlineCaptureVoiceCommand("voorlezen")).toBe(false);
    expect(resolveInlineCaptureIntent("maak_taak")).toBe("task");
    expect(resolveInlineCaptureIntent("maak_agenda")).toBe("event");
    expect(resolveInlineCaptureSupplementSource("task")).toBe("task");
    expect(resolveInlineCaptureSupplementSource("event")).toBe("event");
  });

  it("geeft intent-specifieke statusberichten", () => {
    expect(getInlineCaptureStatusMessage("task")).toBe("Maak taak — spreek de taak in…");
    expect(getInlineCaptureStatusMessage("event")).toBe("Maak agenda — spreek het agenda-item in…");
    expect(getInlineCaptureProcessingStatus("task")).toBe("Taak verwerken…");
    expect(getInlineCaptureProcessingStatus("event")).toBe("Agenda-item verwerken…");
  });
});

describe("shouldStartNewCorrectionRound", () => {
  it("staat een nieuwe correctieronde toe na flush, vóór auto-hervatting", () => {
    expect(
      shouldStartNewCorrectionRound({
        active: true,
        flushedSegmentCount: 2,
        applyInFlight: false,
        finalizeInFlight: false,
      }),
    ).toBe(true);
  });

  it("blokkeert tijdens apply of finalize", () => {
    expect(
      shouldStartNewCorrectionRound({
        active: true,
        flushedSegmentCount: 1,
        applyInFlight: true,
        finalizeInFlight: false,
      }),
    ).toBe(false);
    expect(
      shouldStartNewCorrectionRound({
        active: true,
        flushedSegmentCount: 1,
        applyInFlight: false,
        finalizeInFlight: true,
      }),
    ).toBe(false);
  });

  it("blokkeert wanneer correctie niet actief is", () => {
    expect(
      shouldStartNewCorrectionRound({
        active: false,
        flushedSegmentCount: 1,
        applyInFlight: false,
        finalizeInFlight: false,
      }),
    ).toBe(false);
  });
});

describe("shouldIgnoreCorrectionSpeech", () => {
  it("negeert ruis terwijl auto-hervatting gepland staat", () => {
    expect(
      shouldIgnoreCorrectionSpeech({
        active: true,
        flushedSegmentCount: 1,
        resumeTimer: {},
        applyInFlight: false,
        correctionUserSpeaking: false,
      }),
    ).toBe(true);
  });

  it("accepteert vervolgtekst zolang de gebruiker nog spreekt", () => {
    expect(
      shouldIgnoreCorrectionSpeech({
        active: true,
        flushedSegmentCount: 1,
        resumeTimer: {},
        applyInFlight: false,
        correctionUserSpeaking: true,
      }),
    ).toBe(false);
  });

  it("accepteert spraak in een nieuwe ronde (geen resumeTimer)", () => {
    expect(
      shouldIgnoreCorrectionSpeech({
        active: true,
        flushedSegmentCount: 0,
        resumeTimer: null,
        applyInFlight: false,
        correctionUserSpeaking: false,
      }),
    ).toBe(false);
  });
});

describe("shouldCancelCorrectionResumeForUserSpeech", () => {
  it("annuleert auto-hervatting bij voortgezette gebruikersspraak", () => {
    expect(
      shouldCancelCorrectionResumeForUserSpeech(
        { active: true, resumeTimer: {}, finalizeInFlight: false },
        false,
      ),
    ).toBe(true);
    expect(
      shouldCancelCorrectionResumeForUserSpeech(
        { active: true, resumeTimer: {}, finalizeInFlight: false },
        true,
      ),
    ).toBe(false);
  });
});

describe("shouldSkipEmptyCorrectionResumeReschedule", () => {
  it("blokkeert alleen lege speech_stopped-reschedule", () => {
    expect(
      shouldSkipEmptyCorrectionResumeReschedule({
        flushedSegmentCount: 1,
        resumeTimer: {},
      }),
    ).toBe(true);
    expect(
      shouldSkipEmptyCorrectionResumeReschedule({
        flushedSegmentCount: 1,
        resumeTimer: null,
      }),
    ).toBe(false);
  });
});

describe("shouldQueueCorrectieDuringFinalize", () => {
  it("queuet elke correctie tijdens finalize, niet alleen puur commando", () => {
    expect(shouldQueueCorrectieDuringFinalize("correctie", false)).toBe(true);
    expect(shouldQueueCorrectieDuringFinalize("voorlezen", false)).toBe(false);
    expect(shouldQueueCorrectieDuringFinalize(null, false)).toBe(false);
  });

  it("queuet niet opnieuw als er al een pending correctie is", () => {
    expect(shouldQueueCorrectieDuringFinalize("correctie", true)).toBe(false);
  });
});

describe("shouldDeferCorrectionResume", () => {
  it("stelt auto-hervatting uit zolang de gebruiker nog spreekt", () => {
    expect(shouldDeferCorrectionResume({ correctionUserSpeaking: true })).toBe(true);
    expect(shouldDeferCorrectionResume({ correctionUserSpeaking: false })).toBe(false);
  });
});

describe("shouldPauseCorrectionResumeOnSpeechStart", () => {
  it("pauzeert alleen tijdens actieve correctie zonder TTS-echo", () => {
    expect(
      shouldPauseCorrectionResumeOnSpeechStart({
        active: true,
        ttsActive: false,
        finalizeInFlight: false,
      }),
    ).toBe(true);
    expect(
      shouldPauseCorrectionResumeOnSpeechStart({
        active: true,
        ttsActive: true,
        finalizeInFlight: false,
      }),
    ).toBe(false);
    expect(
      shouldPauseCorrectionResumeOnSpeechStart({
        active: false,
        ttsActive: false,
        finalizeInFlight: false,
      }),
    ).toBe(false);
  });
});
