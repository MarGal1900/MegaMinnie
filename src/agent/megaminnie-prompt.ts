export const MEGAMINNIE_SYSTEM_PROMPT = `Je bent MegaMinnie, assistent voor B2B-sales na klantbezoeken.

Je krijgt ruwe input: transcript, gesproken tekst of korte aantekeningen van een foto (bullets, steekwoorden, handschrift).

Belangrijk — dit is GEEN letterlijke kopie:
- Werk het gesprek/bezoek uit tot een professioneel, leesbaar verslag alsof sales het zelf heeft geschreven na het bezoek.
- Zet losse bullets en steekwoorden om in lopende tekst en duidelijke alinea's; vul logisch in wat tussen de regels hoort (zonder nieuwe feiten te verzinnen).
- Beschrijf verloop, context, standpunten van de klant, jouw reactie/voorstel en waar het gesprek naartoe ging.
- Gebruik geen lange lijstjes met alleen hetzelfde woordgebruik als op het briefje — schrijf een echt verslag.

Doel:
1. Maak een professionele Salesforce-notitie (Nederlands), klaar om te plakken of te synchroniseren.
2. Stel alleen taken en agenda-items voor die expliciet of logisch uit het verslag volgen. Geen taken verzinnen.

Notitie-structuur in body (platte tekst, geen markdown — geen ** of #):
- Elke sectie: **kop dikgedrukt** op een eigen regel (eindigt met dubbele punt), daaronder direct de toelichting op de volgende regel(s). Eén lege regel tussen secties; geen lege regel tussen kop en toelichting.
- Voorbeeld:
  **Doel bezoek:**
  kort doel in volledige zinnen

  **Besproken punten:**
  uitgewerkt verslag van het gesprek (meerdere alinea's mogen onder dezelfde kop)
- Secties (in deze volgorde waar van toepassing):
  Bezoek – datum/tijd indien bekend, locatie
  Aanwezig – namen/rollen
  Doel bezoek – kort, in volledige zinnen
  Besproken punten – uitgewerkt verslag van het gesprek (bij meerdere alinea's: alleen de eerste zin op de kopregel; vervolgalinea's op nieuwe regels zonder kop te herhalen)
  Klantbehoeften / pijnpunten – samengevat en toegelicht
  Afspraken & vervolg – concreet wat is afgesproken
  Interne actiepunten – wat sales verder moet doen

Regels:
- Onzekerheden markeer met [?] of "niet genoemd".
- Geen verzonnen prijzen, contracten of namen.
- activityDate voor taken: ISO-datum YYYY-MM-DD (vandaag of logische vervolgdatum).
- Voor elke taak: veld "assignee" met de verantwoordelijke (standaard "Accountmanager" tenzij in het verslag iemand anders is genoemd).
- events: ISO-8601 met tijdzone (bijv. 2026-05-20T14:00:00+02:00).
- Taakduur events: minimaal 30 min tenzij anders genoemd.
- Lege arrays als er geen taken of afspraken zijn.

Klant voor Salesforce (veld "customer", alleen invullen als genoemd in het verslag):
- accountName: bedrijfs-/organisatienaam
- contactName: naam contactpersoon
- email, phone: alleen als expliciet genoemd
- opportunityName: deal/projectnaam indien genoemd
- Geen verzonnen namen; weglaten als onbekend.

Antwoord ALLEEN met één JSON-object (geen markdown, geen \`\`\`json, geen tekst ervoor of erna).

Verplicht schema:
{
  "salesforceNote": { "title": "...", "body": "..." },
  "customer": { "accountName": "...", "contactName": "...", "email": "..." },
  "tasks": [{ "subject": "...", "description": "...", "activityDate": "YYYY-MM-DD", "assignee": "Accountmanager" }],
  "events": []
}`;

export function buildUserPrompt(
  rawText: string,
  context?: string,
  source?: "voice" | "photo" | "interview" | "conversation" | "correction" | "task" | "event",
): string {
  const intro =
    source === "conversation"
      ? "Hieronder staat het TRANSCRIPT van een vrij opgenomen klantgesprek (accountmanager + klant). Werk dit uit tot een volledig bezoekverslag voor Salesforce — geen kale bullet-kopie, wel een echt verslag:"
      : source === "interview"
      ? "Hieronder staan de antwoorden uit een gestructureerd interview (per vraag een antwoord). Werk dit uit tot één professioneel bezoekverslag voor Salesforce — geen kale bullet-kopie, wel een echt verslag. Gebruik alleen feiten uit de antwoorden:"
      : source === "voice"
        ? "Hieronder staat het TRANSCRIPT van een gesproken opname (geen foto, geen handschrift). Werk uit wat er gezegd is tot een volledig bezoekverslag voor Salesforce — geen kale bullet-kopie, wel een echt verslag:"
        : source === "photo"
          ? "Hieronder staat tekst die uit bezoekfoto's is gelezen (handschrift/whiteboard). Werk dit uit tot een volledig bezoekverslag voor Salesforce (geen letterlijke bullet-lijst overnemen):"
          : "Hieronder staan ruwe aantekeningen of een transcript. Werk dit uit tot een volledig bezoekverslag voor Salesforce (geen letterlijke bullet-lijst overnemen):";

  const parts = [intro, "", "---", rawText.trim(), "---"];
  if (context?.trim()) {
    parts.push("", "Extra context van sales:", context.trim());
  }
  parts.push("", `Datum verwerking: ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`);
  return parts.join("\n");
}

export function buildExtendUserPrompt(
  existing: {
    title: string;
    body: string;
    tasks: { subject: string; description?: string; activityDate: string; assignee?: string }[];
    events: { subject: string; startDateTime: string; endDateTime: string }[];
  },
  supplementRawText: string,
  supplementSource: "voice" | "photo" | "interview" | "conversation" | "correction" | "task" | "event",
): string {
  if (supplementSource === "correction") {
    // Gesproken correctie-instructie: pas alleen de specifieke aanpassing toe, voeg niets toe.
    return [
      "Je past een BESTAAND bezoekverslag aan op basis van een gesproken correctie-instructie.",
      "STRIKTE REGELS:",
      "- Voer ALLEEN de specifieke correctie uit die in de instructie staat.",
      "- Voeg GEEN nieuwe zinnen, alinea's of informatie toe aan het verslag.",
      "- Schrijf NIET 'de datum werd gecorrigeerd' of soortgelijke metabeschrijvingen.",
      "- Verander alleen het betreffende veld of de betreffende waarde — niets meer.",
      "- Laat alle andere tekst ongewijzigd.",
      "",
      "--- BESTAAND VERSLAG (titel + body) ---",
      `Titel: ${existing.title}`,
      "",
      existing.body.trim(),
      "--- EINDE BESTAAND VERSLAG ---",
      "",
      "--- CORRECTIE-INSTRUCTIE (gesproken door gebruiker) ---",
      supplementRawText.trim(),
      "--- EINDE INSTRUCTIE ---",
      "",
      "Bestaande taken (JSON):",
      JSON.stringify(existing.tasks, null, 2),
      "",
      "Bestaande agenda-items (JSON):",
      JSON.stringify(existing.events, null, 2),
      "",
      `Datum: ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`,
    ].join("\n");
  }

  if (supplementSource === "task") {
    return [
      "Je voegt een taak toe aan een BESTAAND bezoekverslag op basis van een gesproken instructie.",
      "STRIKTE REGELS:",
      "- Voeg ALLEEN de nieuwe taak toe die in de instructie staat.",
      "- Wijzig salesforceNote title/body NIET.",
      "- Wijzig bestaande agenda-items NIET.",
      "- Verwijder geen bestaande taken.",
      "- Vul logische datum (activityDate, YYYY-MM-DD) en assignee in (standaard Accountmanager).",
      "",
      "--- BESTAAND VERSLAG (titel + body) ---",
      `Titel: ${existing.title}`,
      "",
      existing.body.trim(),
      "--- EINDE BESTAAND VERSLAG ---",
      "",
      "--- TAAK-INSTRUCTIE (gesproken door gebruiker) ---",
      supplementRawText.trim(),
      "--- EINDE INSTRUCTIE ---",
      "",
      "Bestaande taken (JSON):",
      JSON.stringify(existing.tasks, null, 2),
      "",
      "Bestaande agenda-items (JSON):",
      JSON.stringify(existing.events, null, 2),
      "",
      `Datum: ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`,
    ].join("\n");
  }

  if (supplementSource === "event") {
    return [
      "Je voegt een agenda-item toe aan een BESTAAND bezoekverslag op basis van een gesproken instructie.",
      "STRIKTE REGELS:",
      "- Voeg ALLEEN het nieuwe agenda-item toe dat in de instructie staat.",
      "- Wijzig salesforceNote title/body NIET.",
      "- Wijzig bestaande taken NIET.",
      "- Verwijder geen bestaande agenda-items.",
      "- Vul startDateTime en endDateTime in als ISO-8601 met tijdzone; minimaal 30 minuten tenzij anders genoemd.",
      "",
      "--- BESTAAND VERSLAG (titel + body) ---",
      `Titel: ${existing.title}`,
      "",
      existing.body.trim(),
      "--- EINDE BESTAAND VERSLAG ---",
      "",
      "--- AGENDA-INSTRUCTIE (gesproken door gebruiker) ---",
      supplementRawText.trim(),
      "--- EINDE INSTRUCTIE ---",
      "",
      "Bestaande taken (JSON):",
      JSON.stringify(existing.tasks, null, 2),
      "",
      "Bestaande agenda-items (JSON):",
      JSON.stringify(existing.events, null, 2),
      "",
      `Datum: ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`,
    ].join("\n");
  }

  const supplementLabel =
    supplementSource === "voice" || supplementSource === "conversation"
      ? "TRANSCRIPT van een extra gesproken opname"
      : "tekst uit extra bezoekfoto('s)";

  return [
    "Je werkt een BESTAAND bezoekverslag BIJ met nieuwe aanvullende input.",
    "Regels:",
    "- Verwerk alle nieuwe feiten in het bestaande verslag; vul aan en pas aan waar nodig.",
    "- Verwijder geen bestaande informatie, tenzij de nieuwe input die expliciet corrigeert.",
    "- Behoud de notitie-structuur (Bezoek, Aanwezig, Besproken punten, enz.).",
    "- Taken en events: voeg nieuwe toe, werk bestaande bij waar logisch; geen dubbele taken.",
    "- Geen verzonnen feiten.",
    "",
    "--- BESTAAND VERSLAG (titel + body) ---",
    `Titel: ${existing.title}`,
    "",
    existing.body.trim(),
    "--- EINDE BESTAAND VERSLAG ---",
    "",
    `--- NIEUWE AANVULLING (${supplementLabel}) ---`,
    supplementRawText.trim(),
    "--- EINDE AANVULLING ---",
    "",
    "Bestaande taken (JSON):",
    JSON.stringify(existing.tasks, null, 2),
    "",
    "Bestaande agenda-items (JSON):",
    JSON.stringify(existing.events, null, 2),
    "",
    `Datum bijwerking: ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`,
  ].join("\n");
}
