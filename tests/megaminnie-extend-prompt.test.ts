import { describe, expect, it } from "vitest";
import { buildExtendUserPrompt } from "../src/agent/megaminnie-prompt.js";

const existing = {
  title: "Bezoek ACME",
  body: "**Doel bezoek:**\nKennismaking",
  tasks: [{ subject: "Offerte sturen", activityDate: "2026-06-01", assignee: "Accountmanager" }],
  events: [],
};

describe("buildExtendUserPrompt task/event captures", () => {
  it("houdt taak-instructies gescheiden van verslagwijzigingen", () => {
    const prompt = buildExtendUserPrompt(existing, "Bel klant morgen over prijs", "task");
    expect(prompt).toContain("Voeg ALLEEN de nieuwe taak toe");
    expect(prompt).toContain("Wijzig salesforceNote title/body NIET");
    expect(prompt).toContain("Bel klant morgen over prijs");
  });

  it("houdt agenda-instructies gescheiden van verslagwijzigingen", () => {
    const prompt = buildExtendUserPrompt(
      existing,
      "Afspraak volgende week dinsdag om 14 uur",
      "event",
    );
    expect(prompt).toContain("Voeg ALLEEN het nieuwe agenda-item toe");
    expect(prompt).toContain("Wijzig salesforceNote title/body NIET");
    expect(prompt).toContain("Afspraak volgende week dinsdag om 14 uur");
  });
});
