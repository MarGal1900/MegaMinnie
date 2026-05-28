import { describe, expect, it } from "vitest";
import {
  OUTLOOK_MOBILE_COMPOSE_BASE,
  buildGespreksverslagMailBody,
  buildGespreksverslagMailSubject,
  buildMailtoComposeUrl,
  buildOutlookComposeUrl,
  buildOutlookMobileComposeUrl,
  buildReportAttachmentContent,
  buildReportAttachmentFilename,
  buildShareEmailBody,
  buildShareEmailSubject,
  detectOutlookComposeTarget,
  extractDateTimeLabelFromTitle,
  extractMeetingDateFromReport,
  formatAttachmentShareSuccessMessage,
  formatMeetingDateNl,
  formatOutlookComposeSuccessMessage,
  getOutlookComposeLengthError,
  parseRecipientEmails,
  prepareShareReportEmail,
  sanitizeFilenameSegment,
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
    expect(url).toContain("subject=Verslag%3A%20Test%20-%201%20mei%202026");
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
    expect(url).toBe("mailto:klant@bedrijf.nl?subject=Test&body=Regel%201");
  });

  it("encodeert newlines in body", () => {
    const url = buildMailtoComposeUrl([], "Aanmelding event", "Hallo,\n\nIk wil mij aanmelden.");
    expect(url).toBe(
      "mailto:?subject=Aanmelding%20event&body=Hallo%2C%0A%0AIk%20wil%20mij%20aanmelden.",
    );
  });

  it("werkt zonder ontvangers", () => {
    const url = buildMailtoComposeUrl([], "Test", "Regel 1");
    expect(url).toBe("mailto:?subject=Test&body=Regel%201");
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

describe("sanitizeFilenameSegment", () => {
  it("maakt titels veilig voor bestandsnamen", () => {
    expect(sanitizeFilenameSegment("Interview (deels) 28-05-2026, 11:27")).toBe(
      "interview-deels-28-05-2026-1127",
    );
  });
});

describe("buildReportAttachmentFilename", () => {
  it("gebruikt het gevraagde bestandsnaamformaat", () => {
    expect(buildReportAttachmentFilename("Kick-off Acme")).toBe(
      "gespreksverslag-kick-off-acme.docx",
    );
  });
});

describe("extractDateTimeLabelFromTitle", () => {
  it("haalt datum en tijd uit de notitietitel", () => {
    expect(extractDateTimeLabelFromTitle("Interview 28-05-2026, 11:27")).toBe(
      "28-05-2026, 11:27",
    );
  });
});

describe("buildReportAttachmentContent", () => {
  it("bevat titel, datum en verslag", () => {
    const content = buildReportAttachmentContent({
      meetingSubject: "Interview 28-05-2026, 11:27",
      dateTimeLabel: "28-05-2026, 11:27",
      reportBody: "**Samenvatting:**\nGoed gesprek.",
    });

    expect(content).toContain("Notitietitel: Interview 28-05-2026, 11:27");
    expect(content).toContain("Datum/tijd: 28-05-2026, 11:27");
    expect(content).toContain("**Samenvatting:**");
  });
});

describe("buildGespreksverslagMailSubject", () => {
  it("bouwt onderwerp voor mailto", () => {
    expect(buildGespreksverslagMailSubject("Kick-off Acme")).toBe(
      "Gespreksverslag - Kick-off Acme",
    );
  });
});

describe("buildGespreksverslagMailBody", () => {
  it("bevat korte begeleidende tekst zonder verslag", () => {
    const body = buildGespreksverslagMailBody({
      contactName: "Jan Jansen",
      meetingDate: new Date("2026-05-28T12:00:00"),
    });
    expect(body).toContain("Beste Jan Jansen,");
    expect(body).toContain("prettige gesprek van 28 mei 2026");
    expect(body).toContain("uitgewerkte gespreksverslag");
    expect(body).toContain("aanvullingen, opmerkingen of correcties");
    expect(body).not.toContain("**");
    expect(body).not.toContain("handmatig toe als bijlage");
  });

  it("gebruikt algemene aanhef zonder contactnaam", () => {
    const body = buildGespreksverslagMailBody({
      meetingDate: "15 april 2026",
    });
    expect(body.startsWith("Beste,")).toBe(true);
    expect(body).toContain("prettige gesprek van 15 april 2026");
  });

  it("voegt standaard handtekening toe na afsluiting", () => {
    const body = buildGespreksverslagMailBody({
      meetingDate: "28 mei 2026",
      signature: "Marc van Galen\nCCS\nmarc@example.com",
    });
    expect(body).toContain("Met vriendelijke groet,");
    expect(body).toContain("Marc van Galen\nCCS\nmarc@example.com");
  });
});

describe("prepareShareReportEmail", () => {
  it("gebruikt korte mailtekst en geen volledig verslag in body", () => {
    const longReport = "Regel\n".repeat(400);
    const result = prepareShareReportEmail({
      recipientsInput: "klant@bedrijf.nl",
      meetingSubject: "Kick-off Acme",
      reportBody: longReport,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe("Gespreksverslag - Kick-off Acme");
    expect(result.url).toContain(encodeURIComponent("Gespreksverslag - Kick-off Acme"));
    expect(result.url).not.toContain(encodeURIComponent(longReport.slice(0, 40)));
  });
});

describe("formatAttachmentShareSuccessMessage", () => {
  it("vermeldt download en handmatige bijlage", () => {
    const message = formatAttachmentShareSuccessMessage("gespreksverslag-test.docx");
    expect(message).toContain("gedownload");
    expect(message).toContain("mailprogramma");
  });
});
