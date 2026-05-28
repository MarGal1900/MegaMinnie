export type LlmProvider = "anthropic" | "openai";

/** Welke LLM-backend: standaard Claude (bedrijfsaccount) als ANTHROPIC_API_KEY gezet is. */
export function getLlmProvider(): LlmProvider {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "anthropic" || explicit === "claude") return "anthropic";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return "openai";
}

export function isLlmConfigured(): boolean {
  if (getLlmProvider() === "anthropic") {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export { isWhisperConfigured } from "./whisper-config.js";

export function getChatModel(): string {
  if (getLlmProvider() === "anthropic") {
    return (
      process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514"
    );
  }
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
}

export function getVisionModel(): string {
  if (getLlmProvider() === "anthropic") {
    return (
      process.env.ANTHROPIC_VISION_MODEL?.trim() || getChatModel()
    );
  }
  return (
    process.env.OPENAI_VISION_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}
