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
  extractOkMegaMinnieWakeAnywhere,
  hasOkMegaMinnieWakePrefix,
  isLikelyReviewSpeechEcho,
  isOkMegaMinnieWakeOnly,
  isReviewCorrectieCommand,
  parseOkMegaMinnieWakeCommand,
  stripRepeatedOkMegaMinnieWakePrefixes,
} from "../public/js/interview-commands.js";
import {
  VOICE_COMMAND_WAKE_ACK_SPEECH,
  resolveVoiceCommandPlan,
} from "../public/js/voice-command-router.js";
import { normalizeWakeKey, reduceVoiceCommandWake } from "../public/js/voice-command-wake.js";

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
  // 2026-07-03: STT-varianten die in de praktijk uit gpt-4o-(mini-)transcribe komen en de
  // reden waren dat "Ok Minnie" op het hoofdscherm 5-6x gezegd moest worden.
  ["Oké, mini.", false],
  ["OK, Mini!", false],
  ["Okee Minnie", false],
  ["O.K. Minnie", false],
  ["okay minny", false],
  ["oké minie", false],
  ["ok minni", false],
  ["Okee, MegaMinnie", false],
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

  it("schone 'Ok Minnie, maak taak ...' tijdens playbackActive voert direct uit (geen ack)", () => {
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
      text: "Ok Minnie, maak een taak aan bel de klant morgen",
      source: "final",
      playbackActive: true,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("executing");
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND")).toBe(true);
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(false);
  });

  /**
   * Gedragswijziging (2026-07-03, expliciete wens): tijdens voorlezen speelt "Ok Minnie" GEEN
   * gesproken "Wat kan ik voor je doen?"-bevestiging meer af. In plaats daarvan wordt het
   * voorlezen gepauzeerd en direct geluisterd naar de instructie — precies zoals bij het
   * commando "Correctie".
   */
  it("de wake-reducer herkent mid-echo wake-woord tijdens playbackActive: pauzeert en luistert direct (geen gesproken ack)", () => {
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
    expect(result.state.phase).toBe("playback_listen");
    expect(result.state.awaitingCommand).toBe(true);
    expect(result.effects.some((e) => e.type === "PAUSE_PLAYBACK")).toBe(true);
    expect(result.effects.some((e) => e.type === "START_CORRECTION")).toBe(false);
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(false);
  });

  it("wake-only 'Ok Minnie' tijdens playbackActive: pauzeert en luistert direct (geen gesproken ack)", () => {
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
      text: "Ok Minnie",
      source: "final",
      playbackActive: true,
    });
    expect(result.handled).toBe(true);
    expect(result.state.awaitingCommand).toBe(true);
    expect(result.effects.some((e) => e.type === "PAUSE_PLAYBACK")).toBe(true);
    expect(result.effects.some((e) => e.type === "START_CORRECTION")).toBe(false);
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(false);
    expect(result.effects.some((e) => e.type === "SET_MIC" && e.enabled === true)).toBe(true);
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

/**
 * Ticket: "Ok Minnie" tijdens voorlezen dempt het volume wel, maar de instructie erna
 * ("Maak een agenda aan") deed niets als de gebruiker die vóór/tijdens de bevestiging
 * "Wat kan ik voor je doen?" uitsprak (twee losse VAD-uitingen i.p.v. één). Oorzaak: de
 * microfoon werd tijdens die bevestiging hardware-matig uitgeschakeld (SET_MIC enabled:
 * false), waardoor die vroege instructie het model nooit bereikte.
 *
 * Fix: mic blijft aan tijdens de bevestiging. De reducer behandelt STT tijdens de ack
 * verschillend afhankelijk van playbackActive (net als de rest van deze state machine):
 * - Tijdens voorlezen (playbackActive true, state.reviewPlayback.active blijft true zolang
 *   er alleen gepauzeerd is): een instructie zonder wake-woord krijgt delegate:"review" en
 *   wordt afgehandeld door maybeHandleReviewVoiceCommand (dezelfde route als Correctie) —
 *   niet via pendingCommandDuringAck.
 * - Buiten voorlezen (playbackActive false, idle-wake): een instructie zonder wake-woord
 *   wordt vastgehouden als pendingCommandDuringAck en na de bevestiging alsnog uitgevoerd;
 *   de eigen ack-echo wordt daarbij tekstueel gefilterd zodat die niet als commando geldt.
 * Correctie loopt via de eerste route (delegate: "review", zie hierboven) en gaat nooit
 * door de pendingCommandDuringAck-tak — moet dus onveranderd blijven werken.
 */
describe("Vroege instructie tijdens de 'Wat kan ik voor je doen?'-bevestiging", () => {
  const ackStateIdle = {
    phase: "wake_ack" as const,
    listenReady: true,
    awaitingCommand: false,
    ackInProgress: true,
    pttActive: false,
    wakeDedupeKey: "ok minnie",
    wakeDedupeAt: 0,
    pendingCommandDuringAck: null,
    ackGeneration: 1,
  };

  it("startWakeAck schakelt de microfoon niet meer uit", () => {
    const result = reduceVoiceCommandWake(
      {
        phase: "listen_idle",
        listenReady: true,
        awaitingCommand: false,
        ackInProgress: false,
        pttActive: false,
        wakeDedupeKey: "",
        wakeDedupeAt: 0,
        pendingCommandDuringAck: null,
        ackGeneration: 0,
      },
      { type: "STT", text: "Ok Minnie", source: "final", playbackActive: false },
    );
    expect(result.state.phase).toBe("wake_ack");
    expect(
      result.effects.some((e) => e.type === "SET_MIC" && e.enabled === false),
    ).toBe(false);
  });

  it("tijdens voorlezen: een instructie tijdens de bevestiging wordt naar review gedelegeerd i.p.v. genegeerd", () => {
    const result = reduceVoiceCommandWake(ackStateIdle, {
      type: "STT",
      text: "Maak een agenda aan",
      source: "final",
      playbackActive: true,
    });
    expect(result.delegate).toBe("review");
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND")).toBe(false);
  });

  it("buiten voorlezen (idle-wake): een echte instructie tijdens de bevestiging wordt vastgehouden i.p.v. genegeerd", () => {
    const result = reduceVoiceCommandWake(ackStateIdle, {
      type: "STT",
      text: "Maak een agenda aan",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.pendingCommandDuringAck).toBe("Maak een agenda aan");
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND")).toBe(false);
  });

  it("buiten voorlezen: de eigen echo van de bevestigingstekst wordt genegeerd (geen pending commando)", () => {
    const result = reduceVoiceCommandWake(ackStateIdle, {
      type: "STT",
      text: VOICE_COMMAND_WAKE_ACK_SPEECH,
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.pendingCommandDuringAck).toBe(null);
  });

  /**
   * Regressie: zonder duidelijke stilte tussen de echo en het echte commando komen beide soms
   * als ÉÉN STT-fragment binnen ("Wat kan ik voor je doen Maak een agenda aan"). De oude check
   * (isLikelyReviewSpeechEcho met "candidate.includes(spoken)") classificeerde zo'n fragment als
   * "puur echo" omdat de echo-tekst er letterlijk aan het begin in voorkomt, en gooide het HELE
   * fragment weg — het echte commando erna ging dus spoorloos verloren (nooit uitgevoerd, ook
   * niet na een tweede "Ok Minnie"). Fix: alleen het echo-voorvoegsel strippen, de rest bewaren
   * als pending commando.
   */
  it("buiten voorlezen: een commando vlak ná de echo (zonder stilte, één fragment) blijft bewaard", () => {
    const result = reduceVoiceCommandWake(ackStateIdle, {
      type: "STT",
      text: `${VOICE_COMMAND_WAKE_ACK_SPEECH} Maak een agenda aan`,
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.pendingCommandDuringAck).toBe("Maak een agenda aan");
  });

  it("buiten voorlezen: een vastgehouden instructie wordt na WAKE_ACK_SUCCESS alsnog uitgevoerd", () => {
    const withPending = { ...ackStateIdle, pendingCommandDuringAck: "Maak een agenda aan" };
    const result = reduceVoiceCommandWake(withPending, {
      type: "WAKE_ACK_SUCCESS",
      generation: 1,
      wakeKey: "ok minnie",
    });
    expect(result.state.phase).toBe("executing");
    expect(
      result.effects.some(
        (e) => e.type === "EXECUTE_COMMAND" && e.text === "Maak een agenda aan",
      ),
    ).toBe(true);
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

/**
 * Ticket (2026-07-03): op het HOOFDSCHERM (listen_idle) moest "Ok Minnie" 5-6x gezegd worden.
 * Twee oorzaken naast de STT-varianten hierboven:
 * 1. Het wake-woord stond niet aan het BEGIN van de uiting (VAD vangt ruis/aarzeling mee,
 *    bijv. "eh, ok minnie") — de ^-anchored prefix-check miste dat en de uiting deed niets.
 * 2. Een kort, onherkenbaar restje ACHTER het wake-woord ("Ok Minnie. Bedankt." — typische
 *    STT-hallucinatie) werd als commando uitgevoerd → "Commando niet herkend" i.p.v. de
 *    bevestiging.
 */
describe("Idle wake: wake-woord niet aan het begin of met ruis erachter (hoofdscherm)", () => {
  const idleState = {
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

  const IDLE_MID_UTTERANCE_WAKES: string[] = [
    "eh ok minnie",
    "uh, oké mini",
    "zo dat was het ok megaminnie",
  ];

  it.each(IDLE_MID_UTTERANCE_WAKES)("start wake-ack bij wake midden in de uiting: %j", (text) => {
    const result = reduceVoiceCommandWake(idleState, {
      type: "STT",
      text,
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("wake_ack");
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(true);
  });

  it("behandelt een kort onherkenbaar restje na de wake als wake-only (ack i.p.v. 'niet herkend')", () => {
    const result = reduceVoiceCommandWake(idleState, {
      type: "STT",
      text: "Ok Minnie. Bedankt.",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("wake_ack");
    expect(result.effects.some((e) => e.type === "PLAY_WAKE_ACK")).toBe(true);
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND")).toBe(false);
  });

  it("voert een herkenbaar commando ná een mid-uiting-wake direct uit", () => {
    const result = reduceVoiceCommandWake(idleState, {
      type: "STT",
      text: "eh ok minnie maak een taak aan bel de klant morgen",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.state.phase).toBe("executing");
    expect(
      result.effects.some(
        (e) => e.type === "EXECUTE_COMMAND" && e.text === "maak een taak aan bel de klant morgen",
      ),
    ).toBe(true);
  });

  it("extractOkMegaMinnieWakeAnywhere strips herhaalde wakes in het restant", () => {
    const anywhere = extractOkMegaMinnieWakeAnywhere("eh ok minnie ok minnie");
    expect(anywhere.wakeDetected).toBe(true);
    expect(anywhere.wakeOnly).toBe(true);
    expect(anywhere.commandText).toBe("");
  });

  it("negeert nog steeds tekst zonder wake-woord in idle", () => {
    const result = reduceVoiceCommandWake(idleState, {
      type: "STT",
      text: "de klant wil volgende week langskomen",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(false);
    expect(result.effects).toHaveLength(0);
  });
});

/**
 * Ticket (2026-07-03): echo-bug in de luister-modus (awaiting_command). De STT-transcriptie
 * van de eigen bevestiging "Wat kan ik voor je doen?" kwam door STT-latency vaak pas ná
 * WAKE_ACK_SUCCESS binnen en werd dan blind als commando uitgevoerd → "Commando niet
 * herkend", luister-modus afgebroken, en de echte instructie viel in het luchtledige.
 * Hetzelfde geldt voor een late echo van de laatst voorgelezen chunk (via event.echoText).
 */
describe("Late TTS-echo in awaiting_command (echo-bug)", () => {
  const awaitingState = {
    phase: "awaiting_command" as const,
    listenReady: true,
    awaitingCommand: true,
    ackInProgress: false,
    pttActive: false,
    wakeDedupeKey: "ok minnie",
    wakeDedupeAt: 0,
    pendingCommandDuringAck: null,
    ackGeneration: 1,
  };

  it("negeert de late echo van de eigen bevestiging", () => {
    const result = reduceVoiceCommandWake(awaitingState, {
      type: "STT",
      text: VOICE_COMMAND_WAKE_ACK_SPEECH,
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND")).toBe(false);
    expect(result.state.awaitingCommand).toBe(true);
  });

  it("bewaart een commando dat aan de ack-echo vastgeplakt zit (één STT-fragment)", () => {
    const result = reduceVoiceCommandWake(awaitingState, {
      type: "STT",
      text: `${VOICE_COMMAND_WAKE_ACK_SPEECH} Maak een agenda aan`,
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(
      result.effects.some((e) => e.type === "EXECUTE_COMMAND" && e.text === "Maak een agenda aan"),
    ).toBe(true);
  });

  it("negeert de late echo van de laatst voorgelezen chunk (echoText)", () => {
    const chunk = "De klant wil graag volgende week een vervolgafspraak inplannen.";
    const result = reduceVoiceCommandWake(awaitingState, {
      type: "STT",
      text: "de klant wil graag volgende week een vervolgafspraak inplannen",
      source: "final",
      playbackActive: false,
      echoText: chunk,
    });
    expect(result.handled).toBe(true);
    expect(result.effects.some((e) => e.type === "EXECUTE_COMMAND")).toBe(false);
    expect(result.state.awaitingCommand).toBe(true);
  });

  it("voert een echt commando in awaiting gewoon uit", () => {
    const result = reduceVoiceCommandWake(awaitingState, {
      type: "STT",
      text: "Lees het verslag voor",
      source: "final",
      playbackActive: false,
    });
    expect(result.handled).toBe(true);
    expect(
      result.effects.some((e) => e.type === "EXECUTE_COMMAND" && e.text === "Lees het verslag voor"),
    ).toBe(true);
  });
});

/**
 * "Ok Minnie" en "Ok MegaMinnie" moeten exact hetzelfde werken — ook de dedupe-key wordt
 * gecanonicaliseerd zodat snel wisselen tussen de twee varianten geen dubbele wake geeft.
 */
describe("Ok Minnie == Ok MegaMinnie (canonieke dedupe-key)", () => {
  it("normalizeWakeKey levert dezelfde key voor beide varianten", () => {
    expect(normalizeWakeKey("Ok MegaMinnie")).toBe(normalizeWakeKey("Ok Minnie"));
    expect(normalizeWakeKey("Oké, mini.")).toBe(normalizeWakeKey("OK, MegaMinnie"));
  });
});
