import { describe, expect, it } from "vitest";
import { MegaMinnieOutputSchema } from "../src/types/visit-report.js";

describe("MegaMinnieOutputSchema", () => {
  it("valideert geldige output", () => {
    const data = {
      salesforceNote: { title: "Bezoek", body: "Inhoud" },
      tasks: [
        {
          subject: "Follow-up",
          activityDate: "2026-05-22",
          priority: "Normal",
          status: "Not Started",
        },
      ],
      events: [
        {
          subject: "Meeting",
          startDateTime: "2026-05-22T10:00:00.000Z",
          endDateTime: "2026-05-22T11:00:00.000Z",
        },
      ],
    };
    expect(MegaMinnieOutputSchema.safeParse(data).success).toBe(true);
  });

  it("weigert ongeldige event-datums", () => {
    const data = {
      salesforceNote: { title: "Bezoek", body: "Inhoud" },
      tasks: [],
      events: [
        {
          subject: "Meeting",
          startDateTime: "geen-datum",
          endDateTime: "2026-05-22T11:00:00.000Z",
        },
      ],
    };
    expect(MegaMinnieOutputSchema.safeParse(data).success).toBe(false);
  });

  it("weigert ongeldige task-datum", () => {
    const data = {
      salesforceNote: { title: "Bezoek", body: "Inhoud" },
      tasks: [{ subject: "Taak", activityDate: "22-05-2026" }],
      events: [],
    };
    expect(MegaMinnieOutputSchema.safeParse(data).success).toBe(false);
  });
});
