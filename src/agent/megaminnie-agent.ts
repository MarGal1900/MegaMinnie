import {
  buildExtendUserPrompt,
  buildUserPrompt,
  MEGAMINNIE_SYSTEM_PROMPT,
} from "./megaminnie-prompt.js";
import { createJsonCompletion } from "../lib/llm.js";
import { parseJsonFromLlmResponse } from "../lib/parse-llm-json.js";
import {
  formatMegaMinnieValidationError,
  normalizeMegaMinnieJson,
} from "../lib/normalize-megaminnie-output.js";
import {
  MegaMinnieOutputSchema,
  type MegaMinnieOutput,
  type VisitReportSource,
} from "../types/visit-report.js";

export async function runMegaMinnieAgent(
  rawText: string,
  context?: string,
  source?: VisitReportSource,
): Promise<MegaMinnieOutput> {
  if (!rawText.trim()) {
    throw new Error(
      "Geen transcript of tekst om uit te werken. Controleer je opname of probeer opnieuw.",
    );
  }

  const content = await createJsonCompletion(
    MEGAMINNIE_SYSTEM_PROMPT,
    buildUserPrompt(rawText, context, source),
  );

  const json = normalizeMegaMinnieJson(parseJsonFromLlmResponse(content));

  const parsed = MegaMinnieOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `MegaMinnie-antwoord onvolledig: ${formatMegaMinnieValidationError(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}

/** Bestaand concept + nieuwe ruwe input → bijgewerkt verslag. */
export async function runMegaMinnieExtendAgent(
  existing: MegaMinnieOutput,
  supplementRawText: string,
  supplementSource: VisitReportSource,
): Promise<MegaMinnieOutput> {
  const content = await createJsonCompletion(
    MEGAMINNIE_SYSTEM_PROMPT,
    buildExtendUserPrompt(
      {
        title: existing.salesforceNote.title,
        body: existing.salesforceNote.body,
        tasks: existing.tasks ?? [],
        events: existing.events ?? [],
      },
      supplementRawText,
      supplementSource,
    ),
  );

  const json = normalizeMegaMinnieJson(parseJsonFromLlmResponse(content));
  const parsed = MegaMinnieOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `MegaMinnie-antwoord onvolledig: ${formatMegaMinnieValidationError(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}
