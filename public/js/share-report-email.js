import { buildGespreksverslagDocxBlob } from "./gespreksverslag-docx.bundle.js";
import { apiGetBlob, apiPost } from "./api.js";

/** @typedef {{ meetingSubject: string; reportBody: string; meetingDate?: Date | string; contactName?: string; recipientsInput?: string; mailSignature?: string }} ShareReportContext */
/** @typedef {"desktop" | "mobile"} OutlookComposeTarget */

/** Outlook-app op iOS/Android (ms-outlook://emails/new?to=…). */
export const OUTLOOK_MOBILE_COMPOSE_BASE = "ms-outlook://emails/new";

/** Desktop: mailto opent Outlook als standaard mailprogramma (Windows/Mac). */
const MAILTO_MAX_LENGTH = 1900;
const OUTLOOK_MOBILE_MAX_LENGTH = 4000;

const MONTHS_NL = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

/**
 * @param {string} [userAgent]
 * @returns {OutlookComposeTarget}
 */
export function detectOutlookComposeTarget(userAgent = globalThis.navigator?.userAgent ?? "") {
  return /Android|iPhone|iPod|Mobile/i.test(userAgent) ? "mobile" : "desktop";
}

/**
 * @param {Date | string | number} [date]
 * @returns {string}
 */
export function formatMeetingDateNl(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return formatMeetingDateNl(new Date());
  }
  return `${d.getDate()} ${MONTHS_NL[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * @param {string} input
 * @returns {string[]}
 */
export function parseRecipientEmails(input) {
  if (!input?.trim()) return [];
  return input
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part));
}

/**
 * @param {string} title
 * @param {string} body
 * @returns {Date}
 */
export function extractMeetingDateFromReport(title, body) {
  const haystack = `${title}\n${body}`;

  const isoMatch = haystack.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const dmyMatch = haystack.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (dmyMatch) {
    const parsed = new Date(
      Number(dmyMatch[3]),
      Number(dmyMatch[2]) - 1,
      Number(dmyMatch[1]),
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const dutchMatch = body.match(
    /\*\*Bezoek:\*\*\s*\n?\s*[^\n]*?(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/i,
  );
  if (dutchMatch) {
    const monthIdx = MONTHS_NL.indexOf(dutchMatch[2].toLowerCase());
    if (monthIdx >= 0) {
      const parsed = new Date(
        Number(dutchMatch[3]),
        monthIdx,
        Number(dutchMatch[1]),
      );
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  return new Date();
}

/**
 * @param {string} title
 * @returns {string}
 */
export function sanitizeFilenameSegment(title) {
  const normalized = title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "notitie";
}

/**
 * @param {string} meetingSubject
 * @returns {string}
 */
export function buildReportAttachmentFilename(meetingSubject) {
  return `gespreksverslag-${sanitizeFilenameSegment(meetingSubject)}.docx`;
}

/**
 * @param {string} title
 * @returns {string | null}
 */
export function extractDateTimeLabelFromTitle(title) {
  const match = title.match(
    /\b(\d{1,2})-(\d{1,2})-(20\d{2})(?:,\s*(\d{1,2}):(\d{2}))?\b/,
  );
  if (!match) return null;
  if (match[4] != null) {
    return `${match[1]}-${match[2]}-${match[3]}, ${match[4]}:${match[5]}`;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * @param {{ meetingSubject: string; dateTimeLabel?: string | null; reportBody: string }} input
 * @returns {string}
 */
export function buildReportAttachmentContent(input) {
  const lines = [`Notitietitel: ${input.meetingSubject.trim() || "Meeting"}`];
  const dateTime = input.dateTimeLabel?.trim();
  if (dateTime) {
    lines.push(`Datum/tijd: ${dateTime}`);
  }
  lines.push("", input.reportBody.trim());
  return lines.join("\n");
}

/**
 * @param {string} filename
 * @param {Blob} blob
 */
export function downloadBlobAttachment(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {string} meetingSubject
 * @returns {string}
 */
export function buildGespreksverslagMailSubject(meetingSubject) {
  const title = meetingSubject.trim() || "Meeting";
  return `Gespreksverslag - ${title}`;
}

/**
 * @param {{ contactName?: string; meetingDate?: Date | string; signature?: string }} [input]
 * @returns {string}
 */
export function buildGespreksverslagMailBody(input = {}) {
  const greeting = input.contactName?.trim()
    ? `Beste ${input.contactName.trim()},`
    : "Beste,";
  const dateStr =
    typeof input.meetingDate === "string"
      ? input.meetingDate
      : formatMeetingDateNl(input.meetingDate ?? new Date());

  const lines = [
    greeting,
    "",
    `Hartelijk dank voor het prettige gesprek van ${dateStr}. Zoals afgesproken vind je in de bijlage het uitgewerkte gespreksverslag.`,
    "",
    "Zou je het verslag willen controleren? Mocht je nog aanvullingen, opmerkingen of correcties hebben, dan hoor ik het graag. Dan weten we zeker dat we het complete beeld hebben voor de eventuele vervolgstappen.",
    "",
    "Met vriendelijke groet,",
  ];

  const signature = input.signature?.trim();
  if (signature) {
    lines.push("", signature);
  }

  return lines.join("\n");
}

/**
 * @param {string} meetingSubject
 * @param {Date | string} meetingDate
 * @returns {string}
 */
export function buildShareEmailSubject(meetingSubject, meetingDate) {
  const subject = meetingSubject.trim() || "Meeting";
  const dateStr =
    typeof meetingDate === "string" ? meetingDate : formatMeetingDateNl(meetingDate);
  return `Verslag: ${subject} - ${dateStr}`;
}

/**
 * @param {ShareReportContext} input
 * @returns {string}
 */
export function buildShareEmailBody(input) {
  const meetingSubject = input.meetingSubject.trim() || "Meeting";
  const dateStr =
    typeof input.meetingDate === "string"
      ? input.meetingDate
      : formatMeetingDateNl(input.meetingDate ?? new Date());
  const greeting = input.contactName?.trim()
    ? `Beste ${input.contactName.trim()},`
    : "Beste,";

  const intro = [
    greeting,
    "",
    `Hierbij ontvangt u het uitgewerkte gespreksverslag van ons gesprek "${meetingSubject}" op ${dateStr}.`,
    "",
    "Graag verzoek ik u dit verslag zorgvuldig door te nemen. Mocht u aanvullingen, opmerkingen of correcties hebben, dan hoor ik dat graag van u.",
    "",
    "Met vriendelijke groet,",
    "",
    "────────────────────────────────────────",
    "",
  ].join("\n");

  const footer = ["", "────────────────────────────────────────"].join("\n");
  return `${intro}${input.reportBody.trim()}${footer}`;
}

/**
 * @param {string[]} recipients
 * @param {string} subject
 * @param {string} body
 * @returns {string}
 */
export function buildMailtoComposeUrl(recipients, subject, body) {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const to = recipients.join(",");
  return to ? `mailto:${to}?${query}` : `mailto:?${query}`;
}

/**
 * @param {string[]} recipients
 * @param {string} subject
 * @param {string} body
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function buildOutlookMobileComposeUrl(
  recipients,
  subject,
  body,
  baseUrl = OUTLOOK_MOBILE_COMPOSE_BASE,
) {
  const params = [];
  if (recipients.length) {
    params.push(`to=${encodeURIComponent(recipients.join(","))}`);
  }
  params.push(`subject=${encodeURIComponent(subject)}`);
  params.push(`body=${encodeURIComponent(body)}`);
  return `${baseUrl}?${params.join("&")}`;
}

/**
 * @param {string[]} recipients
 * @param {string} subject
 * @param {string} body
 * @param {OutlookComposeTarget} [target]
 * @returns {string}
 */
export function buildOutlookComposeUrl(recipients, subject, body, target) {
  const resolvedTarget = target ?? detectOutlookComposeTarget();
  if (resolvedTarget === "mobile") {
    return buildOutlookMobileComposeUrl(recipients, subject, body);
  }
  return buildMailtoComposeUrl(recipients, subject, body);
}

/** @deprecated Gebruik buildMailtoComposeUrl. */
export function buildMailtoUrl(recipients, subject, body) {
  return buildMailtoComposeUrl(recipients, subject, body);
}

/**
 * Opent mailto / Outlook-compose zonder window.open (voorkomt lege tabs en dubbele pop-ups).
 *
 * @param {string} url
 * @param {OutlookComposeTarget} [target]
 */
export function openOutlookCompose(url, target) {
  const resolvedTarget = target ?? detectOutlookComposeTarget();

  if (resolvedTarget === "mobile") {
    window.location.assign(url);
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {OutlookComposeTarget} target
 * @param {number} urlLength
 * @returns {string | null}
 */
export function getOutlookComposeLengthError(target, urlLength) {
  const maxLength = target === "mobile" ? OUTLOOK_MOBILE_MAX_LENGTH : MAILTO_MAX_LENGTH;
  if (urlLength <= maxLength) return null;
  return target === "mobile"
    ? "Het verslag is te lang voor de Outlook-app. Verkort het verslag of kopieer het handmatig."
    : "Het verslag is te lang voor Outlook op desktop. Verkort het verslag of kopieer het handmatig.";
}

/**
 * @param {ShareReportContext & { recipientsInput: string; composeTarget?: OutlookComposeTarget }} options
 * @returns {{ ok: true; url: string; recipients: string[]; subject: string; target: OutlookComposeTarget } | { ok: false; error: string }}
 */
export function prepareShareReportEmail(options) {
  const recipients = parseRecipientEmails(options.recipientsInput ?? "");

  const reportBody = options.reportBody?.trim();
  if (!reportBody) {
    return { ok: false, error: "Er is nog geen verslag om te delen." };
  }

  const target = options.composeTarget ?? detectOutlookComposeTarget();
  const subject = buildGespreksverslagMailSubject(options.meetingSubject);
  const meetingDate =
    options.meetingDate ??
    extractMeetingDateFromReport(options.meetingSubject, reportBody);
  const body = buildGespreksverslagMailBody({
    contactName: options.contactName,
    meetingDate,
    signature: options.mailSignature,
  });
  const composeUrl = buildOutlookComposeUrl(recipients, subject, body, target);
  const lengthError = getOutlookComposeLengthError(target, composeUrl.length);

  if (lengthError) {
    return { ok: false, error: lengthError };
  }

  return { ok: true, url: composeUrl, recipients, subject, target };
}

/**
 * @param {ShareReportContext & { recipientsInput: string; composeTarget?: OutlookComposeTarget }} options
 * @returns {string | null}
 */
export function resolveReportDateTimeLabel(options) {
  const fromTitle = extractDateTimeLabelFromTitle(options.meetingSubject);
  if (fromTitle) return fromTitle;

  const meetingDate =
    options.meetingDate ??
    extractMeetingDateFromReport(
      options.meetingSubject,
      options.reportBody?.trim() ?? "",
    );
  return formatMeetingDateNl(meetingDate);
}

/**
 * @param {string} url
 * @param {string} filename
 */
async function downloadServerAttachment(url, filename) {
  const blob = await apiGetBlob(url);
  downloadBlobAttachment(filename, blob);
}

/**
 * Browser-fallback: DOCX downloaden + mailto (cloud of wanneer lokale opslag niet kan).
 * @param {ShareReportContext} options
 * @param {{ ok: true; url: string; recipients: string[]; subject: string; target: OutlookComposeTarget }} prepared
 */
async function shareReportViaEmailBrowserFallback(options, prepared) {
  const meetingSubject = options.meetingSubject.trim() || "Meeting";
  const reportBody = options.reportBody.trim();
  const filename = buildReportAttachmentFilename(meetingSubject);
  const docxBlob = await buildGespreksverslagDocxBlob({
    meetingSubject,
    dateTimeLabel: resolveReportDateTimeLabel(options),
    reportBody,
  });

  downloadBlobAttachment(filename, docxBlob);
  await delay(400);
  openOutlookCompose(prepared.url, prepared.target);

  return {
    ok: true,
    recipients: prepared.recipients,
    subject: prepared.subject,
    target: prepared.target,
    filename,
    docxFilename: filename,
    mailOpened: false,
    composeUrl: prepared.url,
  };
}

/**
 * @param {ShareReportContext & { recipientsInput: string; composeTarget?: OutlookComposeTarget }} options
 * @returns {Promise<{ ok: true; recipients: string[]; subject: string; target: OutlookComposeTarget; filename: string; docxFilename?: string; mailOpened: boolean; composeUrl: string; bezoekverslagenDir?: string; mailError?: string } | { ok: false; error: string }>}
 */
export async function shareReportViaEmail(options) {
  const prepared = prepareShareReportEmail(options);
  if (!prepared.ok) return prepared;

  const meetingSubject = options.meetingSubject.trim() || "Meeting";
  const reportBody = options.reportBody.trim();
  const dateTimeLabel = resolveReportDateTimeLabel(options);
  const meetingDate =
    options.meetingDate ?? extractMeetingDateFromReport(meetingSubject, reportBody);
  const mailBody = buildGespreksverslagMailBody({
    contactName: options.contactName,
    meetingDate,
    signature: options.mailSignature,
  });

  try {
    const data = await apiPost("/api/share-report/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meetingSubject,
        reportBody,
        dateTimeLabel,
        recipients: prepared.recipients,
        subject: prepared.subject,
        mailBody,
      }),
    });

    if (data.mailOpened) {
      return {
        ok: true,
        recipients: prepared.recipients,
        subject: prepared.subject,
        target: prepared.target,
        filename: data.pdfFilename,
        docxFilename: data.docxFilename,
        mailOpened: true,
        bezoekverslagenDir: data.bezoekverslagenDir,
        composeUrl: prepared.url,
      };
    }

    if (data.pdfDownloadUrl && data.pdfFilename) {
      await downloadServerAttachment(data.pdfDownloadUrl, data.pdfFilename);
      await delay(400);
    }
    openOutlookCompose(prepared.url, prepared.target);

    return {
      ok: true,
      recipients: prepared.recipients,
      subject: prepared.subject,
      target: prepared.target,
      filename: data.pdfFilename,
      docxFilename: data.docxFilename,
      mailOpened: false,
      bezoekverslagenDir: data.bezoekverslagenDir,
      mailError: data.mailError,
      composeUrl: prepared.url,
    };
  } catch {
    return shareReportViaEmailBrowserFallback(options, prepared);
  }
}

/**
 * @param {HTMLAnchorElement | null} anchor
 * @param {ShareReportContext | null} ctx
 */
export function syncShareEmailLink(anchor, ctx) {
  if (!anchor) return;

  if (!ctx) {
    anchor.removeAttribute("href");
    anchor.setAttribute("aria-disabled", "true");
    delete anchor.dataset.shareError;
    return;
  }

  const result = prepareShareReportEmail({
    recipientsInput: ctx.recipientsInput ?? "",
    meetingSubject: ctx.meetingSubject,
    reportBody: ctx.reportBody,
    meetingDate: ctx.meetingDate,
    contactName: ctx.contactName,
    mailSignature: ctx.mailSignature,
  });

  if (!result.ok) {
    anchor.removeAttribute("href");
    anchor.setAttribute("aria-disabled", "true");
    anchor.dataset.shareError = result.error;
    return;
  }

  anchor.href = "#";
  anchor.removeAttribute("aria-disabled");
  delete anchor.dataset.shareError;
}

/**
 * @param {string | { filename: string; docxFilename?: string; mailOpened?: boolean; bezoekverslagenDir?: string }} result
 * @returns {string}
 */
export function formatAttachmentShareSuccessMessage(result) {
  if (typeof result === "string") {
    return `${result} is gedownload. Voeg dit bestand handmatig toe als bijlage. Je mailprogramma wordt geopend.`;
  }

  const pdfName = result.filename;
  const docxName = result.docxFilename ?? pdfName.replace(/\.pdf$/i, ".docx");

  if (result.mailOpened) {
    const dir = result.bezoekverslagenDir ? ` (${result.bezoekverslagenDir})` : "";
    return `${docxName} en ${pdfName} opgeslagen in Bezoekverslagen${dir}. Outlook geopend met PDF-bijlage.`;
  }

  const dir = result.bezoekverslagenDir ? ` in Bezoekverslagen` : "";
  return `${docxName} opgeslagen${dir}. ${pdfName} gedownload — voeg als bijlage toe. Je mailprogramma wordt geopend.`;
}

/**
 * @param {OutlookComposeTarget} target
 * @param {number} count
 * @returns {string}
 */
export function formatOutlookComposeSuccessMessage(target, count) {
  if (count === 0) {
    return target === "mobile" ? "Outlook-app geopend." : "Outlook geopend.";
  }
  if (target === "mobile") {
    return `Outlook-app geopend voor ${count} ontvanger(s).`;
  }
  return `Outlook geopend voor ${count} ontvanger(s). Zet Outlook als standaard mailprogramma als dat nog niet zo is.`;
}

/**
 * @param {{ getReportContext: () => ShareReportContext | null; onFeedback?: (message: string, type: "success" | "error") => void }} deps
 */
export function initShareReportEmail(deps) {
  const section = document.getElementById("share-report-section");
  const link = document.getElementById("btn-share-email");

  const refreshLink = () => {
    if (section?.hidden) return;
    syncShareEmailLink(link, deps.getReportContext());
  };

  const runShare = async () => {
    const ctx = deps.getReportContext();
    if (!ctx) {
      deps.onFeedback?.("Laat MegaMinnie eerst het verslag uitwerken.", "error");
      return;
    }

    try {
      const result = await shareReportViaEmail({
        recipientsInput: ctx.recipientsInput ?? "",
        meetingSubject: ctx.meetingSubject,
        reportBody: ctx.reportBody,
        meetingDate: ctx.meetingDate,
        contactName: ctx.contactName,
        mailSignature: ctx.mailSignature,
      });

      if (!result.ok) {
        deps.onFeedback?.(result.error, "error");
        return;
      }

      deps.onFeedback?.(
        formatAttachmentShareSuccessMessage({
          filename: result.filename,
          docxFilename: result.docxFilename,
          mailOpened: result.mailOpened,
          bezoekverslagenDir: result.bezoekverslagenDir,
        }),
        "success",
      );
    } catch {
      deps.onFeedback?.(
        "Het gespreksverslag kon niet worden aangemaakt. Probeer het opnieuw.",
        "error",
      );
    }
  };

  link?.addEventListener("click", (event) => {
    event.preventDefault();
    if (link.getAttribute("aria-disabled") === "true") {
      const err = link.dataset.shareError;
      deps.onFeedback?.(err ?? "Er is nog geen verslag om te delen.", "error");
      return;
    }
    void runShare();
  });

  document.getElementById("note-title")?.addEventListener("input", refreshLink);
  document.getElementById("note-body")?.addEventListener("input", refreshLink);

  return {
    /** @param {boolean} show */
    updateVisibility(show) {
      if (section) section.hidden = !show;
      if (show) refreshLink();
    },
    refreshLink,
  };
}
