import { describe, expect, it } from "vitest";
import {
  OUTLOOK_MOBILE_COMPOSE_BASE,
  buildMailtoComposeUrl,
  buildOutlookComposeUrl,
  buildOutlookMobileComposeUrl,
  buildShareEmailBody,
  buildShareEmailSubject,
  detectOutlookComposeTarget,
  extractMeetingDateFromReport,
  formatMeetingDateNl,
  formatOutlookComposeSuccessMessage,
  getOutlookComposeLengthError,
  parseRecipientEmails,
} from "../public/js/share-report-email.js";

describe("parseRecipientEmails", () => {
  it("splitst komma-gescheiden adressen", () => {
    expect(parseRecipientEmails("a@x.nl, b@y.nl")).toEqual(["a@x.nl", "b@y.nl"]);
  });

  it("negeert ongeldige adressen", () => {
    expect(parseRecipientEmails("niet-goed, klant@bedrijf.nl")).toEqual([
      "klant@bedrijf.nl",
    ]);
  });
});

describe("detectOutlookComposeTarget", () => {
  it("herkent mobiel", () => {
    expect(detectOutlookComposeTarget("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      "mobile",
    );
  });

  it("herkent desktop", () => {
    expect(detectOutlookComposeTarget("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "desktop",
    );
  });
});

describe("formatMeetingDateNl", () => {
  it("formatteert datums in het Nederlands", () => {
    expect(formatMeetingDateNl(new Date("2026-05-28T12:00:00"))).toBe(
      "28 mei 2026",
    );
  });
});

describe("extractMeetingDateFromReport", () => {
  it("haalt ISO-datums uit titel of body", () => {
    const date = extractMeetingDateFromReport(
      "Bezoek Acme",
      "**Bezoek:**\n2026-04-15 om 14:00",
    );
    expect(formatMeetingDateNl(date)).toBe("15 april 2026");
  });
});

describe("buildShareEmailSubject", () => {
  it("bouwt onderwerp met onderwerp en datum", () => {
    expect(
      buildShareEmailSubject("Kick-off Acme", "15 april 2026"),
    ).toBe("Verslag: Kick-off Acme - 15 april 2026");
  });
});

describe("buildShareEmailBody", () => {
  it("bevat begeleidende tekst en verslag in het midden", () => {
    const body = buildShareEmailBody({
      meetingSubject: "Kick-off Acme",
      meetingDate: "15 april 2026",
      reportBody: "**Besproken punten:**\nAlles liep goed.",
      contactName: "Jan Jansen",
    });

    expect(body).toContain("Beste Jan Jansen,");
    expect(body).toContain("uitgewerkte gespreksverslag");
    expect(body).toContain("aanvullingen, opmerkingen of correcties");
    expect(body).toContain("**Besproken punten:**");
    expect(body).toContain("Alles liep goed.");
  });
});

describe("buildOutlookComposeUrl", () => {
  it("gebruikt mailto op desktop", () => {
    const url = buildOutlookComposeUrl(
      ["a@x.nl", "b@y.nl"],
      "Verslag: Test - 1 mei 2026",
      "Hallo",
      "desktop",
    );
    expect(url.startsWith("mailto:a@x.nl,b@y.nl?")).toBe(true);
    expect(url).toContain("subject=Verslag%3A+Test+-+1+mei+2026");
  });

  it("gebruikt ms-outlook op mobiel", () => {
    const url = buildOutlookComposeUrl(
      ["a@x.nl", "b@y.nl"],
      "Verslag: Test - 1 mei 2026",
      "Hallo",
      "mobile",
    );
    expect(url.startsWith(`${OUTLOOK_MOBILE_COMPOSE_BASE}?`)).toBe(true);
    expect(url).toContain("to=a%40x.nl%2Cb%40y.nl");
  });
});

describe("buildMailtoComposeUrl", () => {
  it("encodeert onderwerp en body", () => {
    const url = buildMailtoComposeUrl(["klant@bedrijf.nl"], "Test", "Regel 1");
    expect(url).toBe("mailto:klant@bedrijf.nl?subject=Test&body=Regel+1");
  });

  it("werkt zonder ontvangers", () => {
    const url = buildMailtoComposeUrl([], "Test", "Regel 1");
    expect(url).toBe("mailto:?subject=Test&body=Regel+1");
  });
});

describe("buildOutlookMobileComposeUrl", () => {
  it("bouwt Outlook-app deeplink", () => {
    const url = buildOutlookMobileComposeUrl(["klant@bedrijf.nl"], "Test", "Body");
    expect(url).toBe(`${OUTLOOK_MOBILE_COMPOSE_BASE}?to=klant%40bedrijf.nl&subject=Test&body=Body`);
  });
});

describe("getOutlookComposeLengthError", () => {
  it("geeft desktop-limiet terug", () => {
    expect(getOutlookComposeLengthError("desktop", 2000)).toContain("desktop");
  });
});

describe("formatOutlookComposeSuccessMessage", () => {
  it("verschilt per platform", () => {
    expect(formatOutlookComposeSuccessMessage("mobile", 0)).toBe("Outlook-app geopend.");
    expect(formatOutlookComposeSuccessMessage("mobile", 2)).toContain("Outlook-app");
    expect(formatOutlookComposeSuccessMessage("desktop", 1)).toContain("standaard mailprogramma");
  });
});
