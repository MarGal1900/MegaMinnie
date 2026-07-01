/**
 * LLM intent-classificatie (fallback na regex) — alleen in commando-modus na wake.
 */

import { apiPost } from "./api.js";
import { resolveVoiceCommandPlan } from "./voice-command-router.js";

const VOICE_INTENT_TIMEOUT_MS = 8000;

/** @param {string} transcript */
export async function classifyVoiceIntentRemote(transcript) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_INTENT_TIMEOUT_MS);
  try {
    return await apiPost("/api/voice/classify-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Intent-classificatie duurde te lang.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Regex eerst; bij geen match optioneel LLM-fallback.
 * @param {{ text: string; playbackActive: boolean; useLlmFallback?: boolean }} ctx
 */
export async function resolveVoiceCommandPlanWithFallback(ctx) {
  const { text, playbackActive, useLlmFallback = true } = ctx;
  const local = resolveVoiceCommandPlan({ text, playbackActive });
  if (local.action || local.wakeOnly || !useLlmFallback) {
    return local;
  }

  try {
    const llmIntent = await classifyVoiceIntentRemote(text);
    const llmPlan = resolveVoiceCommandPlan({ text, playbackActive, llmIntent });
    if (llmPlan.action) return llmPlan;
  } catch (err) {
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[voice-intent] LLM fallback mislukt:", err);
    }
  }

  return local;
}
