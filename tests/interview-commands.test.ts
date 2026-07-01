import { describe, expect, it } from "vitest";
import {
  detectInterviewCommand,
  detectInterviewCommandAtTail,
  detectRealtimeQaVoiceCommand,
  detectReviewVoiceCommand,
  endsWithReviewCorrectieCommand,
  isNextQuestionCommand,
  isRealtimeQaCancelCommand,
  isRealtimeQaStopCommand,
  parseAnswerTranscript,
  parseOkMegaMinnieWakeCommand,
  normalizeWakeCommandText,
  stripOkMegaMinnieWakePrefix,
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

  it("herkent maak taak en maak agenda", () => {
    expect(detectReviewVoiceCommand("maak taak")).toBe("maak_taak");
    expect(detectReviewVoiceCommand("Maak taak.")).toBe("maak_taak");
    expect(detectReviewVoiceCommand("Maak taak offerte opsturen voor volgende week")).toBe(
      "maak_taak",
    );
    expect(detectReviewVoiceCommand("Maak een taak aan")).toBe("maak_taak");
    expect(detectReviewVoiceCommand("Maak een taak aan klant bellen")).toBe("maak_taak");
    expect(detectReviewVoiceCommand("maak agenda")).toBe("maak_agenda");
    expect(detectReviewVoiceCommand("Maak agenda afspraak dinsdag 14 uur")).toBe("maak_agenda");
    expect(detectReviewVoiceCommand("Maak een agenda aan")).toBe("maak_agenda");
    expect(detectReviewVoiceCommand("Maak een agenda aan afspraak volgende week")).toBe(
      "maak_agenda",
    );
  });

  it("herkent natuurlijke voorlees-commando's", () => {
    expect(detectReviewVoiceCommand("Lees voor")).toBe("voorlezen");
    expect(detectReviewVoiceCommand("Lees het verslag voor")).toBe("voorlezen");
    expect(detectReviewVoiceCommand("lees het verslag")).toBe("voorlezen");
    expect(detectReviewVoiceCommand("Lees het uitgewerkte verslag voor")).toBe("voorlezen");
    expect(detectReviewVoiceCommand("Graag voorlezen")).toBe("voorlezen");
  });

  it("herkent natuurlijke taak-commando's", () => {
    expect(detectReviewVoiceCommand("Ik wil dat je een taak aanmaakt")).toBe("maak_taak");
    expect(detectReviewVoiceCommand("Zou je een taak willen aanmaken klant bellen")).toBe(
      "maak_taak",
    );
  });

  it("negeert inhoudelijke zinnen met taak of agenda", () => {
    expect(detectReviewVoiceCommand("we moeten een taak maken voor morgen")).toBe(null);
    expect(detectReviewVoiceCommand("zet dit op de agenda van de klant")).toBe(null);
  });

  it("strippt maak taak en maak agenda uit spraaktekst", () => {
    expect(stripReviewVoiceCommand("Maak taak offerte opsturen")).toBe("offerte opsturen");
    expect(stripReviewVoiceCommand("Maak een taak aan klant bellen")).toBe("klant bellen");
    expect(stripReviewVoiceCommand("Maak agenda afspraak dinsdag 14 uur")).toBe(
      "afspraak dinsdag 14 uur",
    );
    expect(stripReviewVoiceCommand("Maak een agenda aan afspraak dinsdag")).toBe(
      "afspraak dinsdag",
    );
    expect(stripReviewVoiceCommand("Lees het verslag voor")).toBe("");
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
    expect(stripReviewVoiceCommand("Correctie de datum is morgen")).toBe("de datum is morgen");
    // Standalone → lege remainder (activestatuscheck in maybeHandleReviewVoiceCommand)
    expect(stripReviewVoiceCommand("Correctie")).toBe("");
    expect(stripReviewVoiceCommand("Correctie.")).toBe("");
  });

  // Regressietest echo-guard: handleReviewInlineSpeechStarted keert terug (return) als
  // ttsActive=true, zodat TTS-echo's de correctiestroom niet activeren. Commando's komen
  // pas binnen via onSpeechStopped nadat de gebruiker daadwerkelijk spreekt — detectie
  // moet dan altijd werken, ongeacht de TTS-status ten tijde van het spreken.
  it("detecteert correctie-commando ongeacht of TTS actief was tijdens spreken", () => {
    const inputs = ["Correctie", "correctie.", "CORRECTIE!", "Correctie,"];
    for (const input of inputs) {
      expect(detectReviewVoiceCommand(input), input).toBe("correctie");
      expect(stripReviewVoiceCommand(input).trim(), input).toBe("");
    }
  });

  // Regressietest Fix 2: onTranscriptUpdate gebruikt de combinatie
  // detectReviewVoiceCommand(...) === "correctie" && !stripReviewVoiceCommand(...).trim()
  // om te bepalen of een commando gequeued moet worden tijdens finalizeInFlight.
  // Puur "Correctie" (geen remainder) → queuen. "Correctie [tekst]" → niet queuen.
  // Extra: de guard !pendingCorrectieAfterFinalize voorkomt dat herhaalde delta-events
  // de status meerdere keren updaten (idempotent zetten van de flag).
  it("onderscheidt puur correctie-commando van correctie-met-inhoud voor queue-guard", () => {
    const isPureCorrectieCommand = (text: string) =>
      detectReviewVoiceCommand(text) === "correctie" &&
      !stripReviewVoiceCommand(text).trim();

    // Puur commando → mag gequeued worden tijdens finalizeInFlight
    expect(isPureCorrectieCommand("Correctie")).toBe(true);
    expect(isPureCorrectieCommand("correctie.")).toBe(true);
    expect(isPureCorrectieCommand("CORRECTIE!")).toBe(true);
    expect(isPureCorrectieCommand("Correctie,")).toBe(true);

    // Commando met inhoud vooraan → niet queuen (correctietekst kan niet worden verwerkt)
    expect(isPureCorrectieCommand("Correctie de naam is Jan")).toBe(false);
    expect(isPureCorrectieCommand("Correctie het bedrag is vijfhonderd euro")).toBe(false);
    expect(isPureCorrectieCommand("Correctie. De datum moet morgen zijn.")).toBe(false);

    // Commando aan het einde (TTS-echo + Correctie) → wél herkend als commando, maar NIET puur
    // (heeft remainder → wordt door echo-check gefilterd in maybeHandleReviewVoiceCommand)
    expect(isPureCorrectieCommand("De naam is Jan Jansen. Correctie.")).toBe(false);
    expect(isPureCorrectieCommand("Taak 3 het afwijzen van de offerte Correctie")).toBe(false);

    // Geen commando → niet queuen
    expect(isPureCorrectieCommand("de correctie staat op pagina twee")).toBe(false);
    expect(isPureCorrectieCommand("voorlezen")).toBe(false);
    expect(isPureCorrectieCommand("stop")).toBe(false);
  });

  // Regressietest Fix B: endsWithReviewCorrectieCommand — carkit/speaker echo-scenario.
  // De Realtime API kan TTS-echo en gebruikersstem samenvoegen in één uiting.
  // "Correctie" aan het einde moet alsnog worden herkend.
  it("endsWithReviewCorrectieCommand herkent correctie aan het einde van een uiting", () => {
    // Positieve gevallen — "Correctie" als laatste woord (met of zonder interpunctie)
    expect(endsWithReviewCorrectieCommand("De naam is Jan Jansen. Correctie.")).toBe(true);
    expect(endsWithReviewCorrectieCommand("Taak 3 het afwijzen van de offerte Correctie")).toBe(true);
    expect(endsWithReviewCorrectieCommand("even corrigeren correctie")).toBe(true);
    expect(endsWithReviewCorrectieCommand("zeg ik correctie!")).toBe(true);

    // Negatieve gevallen — "Correctie" is NIET het laatste woord
    expect(endsWithReviewCorrectieCommand("de correctie staat op pagina twee")).toBe(false);
    expect(endsWithReviewCorrectieCommand("correctie van het bedrag")).toBe(false);

    // Negatieve gevallen — enkelvoudige uitingen (al gedekt door isReviewCorrectieCommand)
    expect(endsWithReviewCorrectieCommand("Correctie")).toBe(false);
    expect(endsWithReviewCorrectieCommand("correctie.")).toBe(false);

    // Negatieve gevallen — leeg of ander commando
    expect(endsWithReviewCorrectieCommand("")).toBe(false);
    expect(endsWithReviewCorrectieCommand("voorlezen")).toBe(false);
    expect(endsWithReviewCorrectieCommand("stop")).toBe(false);
  });

  it("detectReviewVoiceCommand herkent correctie aan het einde van een gecombineerde uiting", () => {
    expect(detectReviewVoiceCommand("De naam is Jan Jansen. Correctie.")).toBe("correctie");
    expect(detectReviewVoiceCommand("Taak 3 het afwijzen van de offerte Correctie")).toBe("correctie");
    // Controleer dat ander-einde-woorden GEEN false positive geven
    expect(detectReviewVoiceCommand("de correctie staat op pagina twee")).toBeNull();
    expect(detectReviewVoiceCommand("Dit is een correctie van de feiten")).toBeNull();
  });

  it("stripReviewVoiceCommand verwijdert correctie ook uit gecombineerde uiting", () => {
    expect(stripReviewVoiceCommand("De naam is Jan Jansen. Correctie.").trim())
      .toBe("De naam is Jan Jansen.");
    expect(stripReviewVoiceCommand("Taak 3 het afwijzen van de offerte Correctie").trim())
      .toBe("Taak 3 het afwijzen van de offerte");
  });
});

describe("Ok MegaMinnie wake phrase", () => {
  it("herkent wake prefix varianten", () => {
    expect(parseOkMegaMinnieWakeCommand("Ok MegaMinnie").wakeOnly).toBe(true);
    expect(parseOkMegaMinnieWakeCommand("Ok Minnie").wakeOnly).toBe(true);
    expect(parseOkMegaMinnieWakeCommand("Oké MegaMinnie.").wakeOnly).toBe(true);
    expect(parseOkMegaMinnieWakeCommand("oke megaminnie").wakeDetected).toBe(true);
  });

  it("splitst wake prefix en commando", () => {
    expect(parseOkMegaMinnieWakeCommand("Ok MegaMinnie, voorlezen")).toMatchObject({
      wakeDetected: true,
      wakeOnly: false,
      commandText: "voorlezen",
    });
    expect(parseOkMegaMinnieWakeCommand("Ok Minnie, lees voor")).toMatchObject({
      wakeDetected: true,
      wakeOnly: false,
      commandText: "lees voor",
    });
    expect(parseOkMegaMinnieWakeCommand("Oké MegaMinnie maak taak offerte sturen")).toMatchObject({
      wakeDetected: true,
      wakeOnly: false,
      commandText: "maak taak offerte sturen",
    });
  });

  it("herkent STT-varianten met spatie of Megan", () => {
    expect(parseOkMegaMinnieWakeCommand("Ok mega minnie").wakeOnly).toBe(true);
    expect(parseOkMegaMinnieWakeCommand("Okay Megan Minnie, stop").wakeDetected).toBe(true);
    expect(parseOkMegaMinnieWakeCommand("Ok mega mini voorlezen")).toMatchObject({
      wakeDetected: true,
      commandText: "voorlezen",
    });
    expect(parseOkMegaMinnieWakeCommand("Ok MeganMinnie").wakeOnly).toBe(true);
    expect(normalizeWakeCommandText("Okay Megan Minnie")).toBe("ok megaminnie");
  });

  it("laat gewone zinnen ongemoeid", () => {
    expect(parseOkMegaMinnieWakeCommand("hey megaminnie")).toMatchObject({
      wakeDetected: false,
      wakeOnly: false,
    });
    expect(stripOkMegaMinnieWakePrefix("voorlezen")).toBe("voorlezen");
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
