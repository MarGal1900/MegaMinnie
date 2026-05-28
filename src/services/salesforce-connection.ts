import jsforce from "jsforce";
import { isSalesforceEnvConfigured } from "../lib/salesforce-config.js";

let connection: jsforce.Connection | null = null;

/** Gedeelde Salesforce-verbinding (login bij eerste gebruik). */
export async function getSalesforceConnection(): Promise<jsforce.Connection> {
  if (!isSalesforceEnvConfigured()) {
    throw new Error("Salesforce-credentials ontbreken in .env");
  }
  if (connection?.accessToken) return connection;

  const conn = new jsforce.Connection({
    loginUrl: process.env.SF_LOGIN_URL ?? "https://login.salesforce.com",
    oauth2: {
      clientId: process.env.SF_CLIENT_ID!,
      clientSecret: process.env.SF_CLIENT_SECRET!,
    },
  });

  const password =
    (process.env.SF_PASSWORD ?? "") + (process.env.SF_SECURITY_TOKEN ?? "");
  await conn.login(process.env.SF_USERNAME!, password);
  connection = conn;
  return conn;
}

/** Reset verbinding (bijv. na credential-wijziging). */
export function resetSalesforceConnection(): void {
  connection = null;
}
