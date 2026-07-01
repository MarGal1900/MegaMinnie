import { describe, expect, it } from "vitest";
import { isStartVoorlezenCommand } from "../public/js/interview-commands.js";
import {
  getVoiceCommandFailureMessage,
  getVoiceCommandUnrecognizedMessage,
  getVoiceCommandWakeAckSpeechText,
  getVoiceCommandWakePromptMessage,
  isActionableVoiceIntent,
  mapVoiceIntentToPlan,
  resolveVoiceCommandPlan,
  VOICE_COMMAND_WAKE_ACK_SPEECH,
  VOICE_INTENT_MIN_CONFIDENCE,
} from "../public/js/voice-command-router.js";

describe("isStartVoorlezenCommand", () => {
  it("herkent voorlezen en start-varianten", () => {
    expect(isStartVoorlezenCommand("voorlezen")).toBe(true);
    expect(isStartVoorlezenCommand("Start het voorlezen")).toBe(true);
    expect(isStartVoorlezenCommand("Begin met voorlezen")).toBe(true);
    expect(isStartVoorlezenCommand("Lees het verslag voor")).toBe(true);
    expect(isStartVoorlezenCommand("Lees voor")).toBe(true);
    expect(isStartVoorlezenCommand("kunnen we dit voorlezen aan de klant")).toBe(false);
  });
});

describe("resolveVoiceCommandPlan", () => {
  it("start voorlezen wanneer playback niet actief is", () => {
    expect(
      resolveVoiceCommandPlan({ text: "Start het voorlezen", playbackActive: false }),
    ).toMatchObject({
      action: "start_voorlezen",
      autoStartPlayback: true,
    });
  });

  it("hervat voorlezen wanneer playback al actief is", () => {
    expect(resolveVoiceCommandPlan({ text: "voorlezen", playbackActive: true })).toMatchObject({
      action: "resume_voorlezen",
      autoStartPlayback: false,
    });
  });

  it("plant capture-commando met auto-start playback", () => {
    expect(
      resolveVoiceCommandPlan({
        text: "Maak taak klant bellen",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "maak_taak",
      requiresPlayback: true,
      autoStartPlayback: true,
      remainder: "klant bellen",
    });
  });

  it("routeert stop alleen tijdens playback", () => {
    expect(resolveVoiceCommandPlan({ text: "stop", playbackActive: true })).toMatchObject({
      action: "stop",
      requiresPlayback: true,
    });
    expect(resolveVoiceCommandPlan({ text: "stop", playbackActive: false })).toMatchObject({
      action: "stop",
      requiresPlayback: true,
    });
  });

  it("routeert commando na Ok MegaMinnie wake prefix", () => {
    expect(
      resolveVoiceCommandPlan({
        text: "Ok MegaMinnie, voorlezen",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "start_voorlezen",
      autoStartPlayback: true,
      wakeOnly: false,
    });
    expect(
      resolveVoiceCommandPlan({
        text: "Oké MegaMinnie maak taak klant bellen",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "maak_taak",
      autoStartPlayback: true,
      remainder: "klant bellen",
    });
    expect(
      resolveVoiceCommandPlan({
        text: "Ok mega minnie, stop",
        playbackActive: true,
      }),
    ).toMatchObject({
      action: "stop",
      requiresPlayback: true,
    });
  });

  it("routeert natuurlijke taal na wake", () => {
    expect(
      resolveVoiceCommandPlan({
        text: "Ok Minnie, lees het verslag voor",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "start_voorlezen",
      autoStartPlayback: true,
    });
    expect(
      resolveVoiceCommandPlan({
        text: "Lees voor",
        playbackActive: true,
      }),
    ).toMatchObject({
      action: "resume_voorlezen",
    });
    expect(
      resolveVoiceCommandPlan({
        text: "Maak een taak aan klant bellen morgen",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "maak_taak",
      remainder: "klant bellen morgen",
    });
    expect(
      resolveVoiceCommandPlan({
        text: "Maak een agenda aan afspraak dinsdag 14 uur",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "maak_agenda",
      remainder: "afspraak dinsdag 14 uur",
    });
  });

  it("herkent wake-only uiting zonder commando", () => {
    expect(
      resolveVoiceCommandPlan({ text: "Ok MegaMinnie", playbackActive: false }),
    ).toMatchObject({
      action: null,
      wakeOnly: true,
    });
    expect(
      resolveVoiceCommandPlan({ text: "Ok Minnie", playbackActive: false }).wakeOnly,
    ).toBe(true);
    expect(
      resolveVoiceCommandPlan({ text: "Oké MegaMinnie.", playbackActive: false }).wakeOnly,
    ).toBe(true);
  });

  it("start correctie direct tijdens voorlezen zonder wake-ack", () => {
    expect(
      resolveVoiceCommandPlan({ text: "Correctie", playbackActive: true }),
    ).toMatchObject({
      action: "correctie",
      wakeOnly: false,
    });
    expect(
      resolveVoiceCommandPlan({ text: "Correctie.", playbackActive: true }).wakeOnly,
    ).toBe(false);
    expect(
      resolveVoiceCommandPlan({
        text: "Correctie de datum is morgen",
        playbackActive: true,
      }),
    ).toMatchObject({
      action: "correctie",
      remainder: "de datum is morgen",
      wakeOnly: false,
    });
  });

  it("start correctie-shell buiten voorlezen bij puur Correctie", () => {
    expect(
      resolveVoiceCommandPlan({ text: "Correctie", playbackActive: false }),
    ).toMatchObject({
      action: "correctie",
      wakeOnly: false,
      autoStartPlayback: true,
    });
  });

  it("plant correctie zonder voorlezen-first via capture-shell pad", () => {
    expect(
      resolveVoiceCommandPlan({
        text: "Correctie de datum is morgen",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "correctie",
      requiresPlayback: true,
      autoStartPlayback: true,
      remainder: "de datum is morgen",
    });
  });

  it("negeert onbekende zinnen", () => {
    expect(
      resolveVoiceCommandPlan({ text: "hey megaminnie", playbackActive: false }).action,
    ).toBeNull();
  });

  it("herkent uitgewerkte verslag-formulering via regex", () => {
    expect(
      resolveVoiceCommandPlan({
        text: "Lees het uitgewerkte verslag voor",
        playbackActive: false,
      }),
    ).toMatchObject({
      action: "start_voorlezen",
      autoStartPlayback: true,
    });
  });

  it("mapt LLM-intent naar router-plan", () => {
    expect(
      mapVoiceIntentToPlan(
        { intent: "READ_REPORT", confidence: VOICE_INTENT_MIN_CONFIDENCE },
        false,
      ),
    ).toMatchObject({ action: "start_voorlezen" });
    expect(
      mapVoiceIntentToPlan(
        {
          intent: "CREATE_TASK",
          confidence: 0.9,
          remainder: "klant morgen bellen",
        },
        false,
      ),
    ).toMatchObject({
      action: "maak_taak",
      remainder: "klant morgen bellen",
      autoStartPlayback: true,
    });
    expect(
      resolveVoiceCommandPlan({
        text: "Lees alsjeblieft de uitgewerkte tekst voor",
        playbackActive: false,
        llmIntent: { intent: "READ_REPORT", confidence: VOICE_INTENT_MIN_CONFIDENCE },
      }),
    ).toMatchObject({ action: "start_voorlezen" });
    expect(isActionableVoiceIntent({ intent: "UNKNOWN", confidence: 1 })).toBe(false);
  });
});

describe("voice command feedback", () => {
  it("geeft duidelijke fout- en helpberichten", () => {
    expect(getVoiceCommandFailureMessage("stop")).toContain("Voorlezen");
    expect(getVoiceCommandFailureMessage("maak_taak")).toContain("Voorlezen");
    expect(getVoiceCommandUnrecognizedMessage()).toContain("Lees het verslag voor");
    expect(getVoiceCommandWakePromptMessage()).toContain("Correctie");
    expect(getVoiceCommandWakeAckSpeechText()).toBe(VOICE_COMMAND_WAKE_ACK_SPEECH);
    expect(VOICE_COMMAND_WAKE_ACK_SPEECH).toBe("Wat kan ik voor je doen?");
  });
});
