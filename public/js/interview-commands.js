const CYRILLIC_TO_LATIN = {
  "стоп": "stop",
  "аннулируй": "annuleer",
  "аннулирую": "annuleer",
  "следующий": "volgende",
  "готово": "einde verslag",
};

export function normalizeCommandText(text) {
  let t = text.toLowerCase().trim();
  for (const [cyr, lat] of Object.entries(CYRILLIC_TO_LATIN)) {
    t = t.replace(new RegExp(cyr, "g"), lat);
  }
  return t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEXT_QUESTION_COMMANDS = new Set([
  "volgende vraag",
  "volgende",
  "ga door",
  "naar de volgende vraag",
  "stel de volgende vraag",
  "next",
  "next question",
]);

const NEXT_QUESTION_COMMAND_ALT =
  "naar\\s+de\\s+volgende\\s+vraag|stel\\s+de\\s+volgende\\s+vraag|next\\s+question|volgende\\s+vraag|ga\\s+door|volgende|next";
const NEXT_QUESTION_COMMAND_AT_END_RE = new RegExp(
  `(?:^|[.!?,;:]\\s*)(?:${NEXT_QUESTION_COMMAND_ALT})[.!?,;:]*\\s*$`,
  "iu",
);

export function isNextQuestionCommand(transcript) {
  const normalized = normalizeCommandText(transcript);
  if (!normalized) return false;
  return NEXT_QUESTION_COMMANDS.has(normalized);
}

function hasTrailingNextQuestionCommand(transcript) {
  if (typeof transcript !== "string") return false;
  const text = transcript.trim();
  if (!text) return false;
  return NEXT_QUESTION_COMMAND_AT_END_RE.test(text);
}

/** @returns {"advance"|"finish"|null} */
export function detectInterviewCommand(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;

  if (isNextQuestionCommand(n)) {
    return "advance";
  }

  if (
    /\beinde\s+verslag\b/.test(n) ||
    /\bverslag\s+klaar\b/.test(n) ||
    /\bmaak\s+(het\s+)?verslag\b/.test(n) ||
    /\bverslag\s+afmaken\b/.test(n) ||
    /\bklaar\b.*\bverslag\b/.test(n) ||
    (n.includes("einde") && n.includes("verslag")) ||
    (n.includes("inde") && n.includes("verslag"))
  ) {
    return "finish";
  }
  return null;
}

/** Commando aan het eind van de zin (na je antwoord). */
export function detectInterviewCommandAtTail(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;
  const tail = n.slice(-120);

  if (
    /\beinde\s+verslag\b/.test(tail) ||
    /\bverslag\s+klaar\b/.test(tail) ||
    (tail.includes("einde") && tail.includes("verslag")) ||
    (tail.includes("klaar") && tail.includes("verslag"))
  ) {
    return "finish";
  }

  if (isNextQuestionCommand(tail) || hasTrailingNextQuestionCommand(text)) return "advance";

  return detectInterviewCommand(n);
}

const REALTIME_QA_STOP_COMMANDS = new Set(["stop", "stoppen"]);
const REALTIME_QA_CANCEL_COMMANDS = new Set(["annuleer", "annuleren", "cancel"]);

/** @param {string} text */
export function isRealtimeQaStopCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REALTIME_QA_STOP_COMMANDS.has(normalized)) return true;
  return /\b(stop|stoppen)\b/.test(normalized);
}

/** @param {string} text */
export function isRealtimeQaCancelCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REALTIME_QA_CANCEL_COMMANDS.has(normalized)) return true;
  return /\b(annuleer|annuleren|cancel)\b/.test(normalized);
}

/** @returns {"stop"|"cancel"|null} */
export function detectRealtimeQaVoiceCommand(text) {
  if (isRealtimeQaCancelCommand(text)) return "cancel";
  if (isRealtimeQaStopCommand(text)) return "stop";
  return null;
}

const REVIEW_CORRECTIE_COMMANDS = new Set(["correctie"]);
const REVIEW_VOORLEZEN_COMMANDS = new Set(["voorlezen", "voor lezen"]);
const REVIEW_STOP_COMMANDS = new Set(["stop", "stoppen"]);

/** @param {string} text */
export function isReviewStopCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REVIEW_STOP_COMMANDS.has(normalized)) return true;
  return /^(stop|stoppen)[.!?,;:]*$/.test(normalized);
}

/** @param {string} text */
export function isReviewCorrectieCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REVIEW_CORRECTIE_COMMANDS.has(normalized)) return true;
  return /^correctie[.!?,;:]*$/.test(normalized);
}

/** @param {string} text */
export function isReviewVoorlezenCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (REVIEW_VOORLEZEN_COMMANDS.has(normalized)) return true;
  return (
    /^voorlezen[.!?,;:]*$/.test(normalized) ||
    /^voor lezen[.!?,;:]*$/.test(normalized) ||
    /^lees\s+voor[.!?,;:]*$/.test(normalized)
  );
}

/** @param {string} text */
export function isStartVoorlezenCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  if (isReviewVoorlezenCommand(text)) return true;
  return (
    /^start(?:\s+het)?\s+voorlezen[.!?,;:]*$/.test(normalized) ||
    /^begin(?:\s+met)?\s+voorlezen[.!?,;:]*$/.test(normalized) ||
    /^lees(?:\s+(?:het\s+)?(?:uitgewerkte\s+)?(?:verslag|tekst))(?:\s+voor)?[.!?,;:]*$/.test(
      normalized,
    ) ||
    /^lees\s+voor(?:\s+(?:het\s+)?(?:uitgewerkte\s+)?(?:verslag|tekst))?[.!?,;:]*$/.test(
      normalized,
    ) ||
    /^graag\s+voorlezen[.!?,;:]*$/.test(normalized) ||
    /^kun\s+je\s+(?:dit|het(?:\s+uitgewerkte)?\s+(?:verslag|tekst))\s+voor(?:lezen)?[.!?,;:]*$/.test(
      normalized,
    )
  );
}

/** @param {string} text */
export function startsWithReviewCorrectieCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return /^correctie\b[.!?,;:]*\s+\S/.test(normalized);
}

/**
 * Detecteert "Correctie" aan het EINDE van een uiting, bijv. wanneer de Realtime API de
 * TTS-echo en de gebruikersstem samenvoegt: "De naam is Jan Jansen. Correctie."
 * Vereist minimaal één woord vóór "Correctie" om pure commando's (al gevangen door
 * isReviewCorrectieCommand) niet dubbel te detecteren.
 * @param {string} text
 */
export function endsWithReviewCorrectieCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return /\S\s+correctie[.!?,;:]*$/.test(normalized);
}

/**
 * Detecteert "correctie" als los woord OP WILLEKEURIGE positie in de uiting — dus ook
 * in het MIDDEN, bijv. wanneer de TTS-echo van het voorgelezen verslag zowel vóór als ná
 * het commando wordt meegevangen: "...vervolgafspraak inplannen correctie de naam klopt niet".
 * Bewust ruimer dan startsWith/endsWith hierboven. Alleen veilig te gebruiken op het moment
 * dat er nog GEEN correctie-dictee actief is (zie aanroeppunt in app.js) — anders zou dit ook
 * matchen op legitieme, door de gebruiker gedicteerde inhoud die toevallig het woord
 * "correctie" bevat (bijv. "de correctie op de polis moet ook mee").
 * @param {string} text
 */
export function containsReviewCorrectieCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return /\bcorrectie\b/.test(normalized);
}

/**
 * Normaliseert tekst voor TTS-echo-vergelijking (los van commando-normalisatie,
 * bewust geen Cyrillisch-transliteratie hier — dit is puur woord-overlap).
 * @param {string} text
 */
export function normalizeReviewSpeechEchoText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Puur herbruikbare/testbare versie van de TTS-echo-detectie. Bepaalt of `candidateText`
 * waarschijnlijk een echo is van het net voorgelezen fragment `lastSpokenChunk`
 * (bijv. wanneer de microfoon de eigen TTS-stem van de speaker/carkit oppikt).
 * @param {string} candidateText
 * @param {string} lastSpokenChunk
 */
export function isLikelyReviewSpeechEcho(candidateText, lastSpokenChunk) {
  const spoken = normalizeReviewSpeechEchoText(lastSpokenChunk);
  const candidate = normalizeReviewSpeechEchoText(candidateText);
  if (!spoken || !candidate) return false;
  if (spoken.includes(candidate) || candidate.includes(spoken)) return true;
  const spokenWords = new Set(spoken.split(" ").filter((w) => w.length > 3));
  const candidateWords = candidate.split(" ").filter((w) => w.length > 3);
  if (!candidateWords.length) return false;
  const overlap = candidateWords.filter((w) => spokenWords.has(w)).length;
  return overlap / candidateWords.length >= 0.6;
}

/**
 * Strip een herkend echo-voorvoegsel (bijv. de eigen TTS-stem van "Wat kan ik voor je doen?")
 * van het BEGIN van `candidateText` en geeft de rest terug. Nodig omdat de mic tijdens de
 * ack-bevestiging bewust AAN blijft (zie voice-command-wake.js): als de gebruiker zonder
 * duidelijke stilte meteen na de echo zijn commando uitspreekt, komt dat soms als ÉÉN
 * STT-fragment binnen ("wat kan ik voor je doen maak een agenda aan"). isLikelyReviewSpeechEcho
 * hierboven classificeert zo'n fragment als "puur echo" (de echo-tekst zit er letterlijk in),
 * waardoor het HELE fragment — inclusief het echte commando erna — werd weggegooid. Deze
 * functie strippt alleen het overeenkomende voorvoegsel; de rest blijft over als commando.
 * @param {string} candidateText
 * @param {string} lastSpokenChunk
 * @returns {string} de tekst ná het echo-voorvoegsel, of de oorspronkelijke (getrimde) tekst
 *   als er geen voorvoegsel-overeenkomst is gevonden.
 */
export function stripLeadingSpeechEcho(candidateText, lastSpokenChunk) {
  const original = String(candidateText || "").trim();
  const rawWords = original.split(/\s+/).filter(Boolean);
  const spokenWords = normalizeReviewSpeechEchoText(lastSpokenChunk)
    .split(" ")
    .filter(Boolean);
  if (!rawWords.length || !spokenWords.length) return original;

  let i = 0;
  while (
    i < rawWords.length &&
    i < spokenWords.length &&
    normalizeReviewSpeechEchoText(rawWords[i]) === spokenWords[i]
  ) {
    i++;
  }
  if (i === 0) return original;
  return rawWords.slice(i).join(" ").trim();
}

/** @param {string} text */
export function startsWithNaturalCreateTaskCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return (
    /^ik\s+wil\s+(?:dat\s+je\s+)?(?:een\s+)?taak\b/.test(normalized) ||
    /^zou\s+je\s+(?:een\s+)?taak\b/.test(normalized) ||
    /^kun\s+je\s+(?:een\s+)?taak\b/.test(normalized) ||
    /^zet\s+(?:dit\s+)?op\s+de\s+to[\s-]?do\b/.test(normalized)
  );
}

/** @param {string} text */
export function isReviewMaakTaakCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return (
    /^maak taak[.!?,;:]*$/.test(normalized) ||
    /^maak een taak aan[.!?,;:]*$/.test(normalized) ||
    /^maak een taak[.!?,;:]*$/.test(normalized)
  );
}

/** @param {string} text */
export function startsWithReviewMaakTaakCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return /^maak(?:\s+een)?\s+taak(?:\s+aan)?\b[.!?,;:]*\s+\S/.test(normalized);
}

/** @param {string} text */
export function isReviewMaakAgendaCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return (
    /^maak agenda[.!?,;:]*$/.test(normalized) ||
    /^maak een agenda aan[.!?,;:]*$/.test(normalized) ||
    /^maak een agenda[.!?,;:]*$/.test(normalized)
  );
}

/** @param {string} text */
export function startsWithReviewMaakAgendaCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return false;
  return /^maak(?:\s+een)?\s+agenda(?:\s+aan)?\b[.!?,;:]*\s+\S/.test(normalized);
}

const OK_WAKE_PREFIX_RE = /^(?:ok(?:e|ay)?)\s+(?:megaminnie|minnie)(?:[.!?,;:]+|\s|$)/;
const OK_WAKE_ONLY_RE = /^(?:ok(?:e|ay)?)\s+(?:megaminnie|minnie)[.!?,;:]*$/;

/** @param {string} text */
export function normalizeWakeCommandText(text) {
  return (
    normalizeCommandText(text)
      // STT-varianten van "ok": "okay", "oké" (accent al gestript door normalizeCommandText
      // → "oke"), "okee", en "O.K." (interpunctie al gestript → "o k"). Zonder deze
      // normalisatie viel een groot deel van de uitingen buiten de wake-regexes en moest
      // "Ok Minnie" meerdere keren gezegd worden voordat er een "schone" transcriptie
      // tussen zat — dé oorzaak van het 5-6x-roepen-probleem op het hoofdscherm.
      .replace(/\bo k\b/g, "ok")
      .replace(/\boke{1,2}\b/g, "ok")
      .replace(/\bokay\b/g, "ok")
      .replace(/\bmega\s+minni?e?\b/g, "megaminnie")
      .replace(/\bmega\s+(?:minny|minie|miny)\b/g, "megaminnie")
      .replace(/\bmegan\s+minni?e?\b/g, "megaminnie")
      .replace(/\bmega\s+mini\b/g, "megaminnie")
      .replace(/\bmegamini\b/g, "megaminnie")
      .replace(/\bmegaminny\b/g, "megaminnie")
      .replace(/\bmeganminni?e?\b/g, "megaminnie")
      .replace(/\bmegaminn(i|ie)\b/g, "megaminnie")
      // STT-varianten van "minnie" ("mini", "minny", "minni", "minie", "miny") worden alleen
      // genormaliseerd DIRECT na "ok", zodat legitieme tekst met bijv. het woord "mini"
      // ("de mini presentatie") ongemoeid blijft.
      .replace(/\bok (?:mini|minni|minny|minie|miny)\b/g, "ok minnie")
  );
}

/** @param {string} text */
export function hasOkMegaMinnieWakePrefix(text) {
  const normalized = normalizeWakeCommandText(text);
  if (!normalized) return false;
  return OK_WAKE_PREFIX_RE.test(normalized);
}

/** @param {string} text */
export function isOkMegaMinnieWakeOnly(text) {
  const normalized = normalizeWakeCommandText(text);
  if (!normalized) return false;
  return OK_WAKE_ONLY_RE.test(normalized);
}

/**
 * Verwijdert een leading "Ok MegaMinnie" / "Ok Minnie" prefix.
 * @param {string} text
 */
export function stripOkMegaMinnieWakePrefix(text) {
  const original = typeof text === "string" ? text : "";
  const normalized = normalizeWakeCommandText(original);
  if (!OK_WAKE_PREFIX_RE.test(normalized)) {
    return original.replace(/\s+/g, " ").trim();
  }
  const remainder = normalized
    .replace(OK_WAKE_PREFIX_RE, "")
    .replace(/^[.!?,;:\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return remainder;
}

/**
 * Verwijdert ALLE opeenvolgende leidende "Ok Minnie"-herhalingen, bijv. wanneer iemand het
 * ongeduldig meerdere keren zegt binnen één door VAD opgevangen uiting ("Ok Minnie. Ok
 * Minnie.") — stripOkMegaMinnieWakePrefix hierboven verwijdert er maar één, waardoor de rest
 * als (onherkenbaar) "commando" werd behandeld in plaats van als hernieuwde wake-poging.
 * @param {string} text
 */
export function stripRepeatedOkMegaMinnieWakePrefixes(text) {
  let current = String(text || "").trim();
  for (let i = 0; i < 6; i += 1) {
    if (!hasOkMegaMinnieWakePrefix(current)) break;
    const stripped = stripOkMegaMinnieWakePrefix(current);
    if (stripped === current) break;
    current = stripped;
  }
  return current;
}

/**
 * @param {string} text
 * @returns {{ wakeDetected: boolean; wakeOnly: boolean; commandText: string }}
 */
export function parseOkMegaMinnieWakeCommand(text) {
  const original = String(text || "").trim();
  if (!hasOkMegaMinnieWakePrefix(original)) {
    return { wakeDetected: false, wakeOnly: false, commandText: original };
  }
  const commandText = stripRepeatedOkMegaMinnieWakePrefixes(original);
  return {
    wakeDetected: true,
    wakeOnly: commandText === "" || isOkMegaMinnieWakeOnly(original),
    commandText,
  };
}

const OK_WAKE_ANYWHERE_RE = /\b(?:ok(?:e|ay)?)\s+(?:megaminnie|minnie)\b/;

/**
 * Detecteert "Ok MegaMinnie" / "Ok Minnie" OP WILLEKEURIGE positie in de uiting — dus ook
 * wanneer de TTS-echo van het voorgelezen verslag ervoor staat, bijv.
 * "...vervolgafspraak inplannen ok minnie". hasOkMegaMinnieWakePrefix hierboven vereist dat
 * het wake-woord aan het BEGIN staat, wat tijdens voorlezen vaak niet het geval is als de
 * eigen speaker-echo wordt meegevangen — precies dezelfde reden dat "Correctie" soms herhaald
 * moest worden (zie containsReviewCorrectieCommand). Alleen bedoeld als fallback tijdens
 * playback; geen vervanging van de striktere prefix-checks voor het algemene geval.
 * @param {string} text
 */
export function containsOkMegaMinnieWake(text) {
  const normalized = normalizeWakeCommandText(text);
  if (!normalized) return false;
  return OK_WAKE_ANYWHERE_RE.test(normalized);
}

/**
 * Vindt "Ok MegaMinnie" / "Ok Minnie" op WILLEKEURIGE positie in de uiting en geeft de tekst
 * NA het wake-woord terug als commandotekst. Nodig voor het idle-/hoofdschermgeval: als de
 * VAD ruis of een aarzeling vóór het wake-woord meevangt ("eh, ok minnie"), matchte de
 * ^-anchored prefix-check niet en werd de hele uiting genegeerd — óók een oorzaak van het
 * meerdere-keren-roepen-probleem. Herhaalde wakes in de rest ("ok minnie ok minnie") worden
 * volledig weggestript. De teruggegeven commandText is genormaliseerd (lowercase, zonder
 * interpunctie) — alle commandodetectors normaliseren zelf ook, dus dat is verenigbaar.
 * @param {string} text
 * @returns {{ wakeDetected: boolean; wakeOnly: boolean; commandText: string }}
 */
export function extractOkMegaMinnieWakeAnywhere(text) {
  const original = String(text || "").trim();
  const normalized = normalizeWakeCommandText(original);
  if (!normalized) return { wakeDetected: false, wakeOnly: false, commandText: original };
  const match = OK_WAKE_ANYWHERE_RE.exec(normalized);
  if (!match) return { wakeDetected: false, wakeOnly: false, commandText: original };
  const afterWake = normalized.slice(match.index + match[0].length).trim();
  const commandText = stripRepeatedOkMegaMinnieWakePrefixes(afterWake);
  return {
    wakeDetected: true,
    wakeOnly: commandText === "",
    commandText,
  };
}

/** @returns {"correctie"|"voorlezen"|"stop"|"maak_taak"|"maak_agenda"|null} */
export function detectReviewVoiceCommand(text) {
  if (isStartVoorlezenCommand(text) || isReviewVoorlezenCommand(text)) return "voorlezen";
  if (isReviewMaakTaakCommand(text)) return "maak_taak";
  if (startsWithReviewMaakTaakCommand(text) || startsWithNaturalCreateTaskCommand(text)) {
    return "maak_taak";
  }
  if (isReviewMaakAgendaCommand(text)) return "maak_agenda";
  if (startsWithReviewMaakAgendaCommand(text)) return "maak_agenda";
  if (isReviewCorrectieCommand(text)) return "correctie";
  if (startsWithReviewCorrectieCommand(text)) return "correctie";
  if (endsWithReviewCorrectieCommand(text)) return "correctie";
  if (isReviewStopCommand(text)) return "stop";
  return null;
}

const REVIEW_VOICE_COMMAND_PREFIX_RE =
  /\b(?:maak(?:\s+een)?\s+taak(?:\s+aan)?|maak(?:\s+een)?\s+agenda(?:\s+aan)?|maak taak|maak agenda|correctie|voorlezen|voor lezen|lees(?:\s+(?:het\s+)?(?:uitgewerkte\s+)?(?:verslag|tekst))(?:\s+voor)?|lees\s+voor(?:\s+(?:het\s+)?(?:uitgewerkte\s+)?(?:verslag|tekst))?|graag\s+voorlezen|kun\s+je\s+(?:dit|het(?:\s+uitgewerkte)?\s+(?:verslag|tekst))\s+voor(?:lezen)?|start(?:\s+het)?\s+voorlezen|begin(?:\s+met)?\s+voorlezen|ik\s+wil\s+(?:dat\s+je\s+)?(?:een\s+)?taak|zou\s+je\s+(?:een\s+)?taak|kun\s+je\s+(?:een\s+)?taak|zet\s+(?:dit\s+)?op\s+de\s+to[\s-]?do)\b[.!?,;:]*\s*/gi;

/** @param {string} text */
export function stripReviewVoiceCommand(text) {
  const original = typeof text === "string" ? text : "";
  let cleaned = original.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(REVIEW_VOICE_COMMAND_PREFIX_RE, "").replace(/\s+/g, " ").trim();
  return cleaned;
}

export function parseAnswerTranscript(text) {
  const original = typeof text === "string" ? text : "";
  const normalized = original.replace(/\s+/g, " ").trim();
  const advanceNext =
    isNextQuestionCommand(original) || hasTrailingNextQuestionCommand(original);
  const cmd = advanceNext ? "advance" : detectInterviewCommand(text);
  const endReport = cmd === "finish";
  let cleaned = normalized;
  if (advanceNext) {
    cleaned = normalized
      .replace(NEXT_QUESTION_COMMAND_AT_END_RE, "")
      .replace(/\s+/g, " ")
      .trim();
  } else if (endReport) {
    cleaned = normalized
      .replace(/\b(einde\s+verslag|verslag\s+klaar)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { cleaned, endReport, advanceNext };
}
