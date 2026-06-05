import { z } from "zod";
import type { SalesforceLinkResult } from "./salesforce-records.js";
import { CustomerHintsSchema } from "./salesforce-records.js";

/** Gestructureerde output van de MegaMinnie-agent (één LLM-stap). */
export const MegaMinnieOutputSchema = z.object({
  salesforceNote: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
  }),
  tasks: z
    .array(
      z.object({
        subject: z.string().min(1),
        description: z.string().optional(),
        activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        priority: z.enum(["High", "Normal", "Low"]).default("Normal"),
        status: z.enum(["Not Started", "In Progress", "Completed"]).default("Not Started"),
        /** Naam verantwoordelijke; standaard accountmanager */
        assignee: z.string().min(1).optional(),
        /** Salesforce User Id (optioneel, voor latere koppeling) */
        ownerId: z.string().min(1).optional(),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        subject: z.string().min(1),
        description: z.string().optional(),
        startDateTime: z
          .string()
          .min(1)
          .refine(
            (v) => !Number.isNaN(Date.parse(v)),
            "startDateTime moet een geldige ISO-datum/tijd zijn",
          ),
        endDateTime: z
          .string()
          .min(1)
          .refine(
            (v) => !Number.isNaN(Date.parse(v)),
            "endDateTime moet een geldige ISO-datum/tijd zijn",
          ),
        location: z.string().optional(),
      }),
    )
    .default([]),
  summary: z.string().optional(),
  /** Tekst uit foto's (bron voor controle) */
  sourceText: z.string().optional(),
  /** Klantgegevens uit het verslag voor Salesforce-koppeling */
  customer: CustomerHintsSchema.optional(),
});

export type MegaMinnieOutput = z.infer<typeof MegaMinnieOutputSchema>;

export type VisitReportSource = "voice" | "photo" | "interview" | "conversation" | "correction";

export const ConversationAnalysisSchema = z.object({
  topicsDiscussed: z.array(z.string()).default([]),
  agreements: z.array(z.string()).default([]),
  actionItems: z
    .array(
      z.object({
        who: z.string().min(1),
        what: z.string().min(1),
      }),
    )
    .default([]),
  followUpAppointment: z
    .object({
      scheduled: z.boolean(),
      details: z.string().default(""),
    })
    .default({ scheduled: false, details: "" }),
  readableSummary: z.string().default(""),
});

export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>;

export interface VisitReportRequest {
  source: VisitReportSource;
  rawText: string;
  /** Account, Contact of Opportunity Id in Salesforce */
  recordId?: string;
  /** Extra context van de salescollega */
  context?: string;
}

export interface VisitReportResult {
  source: VisitReportSource;
  rawInput: string;
  /** Whisper-transcript; gezet bij voice of conversation */
  transcript?: string;
  /** Analyse van vrij opgenomen gesprek */
  conversationAnalysis?: ConversationAnalysis;
  /** True als dit een bijwerking van een bestaand concept was */
  extended?: boolean;
  megaMinnie: MegaMinnieOutput;
  /** Automatische zoekresultaten + voorstel voor Salesforce-koppeling */
  salesforceLink?: SalesforceLinkResult;
  salesforce?: {
    noteId?: string;
    taskIds: string[];
    eventIds: string[];
    taskResults?: { subject: string; success: boolean; id?: string; errors?: string[] }[];
    eventResults?: { subject: string; success: boolean; id?: string; errors?: string[] }[];
    dryRun: boolean;
  };
}
