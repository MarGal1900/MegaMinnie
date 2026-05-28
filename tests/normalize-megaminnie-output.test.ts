import { describe, expect, it } from "vitest";
import { MegaMinnieOutputSchema } from "../src/types/visit-report.js";
import {
  formatMegaMinnieValidationError,
  formatNoteBodyInlineHeadings,
  normalizeMegaMinnieJson,
} from "../src/lib/normalize-megaminnie-output.js";

describe("normalizeMegaMinnieJson", () => {
  it("vult lege salesforceNote aan", () => {
    const normalized = normalizeMegaMinnieJson({
      salesforceNote: {},
      tasks: [],
      events: [],
    });
    const parsed = MegaMinnieOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.salesforceNote.title).toBe("Bezoekverslag");
      expect(parsed.data.salesforceNote.body.length).toBeGreaterThan(0);
    }
  });

  it("verwijdert markdown ** uit notitie", () => {
    const normalized = normalizeMegaMinnieJson({
      salesforceNote: {
        title: "**Bezoek** klant X",
        body: "**Bezoek**\\nTekst hier",
      },
      tasks: [],
      events: [],
    });
    const parsed = MegaMinnieOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.salesforceNote.title).not.toContain("**");
      expect(parsed.data.salesforceNote.body).not.toContain("**");
      expect(parsed.data.salesforceNote.title).toContain("Bezoek");
    }
  });

  it("filtert onvolledige taken", () => {
    const normalized = normalizeMegaMinnieJson({
      salesforceNote: { title: "Test", body: "Inhoud" },
      tasks: [{ subject: "Taak" }, { subject: "Goed", activityDate: "2026-05-27" }],
      events: [],
    });
    const parsed = MegaMinnieOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tasks).toHaveLength(1);
      expect(parsed.data.tasks[0]?.subject).toBe("Goed");
      expect(parsed.data.tasks[0]?.assignee).toBe("Accountmanager");
    }
  });

  it("normaliseert Europese taakdatums naar ISO", () => {
    const normalized = normalizeMegaMinnieJson({
      salesforceNote: { title: "Test", body: "Inhoud" },
      tasks: [{ subject: "Follow-up", activityDate: "28-05-2026" }],
      events: [],
    });
    const parsed = MegaMinnieOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tasks[0]?.activityDate).toBe("2026-05-28");
    }
  });

  it("behoudt expliciete verantwoordelijke op taken", () => {
    const normalized = normalizeMegaMinnieJson({
      salesforceNote: { title: "Test", body: "Inhoud" },
      tasks: [
        {
          subject: "Offerte sturen",
          activityDate: "2026-05-27",
          assignee: "Jan Jansen",
        },
      ],
      events: [],
    });
    const parsed = MegaMinnieOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tasks[0]?.assignee).toBe("Jan Jansen");
    }
  });

  it("zet sectiekoppen op kopregel met toelichting eronder", () => {
    const normalized = normalizeMegaMinnieJson({
      salesforceNote: {
        title: "Test",
        body: "Doel bezoek\nHet gesprek ging over uitbreiding.\n\nBesproken punten\nWe bespraken modules en planning.",
      },
      tasks: [],
      events: [],
    });
    const parsed = MegaMinnieOutputSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.salesforceNote.body).toBe(
        "**Doel bezoek:**\nHet gesprek ging over uitbreiding.\n\n**Besproken punten:**\nWe bespraken modules en planning.",
      );
    }
  });

  it("formatteert kop met streepje naar kopregel + toelichting", () => {
    const body = formatNoteBodyInlineHeadings("Bezoek – 27 mei 2026, kantoor Utrecht");
    expect(body).toBe("**Bezoek:**\n27 mei 2026, kantoor Utrecht");
  });

  it("formatteert zod-fouten leesbaar", () => {
    const parsed = MegaMinnieOutputSchema.safeParse({ tasks: [], events: [] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = formatMegaMinnieValidationError(parsed.error.issues);
      expect(msg).toContain("notitie");
      expect(msg).not.toBe("Required");
    }
  });
});
