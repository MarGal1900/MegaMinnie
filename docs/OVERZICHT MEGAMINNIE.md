# MegaMinnie — uitgebreide beschrijving

## Wat is MegaMinnie?

**MegaMinnie** is een Nederlandstalige webapplicatie voor B2B-sales. De tagline in de interface zegt het kernachtig: **Bezoekverslag → Salesforce**.

Na een klantbezoek heb je meestal ruwe input: een foto van een whiteboard, een voice memo, losse bullets, een Word-document of alleen wat je nog in je hoofd hebt. MegaMinnie zet die input om in een **gestructureerd, professioneel bezoekverslag** met bijbehorende **Salesforce-notitie**, **taken** en **agenda-items**. Daarna kun je alles controleren, aanvullen en — als je wilt — direct naar Salesforce synchroniseren.

MegaMinnie is geen generieke chatbot, maar een **doelgerichte sales-assistent** met vaste outputstructuur, domeinkennis in de prompts, en integratie met CRM en transcriptie.

---

## Doel en probleem dat het oplost

Sales na een bezoek moet vaak:

1. Een leesbaar verslag schrijven
2. Actiepunten vastleggen
3. Vervolgafspraken inplannen
4. Alles netjes in Salesforce zetten

Dat kost tijd, gebeurt soms pas uren later (met verlies van detail), en leidt tot inconsistente notities.

MegaMinnie **verkort die keten**: je levert ruwe input aan, de AI werkt het uit tot een professioneel verslag, en jij doet alleen nog een **controle** voordat het naar Salesforce gaat. Het doel is niet letterlijk kopiëren, maar **uitwerken** — bullets worden alinea's, context wordt ingevuld, en onzekerheden worden gemarkeerd zonder verzonnen feiten.

---

## Doelgroep en gebruikssituatie

MegaMinnie is bedoeld voor **accountmanagers en salesmedewerkers** die klantbezoeken doen en Salesforce als CRM gebruiken. Typische situaties:

- Direct na het gesprek in de auto of op kantoor
- Met alleen een foto van handschrift of whiteboard
- Tijdens of na een lang klantgesprek via vrije opname
- Wanneer je liever **hardop antwoordt** op gestructureerde vragen dan zelf typt

De hele UI, prompts en gegenereerde output zijn **Nederlands**.

---

## De workflow in vier stappen

De app volgt een vaste workflow, zichtbaar als tijdlijn bovenaan:

| Stap | Wat gebeurt er |
|------|----------------|
| **1. Invoer toevoegen** | Foto, audio, tekst, document, gespreksopname of interview |
| **2. Laat MegaMinnie uitwerken** | Transcriptie, OCR/vision, LLM-verwerking |
| **3. Controle** | Titel, body, taken en events bewerken; optioneel voorlezen en mondeling corrigeren |
| **4. Upload naar Salesforce** | ContentNote + Tasks + Events koppelen aan een Account/Contact/Opportunity |

Bij eerste gebruik is er een **onboarding-rondleiding** die deze stappen uitlegt.

---

## Invoermethoden

MegaMinnie ondersteunt **zes invoerpaden** (plus aanvullingen op een bestaand concept):

### 1. Bestanden slepen of kiezen

Via de dropzone kun je uploaden:

- **Foto's** (handschrift, whiteboard, notities) — meerdere tegelijk
- **Audio** (voice memo, opname)
- **Tekst** (.txt, .md)
- **Word** (.docx) en **PDF**

### 2. Opname gesprek

Vrije **gespreksopname** tijdens de klantafspraak. De opname wordt in chunks getranscribeerd (met optionele **sprekerherkenning/diarization** in cloud-modus). Daarna analyseert MegaMinnie het gesprek tot een volledig verslag.

### 3. Vraag & Antwoord (gestructureerd interview)

MegaMinnie stelt **zes vaste vragen**:

1. Wat is het onderwerp van de afspraak geweest?
2. Op welke datum en tijdstip was dit?
3. Met wie heb je gesproken?
4. Wat is er besproken?
5. Zijn er nog actiepunten?
6. Wat is er besproken met betrekking tot het vervolg?

Je antwoordt **hardop**. MegaMinnie spreekt de vragen voor (TTS) en herkent stemcommando's zoals **"volgende vraag"** en **"einde verslag"**.

Er is ook een **Realtime Interview**-modus (OpenAI Realtime via WebRTC): een natuurlijk vraag-en-antwoordgesprek in plaats van het vaste zes-vragen-schema. Schakel in via `REALTIME_INTERVIEW_ENABLED=true` in `.env`.

### 4. Handmatige invoer

Typ of plak bezoeknotities direct in een tekstveld.

### 5. Audio-opname (klassiek)

Losse microfoonopname die na afloop wordt getranscribeerd en verwerkt.

### 6. Documentextractie

Word/PDF wordt server-side naar tekst geconverteerd en daarna verwerkt.

### Aanvullen na uitwerking

Op het controlepaneel kun je het concept **uitbreiden** met:

- Extra **foto**
- Extra **audio-opname**
- **Mondelinge correctie** (alleen de genoemde wijziging, geen herschrijving)

---

## Wat MegaMinnie genereert (output)

De LLM-agent levert gestructureerd JSON met:

### Salesforce-notitie

- **Titel** en **body** in professioneel Nederlands
- Vaste secties waar van toepassing: Bezoek, Aanwezig, Doel bezoek, Besproken punten, Klantbehoeften/pijnpunten, Afspraken & vervolg, Interne actiepunten
- Platte tekst (geen markdown); sectiekoppen vetgedrukt op eigen regel

### Taken (Tasks)

- Onderwerp, beschrijving, deadline (`activityDate`)
- Prioriteit en status
- Verantwoordelijke (`assignee`, standaard "Accountmanager")

### Agenda-items (Events)

- Onderwerp, beschrijving, start/eind (ISO-8601 met tijdzone)
- Optionele locatie
- Minimale duur 30 minuten tenzij anders genoemd

### Klanthints voor Salesforce-koppeling

- Accountnaam, contactnaam, e-mail, telefoon, opportunitynaam — **alleen als expliciet genoemd**

### Optioneel

- `summary` — korte samenvatting
- `sourceText` — ruwe tekst uit foto's (voor controle)
- `conversationAnalysis` — bij vrije gespreksopname: onderwerpen, afspraken, actiepunten, follow-up

---

## Controle- en reviewfunctionaliteit

Na uitwerking verschijnt het **controlepaneel** met bewerkbare velden:

- **Titel en body** — direct inline bewerkbaar
- **Taken en events** — kaarten met velden; handmatig toevoegen via "Taak toevoegen" / "Agenda toevoegen"
- **Voorlezen** — het verslag wordt hardop voorgelezen (OpenAI Speech API)
- **Spraakcommando's** — wake phrase **"Ok MegaMinnie"** / **"Ok Minnie"**, daarna commando's zoals voorlezen, taak/agenda aanmaken, correctie, stoppen
- **Mondeling corrigeren** — gesproken instructie; alleen het betreffende veld wordt aangepast
- **Foto verwerken** — extra foto toevoegen aan het concept
- **Verwijderen** — concept wissen

Spraakcommando's worden eerst **rule-based** herkend (snel, betrouwbaar voor vaste frases) en anders via een **LLM-intent-classifier** op de backend (`READ_REPORT`, `CREATE_TASK`, `CREATE_EVENT`, `CORRECTION`, `STOP`).

---

## Salesforce-integratie

MegaMinnie koppelt aan Salesforce via een **Connected App** en OAuth (jsforce). Uitgebreide setup: [SALESFORCE.md](./SALESFORCE.md).

### Automatische koppeling

Op basis van klanthints uit het verslag zoekt MegaMinnie in Salesforce naar **Accounts**, **Contacts** en **Opportunities** (SOQL) en toont **suggesties**.

### Handmatig zoeken

Je kunt ook zelf zoeken en een record selecteren.

### Synchronisatie

Bij upload worden aangemaakt:

- **ContentNote** — gekoppeld aan het gekozen record via ContentDocumentLink
- **Tasks** — gekoppeld aan hetzelfde record
- **Events** — agenda-items

Met `SF_DEFAULT_WHAT_ID` kan automatisch gesynchroniseerd worden bij verwerking (zonder aparte sync-knop).

### Preview-modus (standaard)

`MEGAMINNIE_DRY_RUN=true`: volledige pipeline draait, maar **niets** wordt naar Salesforce geschreven. Handig voor ontwikkeling en testen.

---

## Delen en exporteren

- **E-mail verzenden** — opent Outlook (desktop via `mailto`, mobiel via `ms-outlook://`) met onderwerp, ontvangers (o.a. uit klant-e-mail) en handtekening
- **Word-export (gespreksverslag)** — DOCX op basis van een bedrijfstemplate (`public/templates/gespreksverslag-template.dotx`), geladen on demand

---

## AI- en technische architectuur

```
Invoer (foto, audio, tekst, interview, gesprek)
    ↓
Voorverwerking (Whisper, Vision/OCR, documentextractie)
    ↓
MegaMinnie Agent (LLM: Claude of OpenAI → normalisatie + Zod-validatie)
    ↓
Output (controle-UI, Salesforce sync, e-mail/DOCX)
```

### Backend (Node.js / Express / TypeScript)

- Routes onder `/api/visit-report/*` voor voice, photo, text, document, conversation, interview, extend, sync
- `/api/realtime/*` — Realtime-sessies voor interview en voorlezen
- `/api/voice/*` — intent-classificatie voor spraakcommando's
- Gedeelde pipeline in `src/services/visit-report-pipeline.ts`

### LLM-providers

- **Anthropic Claude** (aanbevolen, standaard als `ANTHROPIC_API_KEY` gezet)
- **OpenAI** als alternatief (`LLM_PROVIDER=openai`)
- Apart vision-model voor foto's

### Transcriptie (Whisper)

- **Lokaal**: faster-whisper via Docker (poort 8000) — goed combineerbaar met Claude
- **Cloud**: OpenAI (`gpt-4o-mini-transcribe`, profiel `quality` / `fast` / `diarize`)

### Foto-pipeline

- **`quality`**: OCR/vision → tekst → MegaMinnie (twee stappen, nauwkeuriger)
- **`fast`**: direct vision → gestructureerde output (één API-call, alleen OpenAI-pad)

### Frontend

- Single-page app zonder framework: `public/js/app.js` als controller, ES modules
- Modules o.a. voor realtime-interview, interview-commando's, voice-router, tasks/events, DOCX-export
- **PWA**: `public/manifest.json`, service worker, installeerbaar op mobiel

Zie ook [CLAUDE.md](../CLAUDE.md) en [README.md](../README.md) voor ontwikkelcommando's en mapstructuur.

---

## Beveiliging en deployment

- Standaard luistert de server op **127.0.0.1**
- Optionele **API-key** (`MEGAMINNIE_API_KEY` + header `X-API-Key`)
- **Rate limiting** op uploads (standaard 30/min per IP)
- Microfoon/camera via Permissions-Policy
- HTTPS vereist voor microfoon buiten localhost
- Deploy via **Docker**, **Vercel** (serverless Express), of klassiek `npm run build && npm start`

---

## Testmodus en ontwikkelaarsfeatures

- **Testmodus** (UI-knop): bewaart opnames en foto's in een lokale bibliotheek (IndexedDB) voor hergebruik
- **Rondleiding opnieuw** — reset onboarding
- Health-endpoint `/health` — status LLM, Whisper, Salesforce
- Uitgebreide **Vitest**-tests in `tests/`

---

## Samenvatting in één zin

**MegaMinnie is een AI-gestuurde sales-assistent die na een B2B-klantbezoek elke denkbare ruwe input — van whiteboardfoto tot live gesprek — omzet in een professioneel Nederlands verslag met taken en afspraken, controleerbaar via spraak en tekst, en uploadbaar naar Salesforce.**
