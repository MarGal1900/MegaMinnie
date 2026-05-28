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
  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  const to = recipients.join(",");
  return to ? `mailto:${to}?${params.toString()}` : `mailto:?${params.toString()}`;
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
  const params = new URLSearchParams();
  if (recipients.length) {
    params.set("to", recipients.join(","));
  }
  params.set("subject", subject);
  params.set("body", body);
  return `${baseUrl}?${params.toString()}`;
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
 * @returns {boolean}
 */
export function openOutlookCompose(url, target) {
  const resolvedTarget = target ?? detectOutlookComposeTarget();

  if (resolvedTarget === "mobile") {
    window.location.assign(url);
    return true;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
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
 * @returns {{ ok: true; recipients: string[]; subject: string; target: OutlookComposeTarget } | { ok: false; error: string }}
 */
export function shareReportViaEmail(options) {
  const recipients = parseRecipientEmails(options.recipientsInput ?? "");

  const reportBody = options.reportBody?.trim();
  if (!reportBody) {
    return { ok: false, error: "Er is nog geen verslag om te delen." };
  }

  const target = options.composeTarget ?? detectOutlookComposeTarget();
  const meetingDate =
    options.meetingDate ??
    extractMeetingDateFromReport(options.meetingSubject, reportBody);
  const dateStr = formatMeetingDateNl(meetingDate);
  const subject = buildShareEmailSubject(options.meetingSubject, dateStr);
  const body = buildShareEmailBody({
    meetingSubject: options.meetingSubject,
    meetingDate: dateStr,
    reportBody,
    contactName: options.contactName,
  });
  const composeUrl = buildOutlookComposeUrl(recipients, subject, body, target);
  const lengthError = getOutlookComposeLengthError(target, composeUrl.length);

  if (lengthError) {
    return { ok: false, error: lengthError };
  }

  openOutlookCompose(composeUrl, target);
  return { ok: true, recipients, subject, target };
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
  const btn = document.getElementById("btn-share-email");

  btn?.addEventListener("click", () => {
    const ctx = deps.getReportContext();
    if (!ctx) {
      deps.onFeedback?.("Laat MegaMinnie eerst het verslag uitwerken.", "error");
      return;
    }

    const result = shareReportViaEmail({
      recipientsInput: ctx.recipientsInput ?? "",
      meetingSubject: ctx.meetingSubject,
      reportBody: ctx.reportBody,
      meetingDate: ctx.meetingDate,
      contactName: ctx.contactName,
    });

    if (!result.ok) {
      deps.onFeedback?.(result.error, "error");
      return;
    }

    deps.onFeedback?.(
      formatOutlookComposeSuccessMessage(result.target, result.recipients.length),
      "success",
    );
  });

  return {
    /** @param {boolean} show */
    updateVisibility(show) {
      if (section) section.hidden = !show;
    },
  };
}
