import { z } from "zod";

/** Door MegaMinnie uit het verslag gehaalde klantgegevens voor Salesforce-zoeken. */
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && !v.trim() ? undefined : v),
  z.string().optional(),
);

export const CustomerHintsSchema = z.object({
  accountName: optionalString,
  contactName: optionalString,
  email: optionalString,
  phone: optionalString,
  opportunityName: optionalString,
});

export type CustomerHints = z.infer<typeof CustomerHintsSchema>;

export type SalesforceRecordType = "Account" | "Contact" | "Opportunity";

export interface SalesforceRecordHit {
  id: string;
  type: SalesforceRecordType;
  name: string;
  subtitle?: string;
  /** 0–1, hoger = betere match */
  score: number;
}

export interface SalesforceLinkResult {
  configured: boolean;
  extractedCustomer?: CustomerHints;
  suggestions: SalesforceRecordHit[];
  autoSelected: SalesforceRecordHit | null;
}
