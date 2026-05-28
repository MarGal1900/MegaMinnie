export function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function likePattern(term: string): string {
  const escaped = escapeSoql(normalizeTerm(term));
  return `%${escaped}%`;
}

export function scoreNameMatch(query: string, name: string): number {
  const q = normalizeTerm(query).toLowerCase();
  const n = name.trim().toLowerCase();
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.startsWith(q) || q.startsWith(n)) return 0.92;
  if (n.includes(q) || q.includes(n)) return 0.78;
  return 0.55;
}
