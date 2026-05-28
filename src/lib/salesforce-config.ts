export interface SalesforceConfigStatus {
  configured: boolean;
  missing: string[];
  dryRun: boolean;
  liveUploadEnabled: boolean;
}

const REQUIRED_VARS = [
  "SF_CLIENT_ID",
  "SF_CLIENT_SECRET",
  "SF_USERNAME",
  "SF_PASSWORD",
] as const;

export function getSalesforceConfigStatus(): SalesforceConfigStatus {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]?.trim());
  const configured = missing.length === 0;
  const dryRun = process.env.MEGAMINNIE_DRY_RUN === "true";

  return {
    configured,
    missing: [...missing],
    dryRun,
    liveUploadEnabled: configured && !dryRun,
  };
}

export function isSalesforceEnvConfigured(): boolean {
  return getSalesforceConfigStatus().configured;
}

/** Leesbare fout voor veelvoorkomende Salesforce-loginproblemen. */
export function formatSalesforceLoginError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Onbekende fout";

  if (/INVALID_LOGIN/i.test(message)) {
    return "Login mislukt: ongeldige gebruikersnaam, wachtwoord of security token.";
  }
  if (/LOGIN_MUST_USE_SECURITY_TOKEN/i.test(message)) {
    return "Login mislukt: voeg SF_SECURITY_TOKEN toe aan je wachtwoord in .env.";
  }
  if (/invalid_client/i.test(message)) {
    return "Connected App ongeldig: controleer SF_CLIENT_ID en SF_CLIENT_SECRET.";
  }
  if (/API_DISABLED_FOR_ORG/i.test(message)) {
    return "API-toegang is uitgeschakeld voor deze Salesforce-org.";
  }
  if (/REQUEST_LIMIT_EXCEEDED/i.test(message)) {
    return "Salesforce API-limiet bereikt. Probeer later opnieuw.";
  }

  return message;
}
