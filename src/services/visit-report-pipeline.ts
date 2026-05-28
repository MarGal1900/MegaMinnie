import { runMegaMinnieAgent, runMegaMinnieExtendAgent } from "../agent/megaminnie-agent.js";
import { runMegaMinnieFromPhotos } from "../agent/megaminnie-from-photos.js";
import { prepareImageForApi } from "../lib/image-prepare.js";
import { getPhotoPipeline } from "../lib/vision-config.js";
import { matchSalesforceFromHints } from "./salesforce-search.js";
import { salesforceEnabled, syncToSalesforce } from "./salesforce.js";
import { extractTextFromPhotos, type PhotoInput } from "./vision.js";
import type {
  MegaMinnieOutput,
  VisitReportRequest,
  VisitReportResult,
  VisitReportSource,
} from "../types/visit-report.js";

export async function processVisitReport(
  request: VisitReportRequest,
): Promise<VisitReportResult> {
  const megaMinnie = await runMegaMinnieAgent(
    request.rawText,
    request.context,
    request.source,
  );

  const recordId =
    request.recordId?.trim() || process.env.SF_DEFAULT_WHAT_ID?.trim();

  let salesforce: VisitReportResult["salesforce"];

  if (recordId) {
    salesforce = await syncToSalesforce({
      recordId,
      output: megaMinnie,
    });
  } else if (!salesforceEnabled()) {
    salesforce = { taskIds: [], eventIds: [], dryRun: true };
  }

  const salesforceLink = await matchSalesforceFromHints(megaMinnie.customer);

  return {
    source: request.source,
    rawInput: request.rawText,
    megaMinnie,
    salesforceLink,
    salesforce,
  };
}

/** Foto('s) → transcriptie (vision) → MegaMinnie-verslag. */
export async function processVisitReportFromPhotos(
  images: PhotoInput[],
  context?: string,
): Promise<VisitReportResult> {
  const prepared = await Promise.all(
    images.map((img) => prepareImageForApi(img.buffer, img.mimeType)),
  );

  if (getPhotoPipeline() === "fast") {
    const { megaMinnie, rawInput } = await runMegaMinnieFromPhotos(prepared, context);
    const salesforceLink = await matchSalesforceFromHints(megaMinnie.customer);
    return { source: "photo", rawInput, megaMinnie, salesforceLink };
  }

  const rawText = await extractTextFromPhotos(prepared, context);
  if (!rawText.trim()) {
    throw new Error("Geen tekst uit de foto's gehaald — probeer een scherpere foto of hogere kwaliteit.");
  }

  const megaMinnie = await runMegaMinnieAgent(rawText, context, "photo");

  const salesforceLink = await matchSalesforceFromHints(megaMinnie.customer);

  return {
    source: "photo",
    rawInput: rawText,
    megaMinnie: { ...megaMinnie, sourceText: rawText },
    salesforceLink,
  };
}

/** Bestaand concept uit UI + nieuwe opname/foto-tekst → bijgewerkt verslag. */
export async function extendVisitReport(input: {
  existing: MegaMinnieOutput;
  supplementRawText: string;
  supplementSource: VisitReportSource;
}): Promise<VisitReportResult> {
  const megaMinnie = await runMegaMinnieExtendAgent(
    input.existing,
    input.supplementRawText,
    input.supplementSource,
  );

  const salesforceLink = await matchSalesforceFromHints(
    megaMinnie.customer ?? input.existing.customer,
  );

  return {
    source: input.supplementSource,
    rawInput: input.supplementRawText,
    transcript:
      input.supplementSource === "voice" ? input.supplementRawText : undefined,
    extended: true,
    megaMinnie,
    salesforceLink,
  };
}

export async function syncVisitReportToSalesforce(input: {
  recordId: string;
  megaMinnie: MegaMinnieOutput;
  source: VisitReportRequest["source"];
  rawInput: string;
}): Promise<VisitReportResult> {
  const salesforce = await syncToSalesforce({
    recordId: input.recordId.trim(),
    output: input.megaMinnie,
  });

  return {
    source: input.source,
    rawInput: input.rawInput,
    megaMinnie: input.megaMinnie,
    salesforce,
  };
}
