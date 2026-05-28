import { APIError as AnthropicAPIError } from "@anthropic-ai/sdk";
import { APIError as OpenAIAPIError } from "openai";

/** Nederlandse foutmelding voor LLM/API-problemen. */
export function formatApiError(err: unknown): string {
  if (err instanceof AnthropicAPIError) {
    if (err.status === 401) {
      return "Anthropic API-sleutel is ongeldig. Controleer ANTHROPIC_API_KEY in .env.";
    }
    if (err.status === 429) {
      return "Claude API-limiet bereikt. Probeer later opnieuw of neem contact op met je Anthropic-beheerder.";
    }
    if (err.status === 400) {
      return err.message || "Ongeldige aanvraag naar Claude API.";
    }
    if (err.status === 503 || err.status === 500) {
      return "Claude API is tijdelijk niet bereikbaar. Probeer het over een minuut opnieuw.";
    }
    return err.message;
  }

  if (err instanceof OpenAIAPIError) {
    if (err.status === 429 || err.code === "insufficient_quota") {
      return "OpenAI-tegoed is op. Vul tegoed aan op platform.openai.com (alleen nodig voor spraak/Whisper).";
    }
    if (err.status === 401) {
      return "OpenAI API-sleutel is ongeldig. Controleer OPENAI_API_KEY in .env.";
    }
    if (err.status === 400 && /vision|image/i.test(err.message)) {
      return "Dit OpenAI-model ondersteunt geen foto's.";
    }
    if (err.status === 503 || err.status === 500) {
      return "OpenAI is tijdelijk niet bereikbaar.";
    }
    return err.message;
  }

  if (err instanceof Error) {
    if (/quota|429|insufficient_quota/i.test(err.message)) {
      return "API-tegoed of limiet bereikt. Controleer je Claude- of OpenAI-account.";
    }
    if (/ECONNREFUSED|fetch failed|Whisper lokaal/i.test(err.message)) {
      return (
        "Whisper-server niet bereikbaar. Start lokaal faster-whisper met: npm run whisper:up"
      );
    }
    if (/INVALID_LOGIN|LOGIN_MUST_USE_SECURITY_TOKEN|invalid_client|Salesforce-credentials/i.test(err.message)) {
      return err.message.includes("Salesforce")
        ? err.message
        : "Salesforce-login mislukt. Controleer SF_* in .env (zie docs/SALESFORCE.md).";
    }
    return err.message;
  }

  return "Onbekende fout";
}
