import type { MegaMinnieOutput } from "../types/visit-report.js";
import { getDefaultAccountManager } from "../lib/task-assignee-config.js";
import { getSalesforceConfigStatus } from "../lib/salesforce-config.js";
import { getSalesforceConnection } from "./salesforce-connection.js";

export function salesforceConfigured(): boolean {
  return getSalesforceConfigStatus().configured;
}

export function salesforceEnabled(): boolean {
  return getSalesforceConfigStatus().liveUploadEnabled;
}

export interface SalesforceSyncInput {
  recordId: string;
  ownerId?: string;
  output: MegaMinnieOutput;
}

export interface SyncItemResult {
  subject: string;
  success: boolean;
  id?: string;
  errors?: string[];
}

export interface SalesforceSyncResult {
  noteId?: string;
  taskIds: string[];
  eventIds: string[];
  taskResults: SyncItemResult[];
  eventResults: SyncItemResult[];
  dryRun: boolean;
}

function formatSfErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return ["Onbekende fout"];
  return errors.map((e) => {
    if (e && typeof e === "object" && "message" in e) {
      return String((e as { message: unknown }).message);
    }
    return String(e);
  });
}

function formatTaskDescription(task: MegaMinnieOutput["tasks"][number]): string | undefined {
  const assignee = task.assignee?.trim() || getDefaultAccountManager();
  const assigneeLine = assignee ? `Verantwoordelijke: ${assignee}` : "";
  const body = task.description?.trim() ?? "";
  if (assigneeLine && body) return `${assigneeLine}\n\n${body}`;
  if (assigneeLine) return assigneeLine;
  return body || undefined;
}

/** Notitie + optionele taken en events op gekoppeld record. */
export async function syncToSalesforce(
  input: SalesforceSyncInput,
): Promise<SalesforceSyncResult> {
  const empty: SalesforceSyncResult = {
    taskIds: [],
    eventIds: [],
    taskResults: [],
    eventResults: [],
    dryRun: !salesforceEnabled(),
  };

  if (!salesforceEnabled()) {
    return empty;
  }

  const conn = await getSalesforceConnection();
  const { recordId, output, ownerId } = input;

  const noteResult = await conn.sobject("ContentNote").create({
    Title: output.salesforceNote.title.slice(0, 80),
    Content: Buffer.from(output.salesforceNote.body, "utf8").toString("base64"),
  });

  if (!noteResult.success || !noteResult.id) {
    throw new Error(`ContentNote aanmaken mislukt: ${JSON.stringify(noteResult.errors)}`);
  }

  const linkResult = await conn.sobject("ContentDocumentLink").create({
    ContentDocumentId: noteResult.id,
    LinkedEntityId: recordId,
    ShareType: "V",
    Visibility: "AllUsers",
  });

  if (!linkResult.success) {
    throw new Error(
      `Notitie koppelen mislukt: ${JSON.stringify(linkResult.errors)}`,
    );
  }

  const taskResults: SyncItemResult[] = [];
  const taskIds: string[] = [];
  for (const task of output.tasks) {
    const created = await conn.sobject("Task").create({
      Subject: task.subject,
      Description: formatTaskDescription(task),
      ActivityDate: task.activityDate,
      Priority: task.priority,
      Status: task.status,
      WhatId: recordId,
      OwnerId: task.ownerId ?? ownerId,
    });
    const ok = Boolean(created.success && created.id);
    if (ok && created.id) taskIds.push(created.id);
    taskResults.push({
      subject: task.subject,
      success: ok,
      id: created.id,
      errors: ok ? undefined : formatSfErrors(created.errors),
    });
  }

  const eventResults: SyncItemResult[] = [];
  const eventIds: string[] = [];
  for (const event of output.events) {
    const created = await conn.sobject("Event").create({
      Subject: event.subject,
      Description: event.description,
      StartDateTime: event.startDateTime,
      EndDateTime: event.endDateTime,
      Location: event.location,
      WhatId: recordId,
      OwnerId: ownerId,
    });
    const ok = Boolean(created.success && created.id);
    if (ok && created.id) eventIds.push(created.id);
    eventResults.push({
      subject: event.subject,
      success: ok,
      id: created.id,
      errors: ok ? undefined : formatSfErrors(created.errors),
    });
  }

  return {
    noteId: noteResult.id,
    taskIds,
    eventIds,
    taskResults,
    eventResults,
    dryRun: false,
  };
}
