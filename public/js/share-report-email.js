import { buildGespreksverslagDocxBlob } from "./gespreksverslag-docx.bundle.js";

/** @typedef {{ meetingSubject: string; reportBody: string; meetingDate?: Date | string; contactName?: string; recipientsInput?: string }} ShareReportContext */
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
 * @returns {string}
 */
export function buildGespreksverslagMailBody() {
  return [
    "Beste,",
    "",
    "Bijgaand ontvang je het gespreksverslag.",
    "",
    "Let op: het verslag is zojuist gedownload. Voeg dit bestand handmatig toe als bijlage.",
    "",
    "Met vriendelijke groet,",
  ].join("\n");
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
 * @param {string} url
 * @param {OutlookComposeTarget} [target]
 * @returns {boolean} false als het openen waarschijnlijk is geblokkeerd
 */
export function openOutlookCompose(url, target) {
  const resolvedTarget = target ?? detectOutlookComposeTarget();

  if (resolvedTarget === "mobile") {
    window.location.assign(url);
    return true;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    try {
      popup.close();
    } catch {
      /* tab sluiten niet altijd mogelijk */
    }
    return true;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return false;
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
  const body = buildGespreksverslagMailBody();
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
 * @param {ShareReportContext & { recipientsInput: string; composeTarget?: OutlookComposeTarget }} options
 * @returns {Promise<{ ok: true; recipients: string[]; subject: string; target: OutlookComposeTarget; filename: string; mailOpened: boolean; composeUrl: string } | { ok: false; error: string }>}
 */
export async function shareReportViaEmail(options) {
  const prepared = prepareShareReportEmail(options);
  if (!prepared.ok) return prepared;

  const meetingSubject = options.meetingSubject.trim() || "Meeting";
  const reportBody = options.reportBody.trim();
  const filename = buildReportAttachmentFilename(meetingSubject);
  const docxBlob = await buildGespreksverslagDocxBlob({
    meetingSubject,
    dateTimeLabel: resolveReportDateTimeLabel(options),
    reportBody,
  });

  downloadBlobAttachment(filename, docxBlob);
  const mailOpened = openOutlookCompose(prepared.url, prepared.target);

  return {
    ok: true,
    recipients: prepared.recipients,
    subject: prepared.subject,
    target: prepared.target,
    filename,
    mailOpened,
    composeUrl: prepared.url,
  };
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
 * @param {string} filename
 * @param {boolean} mailOpened
 * @returns {string}
 */
export function formatAttachmentShareSuccessMessage(filename, mailOpened) {
  const base = `${filename} is gedownload. Voeg dit bestand handmatig toe als bijlage.`;
  if (mailOpened) {
    return `${base} Je mailprogramma wordt geopend.`;
  }
  return `${base} Open je mail handmatig via de knop hieronder.`;
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

  /** @type {string | null} */
  let lastComposeUrl = null;

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.id = "btn-share-email-retry";
  retryButton.className = "btn btn--ghost btn--block share-report__retry";
  retryButton.textContent = "Open mail opnieuw";
  retryButton.hidden = true;

  retryButton.addEventListener("click", () => {
    if (!lastComposeUrl) return;
    const opened = openOutlookCompose(
      lastComposeUrl,
      detectOutlookComposeTarget(),
    );
    if (opened) {
      retryButton.hidden = true;
      deps.onFeedback?.(
        "Je mailprogramma wordt geopend. Vergeet niet het gedownloade bestand als bijlage toe te voegen.",
        "success",
      );
    } else {
      deps.onFeedback?.(
        "Je mailprogramma kon niet automatisch worden geopend. Probeer opnieuw of open je mail handmatig.",
        "warning",
      );
    }
  });

  if (section && link?.parentElement === section) {
    section.append(retryButton);
  }

  const setRetryVisible = (show) => {
    retryButton.hidden = !show;
  };

  const refreshLink = () => {
    if (section?.hidden) return;
    syncShareEmailLink(link, deps.getReportContext());
    if (link?.getAttribute("aria-disabled") === "true") {
      lastComposeUrl = null;
      setRetryVisible(false);
    }
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
      });

      if (!result.ok) {
        deps.onFeedback?.(result.error, "error");
        lastComposeUrl = null;
        setRetryVisible(false);
        return;
      }

      lastComposeUrl = result.composeUrl;
      setRetryVisible(!result.mailOpened);
      deps.onFeedback?.(
        formatAttachmentShareSuccessMessage(result.filename, result.mailOpened),
        result.mailOpened ? "success" : "warning",
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
      if (!show) {
        lastComposeUrl = null;
        setRetryVisible(false);
      }
      if (show) refreshLink();
    },
    refreshLink,
  };
}
