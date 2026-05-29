import { describe, expect, it } from "vitest";
import {
  buildEmailDraftUserPrompt,
  EMAIL_DRAFT_SYSTEM_PROMPT,
} from "../src/agent/email-draft-prompt.js";
import { EmailDraftSchema } from "../src/types/visit-report.js";
import { appendMailSignature } from "../public/js/share-report-email.js";

describe("buildEmailDraftUserPrompt", () => {
  it("bevat gesprekscontext en contactgegevens", () => {
    const prompt = buildEmailDraftUserPrompt({
      meetingSubject: "Kick-off Acme",
      contactName: "Jan Jansen",
      meetingDate: "28 mei 2026",
      summary: "Besproken migratie en planning.",
      conversationAnalysis: {
        topicsDiscussed: ["migratie", "planning"],
        agreements: ["offerte volgende week"],
        actionItems: [{ who: "accountmanager", what: "offerte sturen" }],
        followUpAppointment: { scheduled: true, details: "15 juni 10:00" },
        readableSummary: "Goed gesprek over de migratie.",
      },
      source: "conversation",
    });

    expect(prompt).toContain("Kick-off Acme");
    expect(prompt).toContain("Jan Jansen");
    expect(prompt).toContain("migratie");
    expect(prompt).toContain("offerte sturen");
    expect(prompt).toContain('"subject"');
  });
});

describe("EMAIL_DRAFT_SYSTEM_PROMPT", () => {
  it("instrueert korte Nederlandse e-mail zonder handtekening", () => {
    expect(EMAIL_DRAFT_SYSTEM_PROMPT).toContain("Gespreksverslag - ");
    expect(EMAIL_DRAFT_SYSTEM_PROMPT).toContain("Met vriendelijke groet,");
    expect(EMAIL_DRAFT_SYSTEM_PROMPT).toContain("GEEN handtekening");
  });
});

describe("EmailDraftSchema", () => {
  it("valideert een kort concept", () => {
    const parsed = EmailDraftSchema.safeParse({
      subject: "Gespreksverslag - Kick-off Acme",
      body: "Beste Jan,\n\nBedankt voor het gesprek.\n\nMet vriendelijke groet,",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("appendMailSignature", () => {
  it("voegt handtekening toe na de afsluiting", () => {
    expect(
      appendMailSignature("Met vriendelijke groet,", "Jan Jansen\nCCS"),
    ).toBe("Met vriendelijke groet,\n\nJan Jansen\nCCS");
  });
});
