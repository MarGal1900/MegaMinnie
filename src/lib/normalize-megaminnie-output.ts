import type { ZodIssue } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidIsoDateTime(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "");
}

const NOTE_SECTION_HEADERS = [
  /^bezoek$/i,
  /^aanwezig$/i,
  /^doel(?:\s+bezoek)?$/i,
  /^besproken\s+punten$/i,
  /^klantbehoeften(?:\s*\/\s*pijnpunten)?$/i,
  /^pijnpunten$/i,
  /^afspraken(?:\s*&\s*vervolg)?$/i,
  /^interne\s+actiepunten$/i,
];

function normalizeSectionHeaderLabel(line: string): string | null {
  const trimmed = line
    .trim()
    .replace(/\*\*/g, "")
    .replace(/\s*[–—:\-]\s*$/, "")
    .trim();
  if (!trimmed) return null;
  for (const pattern of NOTE_SECTION_HEADERS) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(/\s+/g, " ");
    }
  }
  return null;
}

function isSectionHeaderLine(trimmed: string): boolean {
  if (!trimmed) return false;
  const colonInline = trimmed.match(/^\*{0,2}([^:\n*]{2,72})\*{0,2}:\s*(.*)$/);
  if (colonInline && normalizeSectionHeaderLabel(colonInline[1])) return true;
  const dashInline = trimmed.match(/^([^–—\-\n]{2,72})\s*[–—\-]\s*(.+)$/);
  if (dashInline && normalizeSectionHeaderLabel(dashInline[1])) return true;
  return normalizeSectionHeaderLabel(trimmed.replace(/:$/, "").trim()) !== null;
}

function nextNonEmptyLineIndex(lines: string[], fromIndex: number): number {
  let j = fromIndex + 1;
  while (j < lines.length && !lines[j].trim()) j++;
  return j;
}

/** Secties: kop op eigen regel, toelichting direct eronder. */
export function formatNoteBodyInlineHeadings(body: string): string {
  const lines = body.split(/\r?\n/);
  /** @type {{ header: string; content: string[] }[]} */
  const sections = [];
  /** @type {string[]} */
  let preamble = [];
  let currentHeader: string | null = null;
  /** @type {string[]} */
  let currentContent = [];

  const flush = () => {
    if (currentHeader !== null) {
      sections.push({ header: currentHeader, content: [...currentContent] });
      currentHeader = null;
      currentContent = [];
    }
  };

  const startSection = (header: string, firstLine?: string) => {
    flush();
    currentHeader = header;
    if (firstLine?.trim()) currentContent.push(firstLine.trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (currentHeader !== null && currentContent.length > 0) {
        const nextIndex = nextNonEmptyLineIndex(lines, i);
        if (nextIndex < lines.length && isSectionHeaderLine(lines[nextIndex].trim())) {
          continue;
        }
        currentContent.push("");
      }
      continue;
    }

    const colonInline = trimmed.match(/^\*{0,2}([^:\n*]{2,72})\*{0,2}:\s*(.+)$/);
    if (colonInline) {
      const header = normalizeSectionHeaderLabel(colonInline[1]);
      if (header) {
        startSection(header, colonInline[2]);
        continue;
      }
    }

    const dashInline = trimmed.match(/^([^–—\-\n]{2,72})\s*[–—\-]\s*(.+)$/);
    if (dashInline) {
      const header = normalizeSectionHeaderLabel(dashInline[1]);
      if (header) {
        startSection(header, dashInline[2]);
        continue;
      }
    }

    const headerOnly = normalizeSectionHeaderLabel(trimmed.replace(/:$/, "").trim());
    if (headerOnly) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && !normalizeSectionHeaderLabel(lines[j].trim().replace(/:$/, ""))) {
        startSection(headerOnly, lines[j].trim());
        i = j;
        continue;
      }
      startSection(headerOnly);
      continue;
    }

    if (currentHeader !== null) {
      currentContent.push(trimmed);
    } else {
      preamble.push(trimmed);
    }
  }
  flush();

  const formattedSections = sections.map(({ header, content }) => {
    while (content.length && content[content.length - 1] === "") content.pop();
    while (content.length && content[0] === "") content.shift();
    const text = content.join("\n").trim();
    const heading = `**${header}:**`;
    return text ? `${heading}\n${text}` : heading;
  });

  const blocks = [...(preamble.length ? [preamble.join("\n")] : []), ...formattedSections];
  return blocks
    .join("\n\n")
    .replace(/\*\*([^*]+):\*\*\n\n+/g, "**$1:**\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Herstelt veelvoorkomende LLM-afwijkingen vóór Zod-validatie. */
export function normalizeMegaMinnieJson(raw: unknown): unknown {
  const root = asRecord(raw);
  if (!root) return raw;

  let note = asRecord(root.salesforceNote);
  if (!note) note = asRecord(root.note);
  if (!note && (trimString(root.title) || trimString(root.body))) {
    note = { title: root.title, body: root.body };
  }
  note ??= {};

  const title = stripMarkdownFormatting(
    trimString(note.title) || trimString(root.title) || "Bezoekverslag",
  );
  let body = stripMarkdownFormatting(
    trimString(note.body) ||
      trimString(root.body) ||
      trimString(root.summary) ||
      trimString(root.verslag),
  );
  body = formatNoteBodyInlineHeadings(body);

  if (!body) {
    body = "[?] Geen uitwerking gegenereerd — controleer of de invoer/transcript voldoende inhoud heeft.";
  }

  const tasks = (Array.isArray(root.tasks) ? root.tasks : [])
    .map((item) => {
      const task = asRecord(item);
      if (!task) return null;
      const subject = trimString(task.subject);
      const activityDate = trimString(task.activityDate);
      if (!subject || !ISO_DATE.test(activityDate)) return null;
      return {
        subject,
        description: trimString(task.description) || undefined,
        activityDate,
        priority: task.priority ?? "Normal",
        status: task.status ?? "Not Started",
      };
    })
    .filter(Boolean);

  const events = (Array.isArray(root.events) ? root.events : [])
    .map((item) => {
      const event = asRecord(item);
      if (!event) return null;
      const subject = trimString(event.subject);
      const startDateTime = trimString(event.startDateTime);
      let endDateTime = trimString(event.endDateTime);
      if (!subject || !isValidIsoDateTime(startDateTime)) return null;
      if (!isValidIsoDateTime(endDateTime)) {
        const start = new Date(startDateTime);
        endDateTime = new Date(start.getTime() + 30 * 60 * 1000).toISOString();
      }
      const location = trimString(event.location);
      return {
        subject,
        description: trimString(event.description) || undefined,
        startDateTime,
        endDateTime,
        location: location || undefined,
      };
    })
    .filter(Boolean);

  const customer = asRecord(root.customer);
  const normalizedCustomer = customer
    ? {
        accountName: trimString(customer.accountName) || undefined,
        contactName: trimString(customer.contactName) || undefined,
        email: trimString(customer.email) || undefined,
        phone: trimString(customer.phone) || undefined,
        opportunityName: trimString(customer.opportunityName) || undefined,
      }
    : undefined;

  const summary = trimString(root.summary) || undefined;
  const sourceText = trimString(root.sourceText) || undefined;

  return {
    salesforceNote: { title, body },
    tasks,
    events,
    ...(normalizedCustomer &&
    Object.values(normalizedCustomer).some(Boolean)
      ? { customer: normalizedCustomer }
      : {}),
    ...(summary ? { summary } : {}),
    ...(sourceText ? { sourceText } : {}),
  };
}

export function formatMegaMinnieValidationError(issues: ZodIssue[]): string {
  const labels: Record<string, string> = {
    salesforceNote: "notitie",
    title: "titel",
    body: "tekst",
    tasks: "taken",
    events: "agenda",
    subject: "onderwerp",
    activityDate: "datum",
    startDateTime: "start",
    endDateTime: "einde",
  };

  const parts = issues.slice(0, 4).map((issue) => {
    const path = issue.path
      .map((p) => (typeof p === "string" ? labels[p] ?? p : String(p)))
      .join(" → ");
    const msg =
      issue.message === "Required"
        ? "ontbreekt"
        : issue.message.toLowerCase().includes("required")
          ? "ontbreekt"
          : issue.message;
    return path ? `${path}: ${msg}` : msg;
  });

  return parts.join("; ") || "onbekende fout";
}
