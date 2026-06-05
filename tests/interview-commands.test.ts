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

  it("herkent stop tijdens voorlezen", () => {
    expect(detectReviewVoiceCommand("stop")).toBe("stop");
    expect(detectReviewVoiceCommand("Stop.")).toBe("stop");
    expect(detectReviewVoiceCommand("stoppen")).toBe("stop");
  });

  it("negeert inhoudelijke zinnen", () => {
    expect(detectReviewVoiceCommand("de correctie staat in alinea twee")).toBe(null);
    expect(detectReviewVoiceCommand("kunnen we dit voorlezen aan de klant")).toBe(null);
    expect(detectReviewVoiceCommand("we moeten hier stoppen met de werkzaamheden")).toBe(null);
  });

  it("strippt commando uit correctietekst", () => {
    expect(stripReviewVoiceCommand("Correctie. De datum moet morgen zijn.")).toBe(
      "De datum moet morgen zijn.",
    );
  });

  // Regressietest: "Correctie" moet herkend blijven terwijl TTS spreekt.
  // handleReviewInlineSpeechStarted keert vroegtijdig terug bij ttsActive=true
  // (geen auto-interrupt), maar onSpeechStopped stuurt het transcript alsnog
  // door detectReviewVoiceCommand — die moet "correctie" blijven retourneren.
  it("herkent correctie ook met extra witruimte en leestekens", () => {
    expect(detectReviewVoiceCommand("  Correctie!  ")).toBe("correctie");
    expect(detectReviewVoiceCommand("correctie,")).toBe("correctie");
    expect(detectReviewVoiceCommand("CORRECTIE")).toBe("correctie");
  });

  it("herkent correctie gevolgd door inhoud als correctie-commando", () => {
    expect(detectReviewVoiceCommand("Correctie de naam is Jan Jansen")).toBe("correctie");
    expect(detectReviewVoiceCommand("correctie het bedrag is vijfhonderd euro")).toBe("correctie");
  });

  it("strippt correctie-prefix zodat alleen de correctietekst overblijft", () => {
    expect(stripReviewVoiceCommand("Correctie de naam is Jan Jansen")).toBe(
      "de naam is Jan Jansen",
    );
    expect(stripReviewVoiceCommand("Correctie. het bedrag is vijfhonderd euro")).toBe(
      "het bedrag is vijfhonderd euro",
    );
  });

  // Regressietest: correctie zonder extra tekst → detectReviewVoiceCommand returnt "correctie",
  // maar stripReviewVoiceCommand levert een lege string op.
  // maybeHandleReviewVoiceCommand moet in dit geval false teruggeven als active al true is,
  // zodat handleReviewInlineSpeechStopped de resume-timer niet blokkeert.
  it("correctie zonder tekst levert lege remainder op na strippen", () => {
    expect(stripReviewVoiceCommand("Correctie")).toBe("");
    expect(stripReviewVoiceCommand("Correctie.")).toBe("");
    expect(stripReviewVoiceCommand("CORRECTIE!")).toBe("");
  });

  // Regressietest: correctie moet herkend worden als het eerste woord in het transcript
  // is, ook als er ruis of witruimte voor staat — zo werkt onSpeechStopped na stilte.
  it("herkent correctie-commando ongeacht leading/trailing witruimte en varianten", () => {
    expect(detectReviewVoiceCommand("  correctie  ")).toBe("correctie");
    expect(detectReviewVoiceCommand("Correctie!")).toBe("correctie");
    expect(detectReviewVoiceCommand("Correctie,")).toBe("correctie");
    // Ingebed in een zin: GEEN commando
    expect(detectReviewVoiceCommand("Maak een correctie in alinea twee")).toBe(null);
    expect(detectReviewVoiceCommand("Er is een correctie nodig")).toBe(null);
  });

  // Regressietest: remainder na strippen van "Correctie" + correctietekst moet de correctietekst
  // opleveren zodat appendInlineCorrectionSegment de juiste inhoud ontvangt.
  it("strippt correctie-commando correct zodat de correctietekst overblijft", () => {
    expect(stripReviewVoiceCommand("Correctie het telefoonnummer is 06-12345678")).toBe(
      "het telefoonnummer is 06-12345678",
    );
    expect(stripReviewVoiceCommand("Correctie. De vergadering is op dinsdag.")).toBe(
      "De vergadering is op dinsdag.",
    );
    // Standalone → lege remainder (activestatuscheck in maybeHandleReviewVoiceCommand)
    expect(stripReviewVoiceCommand("Correctie")).toBe("");
    expect(stripReviewVoiceCommand("Correctie.")).toBe("");
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
