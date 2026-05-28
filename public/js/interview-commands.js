export function normalizeCommandText(text) {
  return text
    .toLowerCase()
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
