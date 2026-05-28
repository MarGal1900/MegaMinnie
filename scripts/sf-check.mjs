import "dotenv/config";
import { getSalesforceConfigStatus } from "../src/lib/salesforce-config.js";
import { checkSalesforceConnection } from "../src/lib/salesforce-health.js";
import { resetSalesforceConnection } from "../src/services/salesforce-connection.js";

const config = getSalesforceConfigStatus();

console.log("MegaMinnie — Salesforce check\n");

if (!config.configured) {
  console.log("Status: NIET geconfigureerd");
  console.log("Ontbrekend in .env:");
  for (const key of config.missing) console.log(`  - ${key}`);
  console.log("\nZie docs/SALESFORCE.md voor setup-instructies.");
  process.exit(1);
}

console.log("Configuratie: compleet");
console.log(`Login URL: ${process.env.SF_LOGIN_URL ?? "https://login.salesforce.com"}`);
console.log(`Gebruiker: ${process.env.SF_USERNAME}`);
console.log(`Preview-modus: ${config.dryRun ? "AAN" : "UIT"}`);

resetSalesforceConnection();
const health = await checkSalesforceConnection(true);

if (!health?.reachable) {
  console.log("\nLogin: MISLUKT");
  console.log(health?.error ?? "Onbekende fout");
  console.log("\nZie docs/SALESFORCE.md → Veelvoorkomende fouten.");
  process.exit(1);
}

console.log("\nLogin: OK");
if (health.userId) console.log(`User ID: ${health.userId}`);
if (health.orgId) console.log(`Org ID:  ${health.orgId}`);

if (config.dryRun) {
  console.log("\n→ Zet MEGAMINNIE_DRY_RUN=false in .env voor live upload.");
} else {
  console.log("\n→ Salesforce is klaar voor live upload.");
}

if (process.env.SF_DEFAULT_WHAT_ID?.trim()) {
  console.log(`→ Standaard record: ${process.env.SF_DEFAULT_WHAT_ID.trim()}`);
}
