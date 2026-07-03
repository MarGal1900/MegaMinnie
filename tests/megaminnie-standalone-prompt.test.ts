import { describe, expect, it } from "vitest";
import { buildStandaloneCaptureUserPrompt } from "../src/agent/megaminnie-prompt.js";

describe("buildStandaloneCaptureUserPrompt", () => {
  it("bouwt een taak-instructie zonder bestaand verslag", () => {
    const prompt = buildStandaloneCaptureUserPrompt(
      "Maak een taak aan voor Jan Jansen: bel hem morgen terug over de offerte",
      "task",
    );
    expect(prompt).toContain("tasks-array met precies één taak");
    expect(prompt).toContain("Laat de events-array leeg");
    expect(prompt).toContain("Er is GEEN bezoekverslag");
    expect(prompt).toContain("bel hem morgen terug over de offerte");
  });

  it("bouwt een agenda-instructie zonder bestaand verslag", () => {
    const prompt = buildStandaloneCaptureUserPrompt(
      "Maak een agenda-item aan: afspraak met Acme dinsdag om 10 uur",
      "event",
    );
    expect(prompt).toContain("events-array met precies één agenda-item");
    expect(prompt).toContain("Laat de tasks-array leeg");
    expect(prompt).toContain("afspraak met Acme dinsdag om 10 uur");
  });

  it("verzint geen bezoekverslag-structuur — geen kopjes zoals bij een normaal verslag", () => {
    const prompt = buildStandaloneCaptureUserPrompt("Bel de klant morgen", "task");
    expect(prompt).not.toContain("Besproken punten");
    expect(prompt).not.toContain("Aanwezig");
  });
});
