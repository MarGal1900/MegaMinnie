import { describe, expect, it } from "vitest";
import {
  buildWhisperPrompt,
  WHISPER_COMMAND_PROMPT,
  WHISPER_DOMAIN_PROMPT,
} from "../src/lib/whisper-prompts.js";

describe("buildWhisperPrompt", () => {
  it("bevat domein-jargon standaard", () => {
    const prompt = buildWhisperPrompt();
    expect(prompt).toContain("verzekeringsbranche");
    expect(prompt).toContain("CCS");
  });

  it("voegt extra prompt toe", () => {
    const prompt = buildWhisperPrompt({ extra: WHISPER_COMMAND_PROMPT });
    expect(prompt).toContain(WHISPER_DOMAIN_PROMPT.slice(0, 20));
    expect(prompt).toContain("volgende vraag");
  });

  it("slaat domein over als domain false", () => {
    const prompt = buildWhisperPrompt({
      domain: false,
      extra: "alleen commando",
    });
    expect(prompt).toBe("alleen commando");
    expect(prompt).not.toContain("CCS");
  });
});
