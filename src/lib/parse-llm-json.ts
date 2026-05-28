/** Verwijdert veelvoorkomende LLM-afwijkingen (markdown, trailing comma's). */
function sanitizeJsonCandidate(raw: string): string {
  let s = raw.trim();
  // Verwijder BOM en zero-width characters
  s = s.replace(/^\uFEFF/, "").replace(/\u200B/g, "");
  // Trailing comma's voor } of ]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s;
}

/**
 * Parse JSON uit Claude/OpenAI-antwoord (vaak ```json ... ``` of extra tekst).
 */
export function parseJsonFromLlmResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Leeg antwoord van de AI");
  }

  const attempts: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) attempts.push(fence[1].trim());

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    attempts.push(trimmed.slice(start, end + 1));
  }

  let lastError: Error | undefined;
  for (const candidate of attempts) {
    const cleaned = sanitizeJsonCandidate(candidate);
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  const preview = trimmed.slice(0, 120).replace(/\s+/g, " ");
  throw new Error(
    `Kon JSON niet lezen (${lastError?.message ?? "onbekend"}). Begin antwoord: "${preview}…"`,
  );
}
