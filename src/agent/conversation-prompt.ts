import { MEGAMINNIE_SYSTEM_PROMPT } from "./megaminnie-prompt.js";

export const CONVERSATION_USER_PROMPT_PREFIX = `Hieronder staat het TRANSCRIPT van een vrij opgenomen klantgesprek.
Spreker 1 is de accountmanager van CCS; Spreker 2 is de klant (tenzij anders aangegeven).

Werk dit uit tot een professioneel bezoekverslag voor Salesforce.

Extraheer en verwerk:
- Besproken onderwerpen
- Gemaakte afspraken
- Openstaande actiepunten (wie doet wat)
- Of er een vervolgafspraak is afgesproken (datum/tijd indien genoemd)

Geef naast het standaard MegaMinnie JSON-schema ook deze velden mee in hetzelfde JSON-object:
- "conversationAnalysis": {
    "topicsDiscussed": ["..."],
    "agreements": ["..."],
    "actionItems": [{ "who": "accountmanager|klant|onbekend", "what": "..." }],
    "followUpAppointment": { "scheduled": true|false, "details": "..." },
    "readableSummary": "Leesbare samenvatting in lopende tekst voor het verslag"
  }

Het veld "readableSummary" is een korte, leesbare versie; "salesforceNote.body" blijft het volledige bezoekverslag.`;

export function buildConversationUserPrompt(rawText: string, context?: string): string {
  const parts = [
    CONVERSATION_USER_PROMPT_PREFIX,
    "",
    "--- TRANSCRIPT ---",
    rawText.trim(),
    "--- EINDE TRANSCRIPT ---",
  ];
  if (context?.trim()) {
    parts.push("", "Extra context van sales:", context.trim());
  }
  parts.push("", `Datum verwerking: ${new Date().toISOString().slice(0, 10)}`);
  return parts.join("\n");
}

export { MEGAMINNIE_SYSTEM_PROMPT };
