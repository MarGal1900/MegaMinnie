import {
  formatSalesforceLoginError,
  isSalesforceEnvConfigured,
} from "./salesforce-config.js";
import { getSalesforceConnection } from "../services/salesforce-connection.js";

let lastCheck: { at: number; reachable: boolean; error?: string } | null = null;
const CACHE_MS = 60_000;

export interface SalesforceHealthResult {
  reachable: boolean;
  error?: string;
  userId?: string;
  orgId?: string;
}

/** Test Salesforce-login (gecached 60s). */
export async function checkSalesforceConnection(
  force = false,
): Promise<SalesforceHealthResult | null> {
  if (!isSalesforceEnvConfigured()) return null;

  const now = Date.now();
  if (!force && lastCheck && now - lastCheck.at < CACHE_MS) {
    return {
      reachable: lastCheck.reachable,
      error: lastCheck.error,
    };
  }

  try {
    const conn = await getSalesforceConnection();
    const identity = conn.userInfo as { id?: string; organizationId?: string } | undefined;
    lastCheck = { at: now, reachable: true };
    return {
      reachable: true,
      userId: identity?.id,
      orgId: identity?.organizationId,
    };
  } catch (err) {
    const error = formatSalesforceLoginError(err);
    lastCheck = { at: now, reachable: false, error };
    return { reachable: false, error };
  }
}

export function clearSalesforceHealthCache(): void {
  lastCheck = null;
}
