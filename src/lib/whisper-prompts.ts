/**
 * Whisper "prompt" ≠ system prompt — voorafgaande context (max ~224 tokens bij whisper-1).
 * Niet ondersteund bij gpt-4o-transcribe-diarize.
 */
export const WHISPER_DOMAIN_PROMPT = [
  "Nederlands B2B-gesprek in de verzekeringsbranche.",
  "Termen: CCS, polis, dekking, schade, premie, acceptatie, renewal,",
  "accountmanager, klant, prospect, opportunity, Salesforce,",
  "bezoekverslag, offerte, voorwaarden, uitsluiting, eigen risico.",
].join(" ");

/** Interview: herken stuurcommando's na TTS-vraag. */
export const WHISPER_COMMAND_PROMPT =
  "volgende vraag. einde verslag. verslag klaar. ga door.";

const MAX_PROMPT_CHARS = 800;

export function buildWhisperPrompt(opts?: {
  domain?: boolean;
  extra?: string;
}): string | undefined {
  const parts: string[] = [];
  if (opts?.domain !== false) parts.push(WHISPER_DOMAIN_PROMPT);
  if (opts?.extra?.trim()) parts.push(opts.extra.trim());
  if (!parts.length) return undefined;
  return parts.join(" ").slice(0, MAX_PROMPT_CHARS);
}
