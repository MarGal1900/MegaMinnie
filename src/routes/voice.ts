import { Router } from "express";
import { isLlmConfigured } from "../lib/llm-config.js";
import {
  classifyVoiceIntent,
  normalizeVoiceIntentResult,
} from "../lib/voice-intent-classifier.js";

export const voiceRouter = Router();

voiceRouter.post("/classify-intent", async (req, res, next) => {
  try {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: "LLM niet geconfigureerd voor intent-classificatie." });
      return;
    }

    const transcript =
      typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
    if (!transcript) {
      res.status(400).json({ error: "transcript is verplicht." });
      return;
    }

    const result = await classifyVoiceIntent(transcript);
    res.json(normalizeVoiceIntentResult(result));
  } catch (err) {
    next(err);
  }
});
