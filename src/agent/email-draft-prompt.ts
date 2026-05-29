import type { ConversationAnalysis, VisitReportSource } from "../types/visit-report.js";

export const EMAIL_DRAFT_SYSTEM_PROMPT = `Je schrijft korte, professionele Nederlandse e-mails voor accountmanagers van CCS.
De e-mail begeleidt een gespreksverslag dat als Word-bijlage wordt meegestuurd.

Regels:
- Schrijf in de ik-vorm van de accountmanager (collegiale, warme toon).
- Verwijs concreet naar wat in het gesprek is besproken (onderwerpen, afspraken, vervolgstappen).
- Noem expliciet dat het uitgewerkte gespreksverslag in de bijlage staat.
- Vraag de ontvanger het verslag te controleren en eventuele aanvullingen of correcties door te geven.
- Houd de body kort: maximaal 5–7 zinnen tussen aanhef en afsluiting.
- Sluit af met "Met vriendelijke groet," op een eigen regel. Voeg GEEN handtekening of naam toe.
- Het onderwerp begint met "Gespreksverslag - " gevolgd door een korte, herkenbare titel.
- Geen markdown, geen opsommingstekens, geen emoji's.`;

export interface EmailDraftPromptInput {
  meetingSubject: string;
  contactName?: string;
  meetingDate: string;
  summary?: string;
  conversationAnalysis?: ConversationAnalysis;
  source?: VisitReportSource;
}

function formatConversationContext(analysis: ConversationAnalysis): string {
  const parts: string[] = [];

  if (analysis.topicsDiscussed.length) {
    parts.push(`Besproken onderwerpen: ${analysis.topicsDiscussed.join("; ")}`);
  }
  if (analysis.agreements.length) {
    parts.push(`Gemaakte afspraken: ${analysis.agreements.join("; ")}`);
  }
  if (analysis.actionItems.length) {
    const items = analysis.actionItems
      .map((item) => `${item.who}: ${item.what}`)
      .join("; ");
    parts.push(`Actiepunten: ${items}`);
  }
  if (analysis.followUpAppointment.scheduled && analysis.followUpAppointment.details.trim()) {
    parts.push(`Vervolgafspraak: ${analysis.followUpAppointment.details.trim()}`);
  }
  if (analysis.readableSummary.trim()) {
    parts.push(`Samenvatting: ${analysis.readableSummary.trim()}`);
  }

  return parts.join("\n");
}

export function buildEmailDraftUserPrompt(input: EmailDraftPromptInput): string {
  const lines = [
    "Schrijf een begeleidende e-mail voor het volgende gespreksverslag.",
    "",
    `Onderwerp gesprek: ${input.meetingSubject.trim() || "Meeting"}`,
    `Datum gesprek: ${input.meetingDate}`,
  ];

  if (input.contactName?.trim()) {
    lines.push(`Contactpersoon: ${input.contactName.trim()}`);
  }
  if (input.source) {
    lines.push(`Bron: ${input.source}`);
  }
  if (input.summary?.trim()) {
    lines.push("", "Korte samenvatting uit het verslag:", input.summary.trim());
  }
  if (input.conversationAnalysis) {
    const context = formatConversationContext(input.conversationAnalysis);
    if (context) {
      lines.push("", "Context uit het gesprek:", context);
    }
  }

  lines.push(
    "",
    'Antwoord als JSON: { "subject": "...", "body": "..." }',
    "De body begint met een aanhef (Beste {naam}, of Beste,) en eindigt met Met vriendelijke groet,",
  );

  return lines.join("\n");
}
