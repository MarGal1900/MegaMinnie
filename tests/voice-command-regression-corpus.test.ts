/**
 * Regressiecorpus voor spraakcommando's ("Ok MegaMinnie" wake, "Correctie", "Voorlezen",
 * "Stop", taak/agenda-commando's, en TTS-echo-onderdrukking).
 *
 * Waarom dit bestand bestaat:
 * Elke keer dat een spraakherkenningsprobleem wordt opgelost door een regex/normalisatie
 * aan te passen in interview-commands.js, voice-command-router.js of voice-command-wake.js,
 * loopt dit bestand mee in `npm test`. Het doel is dat een fix voor geval X nooit stilletjes
 * geval Y breekt — als dat gebeurt, faalt hier een test.
 *
 * Workflow bij een nieuw probleem:
 * 1. Voeg de exacte mislukte transcriptie (of het exacte tekstfragment) hieronder toe aan de
 *    juiste tabel, met de uitkomst die je verwacht had.
 * 2. Draai `npx vitest run tests/voice-command-regression-corpus.test.ts` — dit faalt nu.
 * 3. Pas de matcher aan in interview-commands.js / voice-command-router.js totdat deze test
 *    en ALLE andere tests slagen (`npm test`).
 * 4. Verwijder het geval nooit weer — het corpus mag alleen groeien.
 */
import { describe, expect, it } from "vitest";
import {
  containsOkMegaMinnieWake,
  containsReviewCorrectieCommand,
  detectReviewVoiceCommand,
  hasOkMegaMinnieWakePrefix,
  isLikelyReviewSpeechEcho,
  isOkMegaMinnieWakeOnly,
  isReviewCorrectieCommand,
  parseOkMegaMinnieWakeCommand,
  stripRepeatedOkMegaMinnieWakePrefixes,
} from "../public/js/interview-commands.js";
import { resolveVoiceCommandPlan } from "../public/js/voice-command-router.js";
import { reduceVoiceCommandWake } from "../public/js/voice-command-wake.js";

/**
 * Elke case: [transcript, playbackActive, verwachte action ("null" = geen commando)]
 * playbackActive simuleert dat het verslag op dat moment wordt voorgelezen (voice2voice review).
 */
const WAKE_WORD_CASES: Array<[string, boolean]> = [
  ["Ok MegaMinnie", false],
  ["Ok Minnie", false],
  ["Oké MegaMinnie", false],
  ["Oke MegaMinnie.", false],
  ["Okay MegaMinnie", false],
  ["Ok mega minnie", false],
  ["Ok Mega Minni", false],
  ["ok megamini", false],
  ["Ok Megan Minnie", false],
  ["OK, MegaMinnie", false],
  ["ok, minnie.", false],
];

describe("Wake word: 'Ok MegaMinnie' / 'Ok Minnie' varianten", () => {
  it.each(WAKE_WORD_CASES)("herkent wake-only in %j", (text) => {
    expect(hasOkMegaMinnieWakePrefix(text)).toBe(true);
    expect(isOkMegaMinnieWakeOnly(text)).toBe(true);
    const wake = parseOkMegaMinnieWakeCommand(text);
    expect(wake.wakeDetected).toBe(true);
    expect(wake.wakeOnly).toBe(true);
    expect(wake.commandText).toBe("");
  });

  it("wake + commando in één uiting laat commandText over", () => {
    const wake = parseOkMegaMinnieWakeCommand("Ok MegaMinnie, voorlezen");
    expect(wake.wakeDetected).toBe(true);
    expect(wake.wakeOnly).toBe(false);
    expect(wake.commandText).toBe("voorlezen");
  });

  it("verwart geen gewone zin met alleen het woord 'minnie' erin als wake", () => {
    expect(hasOkMegaMinnieWakePrefix("dat vind ik minnie leuk")).toBe(false);
    expect(hasOkMegaMinnieWakePrefix("hey megaminnie")).toBe(false);
  });
});

/**
 * Ticket: tijdens voorlezen moest "Ok Minnie" / "Ok MegaMinnie" ook vaak herhaald worden,
 * zelfde oorzaak als bij "Correctie" — TTS-echo vóór het wake-woord breekt de ^-anchored
 * hasOkMegaMinnieWakePrefix-check. containsOkMegaMinnieWake dekt dat brede geval, en de
 * voice-command-wake reducer moet dit tijdens playbackActive ook echt gebruiken.
 */
const WAKE_MID_ECHO_CASES: string[] = [
  "vervolgafspraak inplannen ok minnie",
  "de klant wil ok megaminnie graag langskomen",
  "afspraak dinsdag ok minnie veertien uur",
];

describe("'Ok Minnie' midden in TTS-echo (repeat-probleem tijdens voorlezen)", () => {
  it.each(WAKE_MID_ECHO_CASES)("herkent wake-woord midden in echo: %j", (text) => {
    expect(containsOkMegaMinnieWake(text)).toBe(true);
  });

  it("matcht geen tekst zonder wake-woord", () => {
    expect(containsOkMegaMinnieWake("de klant wil volgende week langskomen")).toBe(false);
    expect(containsOkMegaMinnieWake("")).toBe(false);
  });

  it("de wake-reducer herkent mid-echo wake-woord tijdens playbackActive en start wake-ack", () => {
    const state = {
      phase: "playback_listen" as const,
      listenReady: true,
      awaitingCommand: false,
      ackInProgress: false,
      pttActive: false,
      wakeDedupeKey: "",
      wakeDedupeAt: 0,
      pendingCommandDuringAck: null,
      ackGeneration: 0,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "vervolgafspraak inplannen ok minnie",
      source: "final",
      playbackActive: true,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("wake_ack");
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(true);
  });

  it("delegeert nog steeds naar review als er echt geen wake-woord in staat", () => {
    const state = {
      phase: "playback_listen" as const,
      listenReady: true,
      awaitingCommand: false,
      ackInProgress: false,
      pttActive: false,
      wakeDedupeKey: "",
      wakeDedupeAt: 0,
      pendingCommandDuringAck: null,
      ackGeneration: 0,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "Correctie",
      source: "final",
      playbackActive: true,
    });
    expect(result.delegate).toBe("review");
    expect(result.handled).toBe(false);
  });
});

/**
 * Ticket: ook BUITEN het voorlezen om (dus zonder TTS-echo) moest "Ok Minnie" soms
 * meerdere keren gezegd worden voordat de bevestiging ("Wat kan ik voor je doen?") kwam.
 * Oorzaak: bij ongeduldig herhalen binnen één door VAD opgevangen uiting ("Ok Minnie.
 * Ok Minnie.") werd alleen het EERSTE wake-voorvoegsel gestript; de rest ("Ok Minnie")
 * werd behandeld als een (onherkend) commando in plaats van als hernieuwde wake-poging,
 * waardoor de hele uiting niets deed — pas een losse, schone "Ok Minnie" werkte.
 */
const REPEATED_WAKE_CASES: string[] = [
  "Ok Minnie Ok Minnie",
  "Ok Minnie. Ok Minnie.",
  "Ok MegaMinnie, ok minnie",
  "Ok Minnie Ok Minnie Ok Minnie",
];

describe("Herhaalde 'Ok Minnie'-pogingen binnen één uiting (buiten voorlezen om)", () => {
  it.each(REPEATED_WAKE_CASES)("stript alle herhalingen volledig weg: %j", (text) => {
    expect(stripRepeatedOkMegaMinnieWakePrefixes(text)).toBe("");
  });

  it.each(REPEATED_WAKE_CASES)("parseOkMegaMinnieWakeCommand ziet dit als wakeOnly: %j", (text) => {
    const wake = parseOkMegaMinnieWakeCommand(text);
    expect(wake.wakeDetected).toBe(true);
    expect(wake.wakeOnly).toBe(true);
    expect(wake.commandText).toBe("");
  });

  it("laat een echt commando na de wake ongewijzigd staan (geen overmatige strip)", () => {
    const wake = parseOkMegaMinnieWakeCommand("Ok MegaMinnie, voorlezen");
    expect(wake.wakeOnly).toBe(false);
    expect(wake.commandText).toBe("voorlezen");
  });

  it("resolveVoiceCommandPlan herkent herhaalde wake als wakeOnly i.p.v. onbekend commando", () => {
    expect(
      resolveVoiceCommandPlan({ text: "Ok Minnie Ok Minnie", playbackActive: false }),
    ).toMatchObject({ action: null, wakeOnly: true });
  });

  it("de wake-reducer start alsnog wake-ack bij herhaalde wake in listen_idle", () => {
    const state = {
      phase: "listen_idle" as const,
      listenReady: true,
      awaitingCommand: false,
      ackInProgress: false,
      pttActive: false,
      wakeDedupeKey: "",
      wakeDedupeAt: 0,
      pendingCommandDuringAck: null,
      ackGeneration: 0,
    };
    const result = reduceVoiceCommandWake(state, {
      type: "STT",
      text: "Ok Minnie Ok Minnie",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("wake_ack");
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(true);
  });
});

const CORRECTIE_CASES: Array<[string, "start" | "mid" | "end", boolean]> = [
  ["Correctie", "start", true],
  ["Correctie.", "start", true],
  ["correctie!", "start", true],
  ["Correctie de datum is morgen", "mid", true],
  ["De naam is Jan Jansen. Correctie.", "end", true],
  ["De naam is Jan Jansen. Correctie", "end", true],
];

describe("'Correctie' commando varianten", () => {
  it.each(CORRECTIE_CASES.filter(([, pos]) => pos === "start"))(
    "herkent pure Correctie-uiting: %j",
    (text) => {
      expect(isReviewCorrectieCommand(text)).toBe(true);
    },
  );

  it("herkent 'Correctie' gevolgd door de correctie-inhoud", () => {
    expect(detectReviewVoiceCommand("Correctie de datum is morgen")).toBe("correctie");
  });

  it("herkent 'Correctie' aan het EINDE van een uiting (TTS-echo + gebruiker samengevoegd)", () => {
    expect(detectReviewVoiceCommand("De naam is Jan Jansen. Correctie.")).toBe("correctie");
    expect(detectReviewVoiceCommand("De naam is Jan Jansen. Correctie")).toBe("correctie");
  });

  it("routeert Correctie tijdens voorlezen zonder wake-woord nodig te hebben", () => {
    expect(resolveVoiceCommandPlan({ text: "Correctie", playbackActive: true })).toMatchObject({
      action: "correctie",
    });
  });

  it("routeert Correctie na expliciete wake ('Ok MegaMinnie, correctie')", () => {
    expect(
      resolveVoiceCommandPlan({ text: "Ok MegaMinnie, correctie", playbackActive: false }),
    ).toMatchObject({ action: "correctie" });
  });
});

/**
 * Ticket: tijdens voorlezen moest "Correctie" vaak meerdere keren geroepen worden voordat
 * het systeem ging luisteren. Oorzaak: de mic vangt tijdens TTS-playback ook de eigen
 * voorgelezen tekst op (akoestische echo, vooral op carkit/losse speaker), waardoor
 * "Correctie" vaak MIDDEN in een langere gegarbelde string terechtkomt — niet alleen aan
 * begin of eind zoals de bestaande varianten al afvingen. containsReviewCorrectieCommand
 * dekt dat brede middengeval.
 */
const CORRECTIE_MID_ECHO_CASES: string[] = [
  "vervolgafspraak inplannen correctie de naam klopt niet",
  "de klant wil correctie graag volgende week langskomen",
  "afspraak dinsdag correctie veertien uur is het geworden",
  "Correctie, de datum klopt niet, dinsdag inplannen",
];

describe("'Correctie' midden in TTS-echo (repeat-probleem tijdens voorlezen)", () => {
  it.each(CORRECTIE_MID_ECHO_CASES)("herkent correctie midden in echo: %j", (text) => {
    expect(containsReviewCorrectieCommand(text)).toBe(true);
  });

  it("matcht geen tekst zonder het woord correctie", () => {
    expect(containsReviewCorrectieCommand("de klant wil volgende week langskomen")).toBe(false);
    expect(containsReviewCorrectieCommand("")).toBe(false);
  });

  it("blijft ook via detectReviewVoiceCommand niet-matchend voor eerdere edge cases die bewust ongewijzigd zijn", () => {
    // detectReviewVoiceCommand zelf is niet aangepast (blijft start/eind-only voor correctie);
    // de brede mid-match wordt bewust alleen toegepast in app.js, gguard door
    // "!reviewInlineCorrection.active", zodat gedicteerde correctie-inhoud die het woord
    // "correctie" bevat niet per ongeluk wordt weggefilterd. Dit is hier gedocumenteerd zodat
    // niemand containsReviewCorrectieCommand per abuis in detectReviewVoiceCommand plakt.
    expect(detectReviewVoiceCommand("vervolgafspraak inplannen correctie de naam klopt niet")).toBe(
      null,
    );
  });
});

describe("'Voorlezen' / 'Stop' commando varianten", () => {
  const START_VOORLEZEN: string[] = [
    "voorlezen",
    "Voor lezen",
    "Start het voorlezen",
    "Begin met voorlezen",
    "Lees het verslag voor",
    "Lees voor",
    "Lees het uitgewerkte verslag voor",
    "Graag voorlezen",
  ];

  it.each(START_VOORLEZEN)("start voorlezen bij: %j", (text) => {
    expect(
      resolveVoiceCommandPlan({ text, playbackActive: false }).action,
    ).toBe("start_voorlezen");
  });

  it("stopt voorlezen op 'stop' / 'stoppen', ook tijdens playback", () => {
    expect(resolveVoiceCommandPlan({ text: "stop", playbackActive: true }).action).toBe("stop");
    expect(resolveVoiceCommandPlan({ text: "Stoppen.", playbackActive: true }).action).toBe(
      "stop",
    );
  });
});

describe("Taak / agenda commando's met inhoud", () => {
  it("bewaart de inhoud na 'maak taak' / 'maak agenda'", () => {
    expect(
      resolveVoiceCommandPlan({
        text: "Maak een taak aan klant bellen morgen",
        playbackActive: false,
      }),
    ).toMatchObject({ action: "maak_taak", remainder: "klant bellen morgen" });
    expect(
      resolveVoiceCommandPlan({
        text: "Maak een agenda aan afspraak dinsdag 14 uur",
        playbackActive: false,
      }),
    ).toMatchObject({ action: "maak_agenda", remainder: "afspraak dinsdag 14 uur" });
  });
});

/**
 * TTS-echo-onderdrukking: wanneer de speaker/carkit de eigen voorlezen-stem oppikt via de
 * microfoon, mag dat niet als nieuw gebruikerscommando/-tekst worden verwerkt.
 * [candidateText, lastSpokenChunk, verwachte "is een echo?"]
 */
const ECHO_CASES: Array<[string, string, boolean]> = [
  [
    "De klant wil graag volgende week een vervolgafspraak inplannen",
    "De klant wil graag volgende week een vervolgafspraak inplannen.",
    true,
  ],
  ["vervolgafspraak inplannen volgende week", "De klant wil graag volgende week een vervolgafspraak inplannen.", true],
  ["Correctie", "De klant wil graag volgende week een vervolgafspraak inplannen.", false],
  ["de naam moet Jan zijn, niet Piet", "De klant wil graag volgende week een vervolgafspraak inplannen.", false],
  ["", "De klant wil graag volgende week een vervolgafspraak inplannen.", false],
  ["iets heel anders", "", false],
];

describe("TTS-echo-detectie (isLikelyReviewSpeechEcho)", () => {
  it.each(ECHO_CASES)("echo(%j, %j) === %j", (candidate, lastSpoken, expected) => {
    expect(isLikelyReviewSpeechEcho(candidate, lastSpoken)).toBe(expected);
  });
});
