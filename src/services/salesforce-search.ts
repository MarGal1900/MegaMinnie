import type {
  CustomerHints,
  SalesforceLinkResult,
  SalesforceRecordHit,
  SalesforceRecordType,
} from "../types/salesforce-records.js";
import { escapeSoql, likePattern, normalizeTerm, scoreNameMatch } from "../lib/soql.js";
import { salesforceConfigured } from "./salesforce.js";
import { getSalesforceConnection } from "./salesforce-connection.js";

function mergeHits(
  map: Map<string, SalesforceRecordHit>,
  hits: SalesforceRecordHit[],
): void {
  for (const hit of hits) {
    const existing = map.get(hit.id);
    if (!existing || hit.score > existing.score) {
      map.set(hit.id, hit);
    }
  }
}

async function queryAccounts(term: string): Promise<SalesforceRecordHit[]> {
  const conn = await getSalesforceConnection();
  const pattern = likePattern(term);
  const result = await conn.query<{
    Id: string;
    Name: string;
    BillingCity?: string;
  }>(
    `SELECT Id, Name, BillingCity FROM Account WHERE Name LIKE '${pattern}' ORDER BY Name LIMIT 8`,
  );
  return (result.records ?? []).map((r) => ({
    id: r.Id,
    type: "Account" as const,
    name: r.Name,
    subtitle: r.BillingCity ? `Account · ${r.BillingCity}` : "Account",
    score: scoreNameMatch(term, r.Name),
  }));
}

async function queryContacts(term: string, byEmail = false): Promise<SalesforceRecordHit[]> {
  const conn = await getSalesforceConnection();
  const escaped = escapeSoql(normalizeTerm(term));
  const where = byEmail
    ? `Email = '${escaped}'`
    : `(Name LIKE '${likePattern(term)}' OR Email LIKE '${likePattern(term)}')`;
  const result = await conn.query<{
    Id: string;
    Name: string;
    Email?: string;
    Account?: { Name?: string };
  }>(
    `SELECT Id, Name, Email, Account.Name FROM Contact WHERE ${where} ORDER BY Name LIMIT 8`,
  );
  return (result.records ?? []).map((r) => ({
    id: r.Id,
    type: "Contact" as const,
    name: r.Name,
    subtitle: r.Account?.Name
      ? `Contact · ${r.Account.Name}`
      : r.Email
        ? `Contact · ${r.Email}`
        : "Contact",
    score: byEmail ? 1 : Math.max(scoreNameMatch(term, r.Name), 0.7),
  }));
}

async function queryOpportunities(term: string): Promise<SalesforceRecordHit[]> {
  const conn = await getSalesforceConnection();
  const pattern = likePattern(term);
  const result = await conn.query<{
    Id: string;
    Name: string;
    StageName?: string;
    Account?: { Name?: string };
  }>(
    `SELECT Id, Name, StageName, Account.Name FROM Opportunity WHERE Name LIKE '${pattern}' ORDER BY Name LIMIT 8`,
  );
  return (result.records ?? []).map((r) => ({
    id: r.Id,
    type: "Opportunity" as const,
    name: r.Name,
    subtitle: [r.Account?.Name, r.StageName].filter(Boolean).join(" · ") || "Opportunity",
    score: scoreNameMatch(term, r.Name),
  }));
}

/** Vrije zoekopdracht in Account, Contact en Opportunity. */
export async function searchSalesforceRecords(
  query: string,
  limit = 12,
): Promise<SalesforceRecordHit[]> {
  const term = normalizeTerm(query);
  if (term.length < 2) return [];

  if (!salesforceConfigured()) {
    throw new Error("Salesforce is niet geconfigureerd (zie .env).");
  }

  const map = new Map<string, SalesforceRecordHit>();
  const [accounts, contacts, opps] = await Promise.all([
    queryAccounts(term),
    queryContacts(term),
    queryOpportunities(term),
  ]);
  mergeHits(map, accounts);
  mergeHits(map, contacts);
  mergeHits(map, opps);

  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function pickAutoSelected(hits: SalesforceRecordHit[]): SalesforceRecordHit | null {
  if (!hits.length) return null;
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (top.score >= 0.92) return top;
  if (sorted.length === 1 && top.score >= 0.75) return top;
  const second = sorted[1];
  if (top.score >= 0.85 && (!second || top.score - second.score >= 0.12)) {
    return top;
  }
  return null;
}

function hasCustomerHints(hints?: CustomerHints): boolean {
  if (!hints) return false;
  return Boolean(
    hints.accountName?.trim() ||
      hints.contactName?.trim() ||
      hints.email?.trim() ||
      hints.opportunityName?.trim(),
  );
}

/** Zoek Salesforce-records op basis van uit het verslag geëxtraheerde klantgegevens. */
export async function matchSalesforceFromHints(
  hints?: CustomerHints,
): Promise<SalesforceLinkResult> {
  const empty: SalesforceLinkResult = {
    configured: salesforceConfigured(),
    extractedCustomer: hints,
    suggestions: [],
    autoSelected: null,
  };

  if (!hints || !hasCustomerHints(hints) || !salesforceConfigured()) {
    return empty;
  }

  const map = new Map<string, SalesforceRecordHit>();
  const h = hints;

  if (h.email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h.email.trim())) {
    mergeHits(map, await queryContacts(h.email.trim(), true));
  }

  if (h.accountName?.trim()) {
    mergeHits(map, await queryAccounts(h.accountName.trim()));
  }

  if (h.contactName?.trim()) {
    mergeHits(map, await queryContacts(h.contactName.trim()));
  }

  if (h.opportunityName?.trim()) {
    mergeHits(map, await queryOpportunities(h.opportunityName.trim()));
  }

  const suggestions = [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    configured: true,
    extractedCustomer: hints,
    suggestions,
    autoSelected: pickAutoSelected(suggestions),
  };
}
