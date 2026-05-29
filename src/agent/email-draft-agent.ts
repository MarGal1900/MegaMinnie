import {
  buildEmailDraftUserPrompt,
  EMAIL_DRAFT_SYSTEM_PROMPT,
  type EmailDraftPromptInput,
} from "./email-draft-prompt.js";
import { createJsonCompletion } from "../lib/llm.js";
import { parseJsonFromLlmResponse } from "../lib/parse-llm-json.js";
import { EmailDraftSchema, type EmailDraft } from "../types/visit-report.js";

export async function runEmailDraftAgent(input: EmailDraftPromptInput): Promise<EmailDraft> {
  const content = await createJsonCompletion(
    EMAIL_DRAFT_SYSTEM_PROMPT,
    buildEmailDraftUserPrompt(input),
  );

  const parsed = EmailDraftSchema.safeParse(parseJsonFromLlmResponse(content));
  if (!parsed.success) {
    throw new Error(
      `E-mailconcept onvolledig: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  return parsed.data;
}
