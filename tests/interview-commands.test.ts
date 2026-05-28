import { describe, expect, it } from "vitest";
import {
  detectInterviewCommand,
  detectInterviewCommandAtTail,
  parseAnswerTranscript,
} from "../public/js/interview-commands.js";

describe("detectInterviewCommand", () => {
  it("herkent volgende vraag", () => {
    expect(detectInterviewCommand("ok volgende vraag")).toBe("advance");
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
  it("herkent commando aan het einde van een lang antwoord", () => {
    const text =
      "We bespraken het prijsvoorstel en de planning voor Q3. De klant was positief. Volgende vraag.";
    expect(detectInterviewCommandAtTail(text)).toBe("advance");
  });

  it("herkent korte opdracht", () => {
    expect(detectInterviewCommandAtTail("volgende vraag")).toBe("advance");
  });
});

describe("parseAnswerTranscript", () => {
  it("strippt commando uit transcript", () => {
    const { cleaned, advanceNext } = parseAnswerTranscript(
      "Het ging goed. Volgende vraag.",
    );
    expect(advanceNext).toBe(true);
    expect(cleaned).not.toMatch(/volgende vraag/i);
  });
});
