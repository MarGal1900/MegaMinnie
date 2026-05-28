import { describe, expect, it } from "vitest";
import {
  europeanDateTimeToIso,
  europeanDateToIso,
  isoDateTimeToEuropeanDate,
  isoDateTimeToEuropeanTime,
  isoDateToEuropean,
} from "../public/js/dom.js";

describe("European date helpers", () => {
  it("zet ISO-datum om naar dd-mm-jjjj", () => {
    expect(isoDateToEuropean("2026-05-28")).toBe("28-05-2026");
  });

  it("zet Europese datum om naar ISO", () => {
    expect(europeanDateToIso("28-05-2026")).toBe("2026-05-28");
    expect(europeanDateToIso("28/05/2026")).toBe("2026-05-28");
  });

  it("weigert ongeldige Europese datums", () => {
    expect(europeanDateToIso("32-05-2026")).toBe("");
    expect(europeanDateToIso("abc")).toBe("");
  });

  it("zet ISO datum/tijd om naar Europese velden", () => {
    const iso = "2026-05-28T14:30:00.000Z";
    expect(isoDateTimeToEuropeanDate(iso)).toMatch(/^28-05-2026$/);
    expect(isoDateTimeToEuropeanTime(iso)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("zet Europese datum/tijd om naar ISO", () => {
    const iso = europeanDateTimeToIso("28-05-2026", "14:30");
    expect(iso).toContain("2026-05-28");
    expect(iso).toContain("T");
  });
});

describe("NL time picker helpers", () => {
  it("formatteert en parseert 24-uurs tijd", async () => {
    const { formatNlTime, parseNlTime, timeValueFromIso } = await import(
      "../public/js/nl-time-picker.js"
    );
    expect(formatNlTime(9, 5)).toBe("09:05");
    expect(parseNlTime("14:30")).toEqual({ h: 14, m: 30 });
    expect(timeValueFromIso("2026-05-28T14:30:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
