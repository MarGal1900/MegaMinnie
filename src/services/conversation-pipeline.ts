import { runConversationAgent } from "../agent/conversation-agent.js";
import { CONVERSATION_WHISPER_PROMPT } from "../lib/conversation-whisper-prompt.js";
import { MAX_AUDIO_BYTES } from "../lib/whisper-config.js";
import { matchSalesforceFromHints } from "./salesforce-search.js";
import { salesforceEnabled, syncToSalesforce } from "./salesforce.js";
import {
  transcribeAudio,
  type TranscriptionResult,
} from "./transcription.js";
import type { VisitReportResult } from "../types/visit-report.js";

export { MAX_AUDIO_BYTES };

/** Transcribeer één audioblob met sprekerherkenning. */
export async function transcribeConversationChunk(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<TranscriptionResult> {
  return transcribeAudio(buffer, filename, mimeType, {
    diarize: true,
    prompt: CONVERSATION_WHISPER_PROMPT,
    useDomainPrompt: false,
  });
}

/** Voeg meerdere chunk-transcripten samen tot één tekst. */
export function mergeConversationTranscripts(chunks: string[]): string {
  return chunks
    .map((t, i) => {
      const trimmed = t.trim();
      if (!trimmed) return "";
      if (chunks.length === 1) return trimmed;
      return `--- Deel ${i + 1} ---\n${trimmed}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Volledige pipeline: transcript → Claude → Salesforce-koppeling. */
export async function processConversationReport(
  transcript: string,
  context?: string,
  recordId?: string,
): Promise<VisitReportResult> {
  const { megaMinnie, conversationAnalysis } = await runConversationAgent(
    transcript,
    context,
  );

  const sfRecordId = recordId?.trim() || process.env.SF_DEFAULT_WHAT_ID?.trim();
  let salesforce: VisitReportResult["salesforce"];

  if (sfRecordId) {
    salesforce = await syncToSalesforce({
      recordId: sfRecordId,
      output: megaMinnie,
    });
  } else if (!salesforceEnabled()) {
    salesforce = { taskIds: [], eventIds: [], dryRun: true };
  }

  const salesforceLink = await matchSalesforceFromHints(megaMinnie.customer);

  return {
    source: "conversation",
    rawInput: transcript,
    transcript,
    megaMinnie: {
      ...megaMinnie,
      summary: conversationAnalysis.readableSummary || megaMinnie.summary,
    },
    conversationAnalysis,
    salesforceLink,
    salesforce,
  };
}
