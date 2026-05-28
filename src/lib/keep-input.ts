/** Testmodus: bibliotheek met opnames (IndexedDB); alleen handmatig verwijderen. */
export function isKeepInputEnabled(): boolean {
  const raw = process.env.MEGAMINNIE_KEEP_INPUT?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Standaard aan tijdens ontwikkeling / dry-run; productie: zet expliciet op false
  return process.env.MEGAMINNIE_DRY_RUN !== "false";
}
