import { describe, expect, it } from "vitest";
import {
  detectInterviewCommand,
  detectInterviewCommandAtTail,
  detectRealtimeQaVoiceCommand,
  detectReviewVoiceCommand,
  isNextQuestionCommand,
  isRealtimeQaCancelCommand,
  isRealtimeQaStopCommand,
  parseAnswerTranscript,
  stripReviewVoiceCommand,
} from "../public/js/interview-commands.js";

describe("isNextQuestionCommand", () => {
  it("herkent command-only varianten voor volgende vraag", () => {
    const positives = [
      "volgende vraag",
      "Volgende vraag.",
      "volgende",
      "ga door",
      "naar de volgende vraag",
      "stel de volgende vraag",
      "next",
      "next question",
      "  NEXT   QUESTION! ",
      "Naar de volgende vraag,",
    ];
    for (const sample of positives) {
      expect(isNextQuestionCommand(sample), sample).toBe(true);
    }
  });

  it("negeert inhoudelijke zinnen met volgende vraag", () => {
    const negatives = [
      "Ik denk dat we volgende vraag moeten bespreken",
      "De volgende vraag van de klant ging over pricing",
      "Mijn volgende vraag is nog niet beantwoord",
      "Kun je uitleggen wat de volgende vraag betekent?",
    ];
    for (const sample of negatives) {
      expect(isNextQuestionCommand(sample), sample).toBe(false);
    }
  });
});

describe("detectInterviewCommand", () => {
  it("herkent volgende vraag", () => {
    expect(detectInterviewCommand("volgende vraag")).toBe("advance");
    expect(detectInterviewCommand("Volgende vraag.")).toBe("advance");
  });

  it("herkent einde verslag", () => {
    expect(detectInterviewCommand("einde verslag")).toBe("finish");
  });

  it("negeert gewone antwoorden", () => {
    expect(detectInterviewCommand("we bespraken het prijsvoorstel")).toBe(null);
  });
});

describe("detectInterviewCommandAtTail", () => {
  it("herkent een trailing commando na antwoord", () => {
    const text =
      "We bespraken het prijsvoorstel en de planning voor Q3. De klant was positief. Volgende vraag.";
    expect(detectInterviewCommandAtTail(text)).toBe("advance");
  });

  it("herkent korte opdracht", () => {
    expect(detectInterviewCommandAtTail("volgende vraag")).toBe("advance");
  });

  it("negeert inhoudelijke zinnen zonder trailing command intent", () => {
    expect(
      detectInterviewCommandAtTail("Ik denk dat we volgende vraag moeten bespreken"),
    ).toBe(null);
  });
});

describe("realtime Q&A voice commands", () => {
  it("herkent stop voor uitwerking", () => {
    expect(isRealtimeQaStopCommand("stop")).toBe(true);
    expect(isRealtimeQaStopCommand("Stop.")).toBe(true);
    expect(isRealtimeQaStopCommand("Ok, stoppen")).toBe(true);
    expect(detectRealtimeQaVoiceCommand("stop")).toBe("stop");
  });

  it("herkent annuleer zonder uitwerking", () => {
    expect(isRealtimeQaCancelCommand("annuleer")).toBe(true);
    expect(isRealtimeQaCancelCommand("Annuleren")).toBe(true);
    expect(isRealtimeQaCancelCommand("cancel")).toBe(true);
    expect(detectRealtimeQaVoiceCommand("annuleer")).toBe("cancel");
  });

  it("negeert oude afrond-frasen zonder stop of annuleer", () => {
    expect(detectRealtimeQaVoiceCommand("klaar")).toBe(null);
    expect(detectRealtimeQaVoiceCommand("einde verslag")).toBe(null);
    expect(detectRealtimeQaVoiceCommand("afronden")).toBe(null);
  });
});

describe("review playback voice commands", () => {
  it("herkent correctie en voorlezen", () => {
    expect(detectReviewVoiceCommand("correctie")).toBe("correctie");
    expect(detectReviewVoiceCommand("Correctie.")).toBe("correctie");
    expect(detectReviewVoiceCommand("Correctie. De datum moet morgen zijn.")).toBe(
      "correctie",
    );
    expect(detectReviewVoiceCommand("voorlezen")).toBe("voorlezen");
    expect(detectReviewVoiceCommand("Voor lezen")).toBe("voorlezen");
  });

  it("negeert inhoudelijke zinnen", () => {
    expect(detectReviewVoiceCommand("de correctie staat in alinea twee")).toBe(null);
    expect(detectReviewVoiceCommand("kunnen we dit voorlezen aan de klant")).toBe(null);
  });

  it("strippt commando uit correctietekst", () => {
    expect(stripReviewVoiceCommand("Correctie. De datum moet morgen zijn.")).toBe(
      "De datum moet morgen zijn.",
    );
  });
});

describe("parseAnswerTranscript", () => {
  it("strippt command-only transcript voor volgende vraag", () => {
    const { cleaned, advanceNext } = parseAnswerTranscript("Volgende vraag.");
    expect(advanceNext).toBe(true);
    expect(cleaned).toBe("");
  });

  it("laat niet-command transcript intact", () => {
    const text = "De volgende vraag van de klant ging over pricing";
    const { cleaned, advanceNext } = parseAnswerTranscript(text);
    expect(advanceNext).toBe(false);
    expect(cleaned).toBe(text);
  });

  it("behoudt inhoud en strippt trailing command", () => {
    const text = "Het schadeportaal. Volgende vraag.";
    const { cleaned, advanceNext } = parseAnswerTranscript(text);
    expect(advanceNext).toBe(true);
    expect(cleaned).toBe("Het schadeportaal");
  });
});
