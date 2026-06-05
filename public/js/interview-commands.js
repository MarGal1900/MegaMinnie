const CYRILLIC_TO_LATIN = {
  "стоп": "stop",
  "аннулируй": "annuleer",
  "аннулирую": "annuleer",
  "следующий": "volgende",
  "готово": "einde verslag",
};

export function normalizeCommandText(text) {
  let t = text.toLowerCase().trim();
  for (const [cyr, lat] of Object.entries(CYRILLIC_TO_LATIN)) {
    t = t.replace(new RegExp(cyr, "g"), lat);
  }
  return t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEXT_QUESTION_COMMANDS = new Set([
  "volgende vraag",
  "volgende",
  "ga door",
  "naar de volgende vraag",
  "stel de volgende vraag",
  "next",
  "next question",
]);

const NEXT_QUESTION_COMMAND_ALT =
  "naar\\s+de\\s+volgende\\s+vraag|stel\\s+de\\s+volgende\\s+vraag|next\\s+question|volgende\\s+vraag|ga\\s+door|volgende|next";
const NEXT_QUESTION_COMMAND_AT_END_RE = new RegExp(
  `(?:^|[.!?,;:]\\s*)(?:${NEXT_QUESTION_COMMAND_ALT})[.!?,;:]*\\s*$`,
  "iu",
);

export function isNextQuestionCommand(transcript) {
  const normalized = normalizeCommandText(transcript);
  if (!normalized) return false;
  return NEXT_QUESTION_COMMANDS.has(normalized);
}

function hasTrailingNextQuestionCommand(transcript) {
  if (typeof transcript !== "string") return false;
  const text = transcript.trim();
  if (!text) return false;
  return NEXT_QUESTION_COMMAND_AT_END_RE.test(text);
}

/** @returns {"advance"|"finish"|null} */
export function detectInterviewCommand(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;

  if (isNextQuestionCommand(n)) {
    return "advance";
  }

  if (
    /\beinde\s+verslag\b/.test(n) ||
    /\bverslag\s+klaar\b/.test(n) ||
    /\bmaak\s+(het\s+)?verslag\b/.test(n) ||
    /\bverslag\s+afmaken\b/.test(n) ||
    /\bklaar\b.*\bverslag\b/.test(n) ||
    (n.includes("einde") && n.includes("verslag")) ||
    (n.includes("inde") && n.includes("verslag"))
  ) {
    return "finish";
  }
  return null;
}

/** Commando aan het eind van de zin (na je antwoord). */
export function detectInterviewCommandAtTail(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;
  const tail = n.slice(-120);

  if (
    /\beinde\s+verslag\b/.test(tail) ||
    /\bverslag\s+klaar\b/.test(tail) ||
    (tail.includes("einde") && tail.includes("verslag")) ||
    (tail.includes("klaar") && tail.includes("verslag"))
  ) {
    return "finish";
  }

  if (isNextQuestionCommand(tail) || hasTrailingNextQuestionCommand(text)) return "advance";

  return detectInterviewCommand(n);
}

const REALTIME_QA_STOP_COMMANDS = new Set(["stop", "stoppen"]);
const REALTIME_QA_CANCEL_COMMANDS = new Set(["annuleer", "annuleren", "cancel"]);

/** @param {string} text */
export function isRealtimeQaStopCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REALTIME_QA_STOP_COMMANDS.has(normalized)) return true;
  return /\b(stop|stoppen)\b/.test(normalized);
}

/** @param {string} text */
export function isRealtimeQaCancelCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REALTIME_QA_CANCEL_COMMANDS.has(normalized)) return true;
  return /\b(annuleer|annuleren|cancel)\b/.test(normalized);
}

/** @returns {"stop"|"cancel"|null} */
export function detectRealtimeQaVoiceCommand(text) {
  if (isRealtimeQaCancelCommand(text)) return "cancel";
  if (isRealtimeQaStopCommand(text)) return "stop";
  return null;
}

const REVIEW_CORRECTIE_COMMANDS = new Set(["correctie"]);
const REVIEW_VOORLEZEN_COMMANDS = new Set(["voorlezen", "voor lezen"]);
const REVIEW_STOP_COMMANDS = new Set(["stop", "stoppen"]);

/** @param {string} text */
export function isReviewStopCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REVIEW_STOP_COMMANDS.has(normalized)) return true;
  return /^(stop|stoppen)[.!?,;:]*$/.test(normalized);
}

/** @param {string} text */
export function isReviewCorrectieCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REVIEW_CORRECTIE_COMMANDS.has(normalized)) return true;
  return /^correctie[.!?,;:]*$/.test(normalized);
}

/** @param {string} text */
export function isReviewVoorlezenCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REVIEW_VOORLEZEN_COMMANDS.has(normalized)) return true;
  return /^voorlezen[.!?,;:]*$/.test(normalized) || /^voor lezen[.!?,;:]*$/.test(normalized);
}

/** @param {string} text */
export function startsWithReviewCorrectieCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return /^correctie\b[.!?,;:]*\s+\S/.test(normalized);
}

/** @returns {"correctie"|"voorlezen"|"stop"|null} */
export function detectReviewVoiceCommand(text) {
  if (isReviewVoorlezenCommand(text)) return "voorlezen";
  if (isReviewCorrectieCommand(text)) return "correctie";
  if (startsWithReviewCorrectieCommand(text)) return "correctie";
  if (isReviewStopCommand(text)) return "stop";
  return null;
}

/** @param {string} text */
export function stripReviewVoiceCommand(text) {
  const original = typeof text === "string" ? text : "";
  let cleaned = original.replace(/\s+/g, " ").trim();
  cleaned = cleaned
    .replace(/\b(correctie|voorlezen|voor lezen)\b[.!?,;:]*\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

export function parseAnswerTranscript(text) {
  const original = typeof text === "string" ? text : "";
  const normalized = original.replace(/\s+/g, " ").trim();
  const advanceNext =
    isNextQuestionCommand(original) || hasTrailingNextQuestionCommand(original);
  const cmd = advanceNext ? "advance" : detectInterviewCommand(text);
  const endReport = cmd === "finish";
  let cleaned = normalized;
  if (advanceNext) {
    cleaned = normalized
      .replace(NEXT_QUESTION_COMMAND_AT_END_RE, "")
      .replace(/\s+/g, " ")
      .trim();
  } else if (endReport) {
    cleaned = normalized
      .replace(/\b(einde\s+verslag|verslag\s+klaar)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { cleaned, endReport, advanceNext };
}
