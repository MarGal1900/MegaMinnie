import {
  buildConversationUserPrompt,
  MEGAMINNIE_SYSTEM_PROMPT,
} from "./conversation-prompt.js";
import { createJsonCompletion } from "../lib/llm.js";
import { parseJsonFromLlmResponse } from "../lib/parse-llm-json.js";
import {
  formatMegaMinnieValidationError,
  normalizeMegaMinnieJson,
} from "../lib/normalize-megaminnie-output.js";
import {
  ConversationAnalysisSchema,
  MegaMinnieOutputSchema,
  type ConversationAnalysis,
  type MegaMinnieOutput,
} from "../types/visit-report.js";

export interface ConversationAgentResult {
  megaMinnie: MegaMinnieOutput;
  conversationAnalysis: ConversationAnalysis;
}

export async function runConversationAgent(
  rawText: string,
  context?: string,
): Promise<ConversationAgentResult> {
  if (!rawText.trim()) {
    throw new Error(
      "Geen transcript om uit te werken. Controleer je opname of probeer opnieuw.",
    );
  }

  const content = await createJsonCompletion(
    MEGAMINNIE_SYSTEM_PROMPT,
    buildConversationUserPrompt(rawText, context),
  );

  const json = normalizeMegaMinnieJson(parseJsonFromLlmResponse(content));
  const { conversationAnalysis: rawAnalysis, ...megaMinnieFields } = json as Record<
    string,
    unknown
  >;

  const parsedMegaMinnie = MegaMinnieOutputSchema.safeParse(megaMinnieFields);
  if (!parsedMegaMinnie.success) {
    throw new Error(
      `MegaMinnie-antwoord onvolledig: ${formatMegaMinnieValidationError(parsedMegaMinnie.error.issues)}`,
    );
  }

  const parsedAnalysis = ConversationAnalysisSchema.safeParse(rawAnalysis ?? {});
  const conversationAnalysis = parsedAnalysis.success
    ? parsedAnalysis.data
    : {
        topicsDiscussed: [],
        agreements: [],
        actionItems: [],
        followUpAppointment: { scheduled: false, details: "" },
        readableSummary: parsedMegaMinnie.data.summary ?? "",
      };

  return {
    megaMinnie: parsedMegaMinnie.data,
    conversationAnalysis,
  };
}
