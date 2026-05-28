import { createVisionCompletion } from "../lib/llm.js";
import { parseJsonFromLlmResponse } from "../lib/parse-llm-json.js";
import {
  formatMegaMinnieValidationError,
  normalizeMegaMinnieJson,
} from "../lib/normalize-megaminnie-output.js";
import type { PhotoInput } from "../services/vision.js";
import {
  MegaMinnieOutputSchema,
  type MegaMinnieOutput,
} from "../types/visit-report.js";

const PHOTO_SYSTEM_PROMPT = `Je bent MegaMinnie, assistent voor B2B-sales na klantbezoeken.

Je krijgt foto('s) van bezoeknotities (handschrift, whiteboard, briefje).

Taken in één stap:
1. Lees alle foto's en begrijp het bezoek/gesprek.
2. Werk in salesforceNote een professioneel, uitgeschreven bezoekverslag uit — geen kale bullet-kopie van de foto. Zet steekwoorden om in lopende tekst en alinea's.
3. Vul sourceText: letterlijke/weergave-getrouwe transcriptie van wat op de foto staat (bullets mag hier wel, ter controle door sales).

Verschil sourceText vs salesforceNote.body:
- sourceText = wat er op de foto staat (ruw)
- salesforceNote.body = uitgewerkt verslag van het gesprek voor Salesforce

Notitie body-structuur (salesforceNote):
- Bezoek, Aanwezig, Doel bezoek, Besproken punten (uitgewerkt!), Klantbehoeften, Afspraken & vervolg, Interne actiepunten
- Elke sectie: **kop dikgedrukt** op een eigen regel (met dubbele punt), toelichting direct op de regel(s) eronder; één lege regel tussen secties, geen lege regel tussen kop en toelichting (zelfde opmaak als bij audio)

Regels:
- Nederlands, geen verzonnen feiten. Onzeker: [?]. Onleesbaar: [onleesbaar].
- activityDate: YYYY-MM-DD. events: ISO-8601 met tijdzone.
- Lege arrays als geen taken/events.

Antwoord ALLEEN met geldig JSON:
{
  "sourceText": "...",
  "salesforceNote": { "title": "...", "body": "..." },
  "customer": { "accountName": "...", "contactName": "...", "email": "..." },
  "tasks": [...],
  "events": [...]
}
(customer alleen invullen als genoemd op de foto; geen verzonnen namen)`;

function buildPhotoUserMessage(photoCount: number, context?: string): string {
  const parts = [
    photoCount === 1
      ? "Lees deze foto en maak een uitgewerkt bezoekverslag (geen bullet-kopie in de Salesforce-notitie):"
      : `Lees deze ${photoCount} foto's (zelfde bezoek) en maak één uitgewerkt bezoekverslag (geen bullet-kopie in de Salesforce-notitie):`,
  ];
  if (context?.trim()) {
    parts.push("", "Extra context:", context.trim());
  }
  parts.push("", `Datum verwerking: ${new Date().toISOString().slice(0, 10)}`);
  return parts.join("\n");
}

export type PhotoProcessResult = {
  megaMinnie: MegaMinnieOutput;
  rawInput: string;
};

/** Foto('s) → MegaMinnie-verslag in één API-call. */
export async function runMegaMinnieFromPhotos(
  images: PhotoInput[],
  context?: string,
): Promise<PhotoProcessResult> {
  const raw = await createVisionCompletion({
    system: PHOTO_SYSTEM_PROMPT,
    userText: buildPhotoUserMessage(images.length, context),
    images,
    jsonMode: true,
  });

  const json = normalizeMegaMinnieJson(parseJsonFromLlmResponse(raw));

  const parsed = MegaMinnieOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `MegaMinnie-antwoord onvolledig: ${formatMegaMinnieValidationError(parsed.error.issues)}`,
    );
  }

  const rawInput = parsed.data.sourceText?.trim();
  if (!rawInput) {
    throw new Error(
      "Geen leesbare fototekst ter controle (sourceText ontbreekt). Probeer opnieuw of gebruik de kwaliteits-pipeline.",
    );
  }

  return { megaMinnie: parsed.data, rawInput };
}
