/**
 * Genereert docs/Voorlezen-en-mondeling-corrigeren-workflow.docx
 * Run: node scripts/build-voorlezen-workflow-docx.mjs
 */
import JSZip from "jszip";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "Voorlezen-en-mondeling-corrigeren-workflow.docx");

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** @param {string} text @param {{ bold?: boolean, size?: number, italic?: boolean }} [opts] */
function run(text, opts = {}) {
  const { bold = false, size = 22, italic = false } = opts;
  const rPr = [
    bold ? "<w:b/>" : "",
    italic ? "<w:i/>" : "",
    `<w:sz w:val="${size}"/>`,
    `<w:szCs w:val="${size}"/>`,
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    '<w:lang w:val="nl-NL"/>',
  ].join("");
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** @param {string | Array<string | { text: string, bold?: boolean }>} content @param {{ heading?: 1|2|3, bullet?: boolean, spacingAfter?: number }} [opts] */
function paragraph(content, opts = {}) {
  const { heading, bullet, spacingAfter = heading ? 120 : 80 } = opts;
  let runs = "";
  if (typeof content === "string") {
    if (heading === 1) runs = run(content, { bold: true, size: 32 });
    else if (heading === 2) runs = run(content, { bold: true, size: 26 });
    else if (heading === 3) runs = run(content, { bold: true, size: 24 });
    else runs = run(content);
  } else {
    runs = content
      .map((part) =>
        typeof part === "string" ? run(part) : run(part.text, { bold: part.bold }),
      )
      .join("");
  }
  const pPr = [
    bullet ? "<w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>" : "",
    !bullet && spacingAfter
      ? `<w:pPr><w:spacing w:after="${spacingAfter}"/></w:pPr>`
      : bullet
        ? `<w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr><w:spacing w:after="60"/></w:pPr>`
        : "",
  ].join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

function emptyLine() {
  return "<w:p/>";
}

function tableRow(cells, header = false) {
  const cellXml = cells
    .map((text) => {
      const tcPr = header ? "<w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E7E6E6\"/></w:tcPr>" : "";
      return `<w:tc>${tcPr}<w:p>${run(text, { bold: header, size: header ? 20 : 20 })}</w:p></w:tc>`;
    })
    .join("");
  return `<w:tr>${cellXml}</w:tr>`;
}

/** @param {string[]} headers @param {string[][]} rows */
function table(headers, rows) {
  const grid = `<w:tblGrid>${headers.map(() => "<w:gridCol w:w=\"4680\"/>").join("")}</w:tblGrid>`;
  const body = [tableRow(headers, true), ...rows.map((r) => tableRow(r))].join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
  </w:tblBorders></w:tblPr>${grid}${body}</w:tbl>`;
}

const sections = [
  paragraph("MegaMinnie — Workflow Voorlezen & Mondeling Corrigeren", { heading: 1 }),
  paragraph([
    { text: "Versie: ", bold: true },
    "documentatie gegenereerd op basis van de huidige implementatie (public/js/app.js, openai-speech.js, realtime-interview.js).",
  ]),
  paragraph([
    { text: "Project: ", bold: true },
    "MegaMinnie — klantverslag review na uitwerking.",
  ]),
  emptyLine(),

  paragraph("1. Doel van dit onderdeel", { heading: 2 }),
  paragraph(
    "Na het uitwerken van een verslag kan de gebruiker het rapport laten voorlezen (OpenAI TTS), tussendoor mondeling corrigeren (OpenAI Realtime), en het verslag live bijwerken via de extend-API. Er zijn twee correctiepaden: inline tijdens voorlezen en handmatig via de knop Mondeling corrigeren.",
  ),

  paragraph("2. Architectuur — drie lagen", { heading: 2 }),
  table(
    ["Laag", "Technologie", "Rol"],
    [
      ["TTS voorlezen", "openai-speech.js (OpenAI Speech API)", "Leest het verslag chunk voor chunk voor"],
      [
        "Inline luisteren",
        "reviewInlineListenController (Realtime WebRTC, listen-only)",
        "Transcriptie tijdens voorlezen; geen assistent-antwoord",
      ],
      [
        "Handmatige correctie",
        "supplementRealtimeController (Realtime met dialoog)",
        "Knop Mondeling corrigeren wanneer niet via inline flow",
      ],
    ],
  ),
  emptyLine(),
  paragraph("Backend-endpoints:", { heading: 3 }),
  paragraph("• POST /api/realtime/session/supplement — Realtime-sessie voor supplement/correctie", {
    bullet: true,
  }),
  paragraph("• POST /api/visit-report/extend — Verslag bijwerken met supplementtekst", {
    bullet: true,
  }),

  paragraph("3. Voorbereiding van de voorleestekst", { heading: 2 }),
  paragraph("Functie buildReviewSpeechPlan() bouwt uit de UI:", { heading: 3 }),
  paragraph("• Titel → key: title", { bullet: true }),
  paragraph("• Notitie-body → per alinea: body:0, body:1, …", { bullet: true }),
  paragraph("• Taken → task:0, task:1, …", { bullet: true }),
  paragraph("• Agenda-items → event:0, event:1, …", { bullet: true }),
  paragraph(
    "Lange alinea's worden opgesplitst in zinnen-chunks (splitSpeechChunks): eerste chunk max. ~120 tekens, daarna ~320 tekens per chunk. Bij hervatten na correctie start het voorlezen opnieuw vanaf het begin van dezelfde alinea (paragraphKey), niet midden in een zin.",
  ),
  paragraph("Prefetch: de eerste twee chunks worden vooraf geladen (prefetchOpenAiSpeech) voor snellere start.", {
    heading: 3,
  }),

  paragraph("4. Workflow: start voorlezen", { heading: 2 }),
  paragraph("1. Gebruiker klikt op Voorlezen.", { bullet: true }),
  paragraph("2. runReviewPlayback() start.", { bullet: true }),
  paragraph("3. reviewInlineListenController start (passive listen-only, geen assistent-dialoog).", {
    bullet: true,
  }),
  paragraph("4. ensureReviewSpeechPlayer().playFrom() speelt alle chunks via OpenAI TTS af.", {
    bullet: true,
  }),
  paragraph("5. Microfoon blijft aan; ttsActive markeert wanneer TTS speelt (echo-bescherming).", {
    bullet: true,
  }),
  paragraph("6. Na laatste chunk: status Voorlezen klaar; inline Realtime-sessie wordt gestopt.", {
    bullet: true,
  }),

  paragraph("5. Inline correctie tijdens voorlezen", { heading: 2 }),
  paragraph("5.1 Manieren om correctie te starten", { heading: 3 }),
  table(
    ["Trigger", "Wanneer", "Gedrag"],
    [
      [
        "Correctie (spraakcommando)",
        "Altijd, ook tijdens TTS",
        "Direct pauzeren + correctiemodus (handleReviewCorrectieCommand)",
      ],
      [
        "Correctie. [tekst]",
        "Gecombineerde uitspraak",
        "Pauze + rest van zin direct als correctie verwerken",
      ],
      [
        "Spontaan praten",
        "Alleen in pauze tussen chunks (geen actieve TTS)",
        "VAD speech_started → 450 ms bevestiging → correctiemodus",
      ],
    ],
  ),
  emptyLine(),
  paragraph("5.2 Stappen in correctiemodus", { heading: 3 }),
  paragraph("1. captureReviewPlaybackForCorrection() — TTS pauzeert; resumeIndex + paragraphKey worden opgeslagen.", {
    bullet: true,
  }),
  paragraph("2. beginInlineCorrection() — Realtime-sessie blijft open (geen stop/restart).", {
    bullet: true,
  }),
  paragraph("3. Spraak → segments[] → debounce 450 ms → flushInlineCorrection().", { bullet: true }),
  paragraph("4. POST /api/visit-report/extend — verslagvelden in UI worden live bijgewerkt.", {
    bullet: true,
  }),
  paragraph("5. Einde correctie → hervatten vanaf alineastart.", { bullet: true }),

  paragraph("5.3 Einde correctie / hervatten", { heading: 3 }),
  table(
    ["Actie", "Gedrag"],
    [
      ['Spraakcommando "Voorlezen"', "Direct finaliseren + hervatten vanaf alineastart"],
      ["Stilte ~5,5 s (met correctietekst)", "Automatisch finaliseren + hervatten"],
      ["Valse trigger zonder tekst", "Automatisch hervatten na ~1,2 s"],
      ["Knop Mondeling corrigeren (tijdens voorlezen)", "finalizeInlineCorrectionAndResume()"],
    ],
  ),
  emptyLine(),
  paragraph("5.4 Hervatten zonder sessie te beëindigen", { heading: 3 }),
  paragraph(
    "Eerst resumeReviewPlaybackInPlace(): dezelfde TTS-loop blijft actief via resumeAfterCorrection() in openai-speech.js.",
  ),
  paragraph(
    "Als dat faalt: abortReviewPlaybackLoop() + resumeReviewPlaybackAfterCorrection() start een nieuwe playFrom()-lus vanaf de alineastart.",
  ),

  paragraph("6. Spraakcommando's", { heading: 2 }),
  paragraph("Herkenning via interview-commands.js (detectReviewVoiceCommand):", { heading: 3 }),
  table(
    ["Commando", "Voorbeelden", "Effect"],
    [
      ["Correctie", "correctie, Correctie., Correctie. De datum moet…", "Start correctie; commando wordt uit tekst gestript"],
      ["Voorlezen", "voorlezen, voor lezen", "Stop correctie; hervat voorlezen"],
    ],
  ),
  emptyLine(),
  paragraph(
    "Inhoudelijke zinnen met het woord correctie (bijv. de correctie staat in alinea twee) worden niet als commando gezien.",
  ),

  paragraph("7. Handmatige correctie (knop)", { heading: 2 }),
  paragraph("Wanneer niet via inline luisteren:", { heading: 3 }),
  paragraph("1. Knop Mondeling corrigeren.", { bullet: true }),
  paragraph("2. supplementRealtimeController start met assistent-dialoog.", { bullet: true }),
  paragraph('3. Assistent vraagt: "Wat wil je corrigeren of aanvullen?"', { bullet: true }),
  paragraph("4. Knop opnieuw = Stoppen & verwerken → processSupplement().", { bullet: true }),
  paragraph("5. Verslag wordt bijgewerkt; optioneel hervatten van voorlezen als dat gepauzeerd was.", {
    bullet: true,
  }),
  paragraph(
    "Tijdens actief voorlezen + inline listen: de knop toont info Spreek je correctie in — MegaMinnie luistert mee. De inline flow heeft dan voorrang.",
  ),

  paragraph("8. Beveiligingen tegen valse triggers", { heading: 2 }),
  table(
    ["Mechanisme", "Doel"],
    [
      ["ttsActive → geen VAD-interrupt", "Echo van TTS triggert geen pauze"],
      ["interruptConfirmTimer 450 ms", "Korte ruis start pas na bevestiging"],
      ["cancelPendingSpeechInterrupt()", "Valse pauze ongedaan maken"],
      ["Geen willekeurige pendingText als correctie", "Alleen expliciet Correctie-commando"],
      ["enteredViaCommand", 'Na "Correctie" niet meteen auto-hervatten bij korte stilte'],
      ["ensureReviewInlineListen() bij disconnect", "Realtime-sessie herstellen tijdens voorlezen"],
    ],
  ),

  paragraph("9. Belangrijke timers", { heading: 2 }),
  table(
    ["Constante", "Waarde", "Gebruik"],
    [
      ["INLINE_INTERRUPT_CONFIRM_MS", "450 ms", "Bevestiging VAD-onderbreking"],
      ["INLINE_CORRECTION_RESUME_MS", "5500 ms", "Auto-hervatten na correctie met inhoud"],
      ["INLINE_CORRECTION_EMPTY_RESUME_MS", "1200 ms", "Auto-hervatten na valse lege correctie"],
      ["Debounce extend", "450 ms", "Live tekst bijwerken naar /extend"],
    ],
  ),

  paragraph("10. Statusregels voor de gebruiker", { heading: 2 }),
  paragraph(
    'Tijdens voorlezen: Zeg "Correctie" of spreek om te corrigeren — "Voorlezen" om verder te lezen.',
  ),
  paragraph("Tijdens correctie o.a.:", { heading: 3 }),
  paragraph("• Corrigeren — spreek je aanpassing in…", { bullet: true }),
  paragraph("• Tekst bijwerken…", { bullet: true }),
  paragraph('• Luistert — spreek verder of zeg "Voorlezen"', { bullet: true }),

  paragraph("11. Relevante bronbestanden", { heading: 2 }),
  table(
    ["Bestand", "Rol"],
    [
      ["public/js/app.js", "Voorlezen, inline correctie, spraakcommando's, UI"],
      ["public/js/openai-speech.js", "TTS playback, prefetch, resumeAfterCorrection"],
      ["public/js/realtime-interview.js", "WebRTC Realtime, passive listen, transcriptie"],
      ["public/js/interview-commands.js", "Correctie / Voorlezen herkenning"],
      ["src/routes/realtime.ts", "Realtime session endpoints"],
      ["src/lib/realtime-config.ts", "SUPPLEMENT_REALTIME_INSTRUCTIONS"],
    ],
  ),

  paragraph("12. Samenvatting", { heading: 2 }),
  paragraph(
    "MegaMinnie leest het verslag voor via OpenAI TTS, luistert tegelijk passief mee via Realtime, past het verslag live aan via /api/visit-report/extend wanneer de gebruiker corrigeert, en hervat het voorlezen vanaf dezelfde alinea — gestuurd door Correctie, spontaan praten in pauzes, of Voorlezen, met echo-bescherming tijdens actieve TTS.",
  ),
];

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${sections.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>MegaMinnie — Workflow Voorlezen &amp; Mondeling Corrigeren</dc:title>
  <dc:creator>MegaMinnie</dc:creator>
  <dc:description>Technische workflowdocumentatie voor voorlezen en mondeling corrigeren</dc:description>
  <dc:language>nl-NL</dc:language>
</cp:coreProperties>`;

const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>MegaMinnie</Application>
</Properties>`;

const zip = new JSZip();
zip.file("[Content_Types].xml", contentTypesXml);
zip.folder("_rels")?.file(".rels", relsXml);
zip.folder("word")?.file("document.xml", documentXml);
zip.folder("word")?.folder("_rels")?.file("document.xml.rels", documentRelsXml);
zip.folder("word")?.file("numbering.xml", numberingXml);
zip.folder("docProps")?.file("core.xml", coreXml);
zip.folder("docProps")?.file("app.xml", appXml);

const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(OUT, buffer);
console.log(`Geschreven: ${OUT}`);
