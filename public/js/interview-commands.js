export function normalizeCommandText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @returns {"advance"|"finish"|null} */
export function detectInterviewCommand(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;

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

  const advance =
    /\bvolgende\s+vraag\b/.test(n) ||
    /\bvolgende\s+vraak\b/.test(n) ||
    /\bvolgende\s+vrag\b/.test(n) ||
    /\bvolgende\s+graag\b/.test(n) ||
    /\bde\s+volgende\s+vraag\b/.test(n) ||
    /\bvolgende\b.*\bvraag\b/.test(n) ||
    /\bvraag\b.*\bvolgende\b/.test(n) ||
    /\bnaar\s+de\s+volgende\b/.test(n) ||
    /\bga\s+door\b/.test(n) ||
    /\bvolgend\b/.test(n) ||
    (n.includes("volgend") && (n.includes("vraag") || n.includes("vraak") || n.includes("vrag")));

  if (advance) return "advance";
  return null;
}

/** Commando aan het eind van de zin (na je antwoord). */
export function detectInterviewCommandAtTail(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;
  const tail = n.slice(-100);

  if (
    /\beinde\s+verslag\b/.test(tail) ||
    /\bverslag\s+klaar\b/.test(tail) ||
    (tail.includes("einde") && tail.includes("verslag")) ||
    (tail.includes("klaar") && tail.includes("verslag"))
  ) {
    return "finish";
  }

  if (
    /\bvolgende\s+vraag\b/.test(tail) ||
    /\bvolgende\s+vraak\b/.test(tail) ||
    /\bvolgende\s+vrag\b/.test(tail) ||
    /\bde\s+volgende\s+vraag\b/.test(tail) ||
    /\bga\s+door\b/.test(tail) ||
    (tail.includes("volgend") && tail.includes("vraag")) ||
    (tail.includes("volgende") && tail.includes("vraag")) ||
    /\bvolgend\b/.test(tail)
  ) {
    return "advance";
  }

  return detectInterviewCommand(n);
}

export function parseAnswerTranscript(text) {
  const cmd = detectInterviewCommand(text);
  const advanceNext = cmd === "advance";
  const endReport = cmd === "finish";
  const cleaned = text
    .replace(
      /\b(volgende\s+vraag|de\s+volgende\s+vraag|einde\s+verslag|verslag\s+klaar|ga\s+door)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return { cleaned, endReport, advanceNext };
}
