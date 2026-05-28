import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY ontbreekt. Kopieer .env.example naar .env en vul je OpenAI-sleutel in.",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}
