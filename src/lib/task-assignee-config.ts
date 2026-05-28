/** Standaard verantwoordelijke voor taken (later te koppelen aan SF-gebruiker/rol). */
export function getDefaultAccountManager(): string {
  const raw = process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER?.trim();
  return raw || "Accountmanager";
}
