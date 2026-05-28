/** Standaard e-mailhandtekening (regels gescheiden met \\n in .env). */
export function getMailSignature(): string {
  const raw = process.env.MEGAMINNIE_MAIL_SIGNATURE?.trim();
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n").trim();
}
