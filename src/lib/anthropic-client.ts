import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Vul je bedrijfs-Claude API-sleutel in .env (zie .env.example).",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}
