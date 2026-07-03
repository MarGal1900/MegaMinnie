import { Router } from "express";
import {
  getSpeechModel,
  getSpeechVoice,
  normalizeSpeechText,
  synthesizeOpenAiSpeech,
  validateSpeechPrereqs,
} from "../lib/openai-speech.js";
import {
  getEventCaptureRealtimeInstructions,
  getListenRealtimeInstructions,
  getOpenAiApiKey,
  getRealtimeInstructions,
  getRealtimeModel,
  getRealtimeTranscriptionModel,
  getRealtimeVoice,
  getReviewRealtimeInstructions,
  getSupplementRealtimeInstructions,
  getTaskCaptureRealtimeInstructions,
  isRealtimeInterviewEnabled,
} from "../lib/realtime-config.js";

type RealtimeSessionSuccess = {
  clientSecret: string;
  expiresAt: number | null;
  sessionId: string | null;
  model: string;
  voice: string;
};

type RealtimeSessionCreateOptions = {
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
  transcriptionModel: string;
  createResponse?: boolean;
  fetchImpl?: typeof fetch;
};

/** Session payload for GA client_secrets (exported for tests). */
export function buildRealtimeSessionPayload(params: {
  model: string;
  voice: string;
  instructions: string;
  transcriptionModel: string;
  /** false = alleen transcriptie/VAD, geen automatische response.create (capture/review). */
  createResponse?: boolean;
}) {
  const turnDetection: Record<string, unknown> = { type: "server_vad" };
  if (params.createResponse === false) {
    turnDetection.create_response = false;
  }
  return {
    session: {
      type: "realtime",
      model: params.model,
      instructions: params.instructions,
      audio: {
        input: {
          turn_detection: turnDetection,
          transcription: {
            model: params.transcriptionModel,
            language: "nl",
          },
        },
        output: {
          voice: params.voice,
        },
      },
    },
  };
}

type RealtimeSessionPrereqResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export const realtimeRouter = Router();

function parseRealtimeErrorBody(body: unknown): string {
  if (!body || typeof body !== "object") return "Kon Realtime sessie niet starten.";
  if ("error" in body && body.error && typeof body.error === "object") {
    const err = body.error as { message?: unknown };
    if (typeof err.message === "string" && err.message.trim()) return err.message.trim();
  }
  if ("message" in body && typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  return "Kon Realtime sessie niet starten.";
}

export function validateRealtimeSessionPrereqs(params: {
  enabled: boolean;
  apiKey: string;
}): RealtimeSessionPrereqResult {
  if (!params.enabled) {
    return { ok: false, status: 404, error: "Realtime interview is uitgeschakeld." };
  }
  if (!params.apiKey.trim()) {
    return {
      ok: false,
      status: 503,
      error: "Realtime interview is niet geconfigureerd (OPENAI_API_KEY ontbreekt).",
    };
  }
  return { ok: true };
}

function extractClientSecretPayload(body: unknown): {
  secret: string | null;
  expiresAt: number | null;
  sessionId: string | null;
} {
  if (!body || typeof body !== "object") {
    return { secret: null, expiresAt: null, sessionId: null };
  }
  const json = body as Record<string, unknown>;
  const sessionId = typeof json.id === "string" ? json.id : null;

  // GA endpoint may return one of:
  // { value, expires_at }, { client_secret: { value, expires_at } }, { data: { value, expires_at } }
  if (typeof json.value === "string" && json.value.trim()) {
    return {
      secret: json.value,
      expiresAt: typeof json.expires_at === "number" ? json.expires_at : null,
      sessionId,
    };
  }

  if (typeof json.client_secret === "string" && json.client_secret.trim()) {
    return {
      secret: json.client_secret,
      expiresAt: typeof json.expires_at === "number" ? json.expires_at : null,
      sessionId,
    };
  }

  if (json.client_secret && typeof json.client_secret === "object") {
    const cs = json.client_secret as { value?: unknown; expires_at?: unknown };
    if (typeof cs.value === "string" && cs.value.trim()) {
      return {
        secret: cs.value,
        expiresAt: typeof cs.expires_at === "number" ? cs.expires_at : null,
        sessionId,
      };
    }
  }

  if (json.data && typeof json.data === "object") {
    const data = json.data as { value?: unknown; expires_at?: unknown };
    if (typeof data.value === "string" && data.value.trim()) {
      return {
        secret: data.value,
        expiresAt: typeof data.expires_at === "number" ? data.expires_at : null,
        sessionId,
      };
    }
  }

  return { secret: null, expiresAt: null, sessionId };
}

export async function createRealtimeSession(
  opts: RealtimeSessionCreateOptions,
): Promise<RealtimeSessionSuccess> {
  const { apiKey, model, voice, instructions, transcriptionModel, createResponse, fetchImpl = fetch } = opts;
  if (!apiKey.trim()) {
    throw new Error("OPENAI_API_KEY ontbreekt voor Realtime sessies.");
  }

  const response = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildRealtimeSessionPayload({
        model,
        voice,
        instructions,
        transcriptionModel,
        createResponse,
      }),
    ),
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(parseRealtimeErrorBody(json));
  }

  const parsed = extractClientSecretPayload(json);
  if (!parsed.secret) {
    throw new Error("Realtime sessie heeft geen client secret teruggegeven.");
  }

  return {
    clientSecret: parsed.secret,
    expiresAt: parsed.expiresAt,
    sessionId: parsed.sessionId,
    model,
    voice,
  };
}

async function handleRealtimeSession(
  res: import("express").Response,
  next: import("express").NextFunction,
  instructions: string,
  opts: { createResponse?: boolean } = {},
) {
  try {
    const apiKey = getOpenAiApiKey();
    const prereq = validateRealtimeSessionPrereqs({
      enabled: isRealtimeInterviewEnabled(),
      apiKey,
    });
    if (!prereq.ok) {
      res.status(prereq.status).json({ error: prereq.error });
      return;
    }

    const session = await createRealtimeSession({
      apiKey,
      model: getRealtimeModel(),
      voice: getRealtimeVoice(),
      instructions,
      transcriptionModel: getRealtimeTranscriptionModel(),
      createResponse: opts.createResponse,
    });

    res.json({
      clientSecret: session.clientSecret,
      expiresAt: session.expiresAt,
      sessionId: session.sessionId,
      model: session.model,
      voice: session.voice,
    });
  } catch (err) {
    next(err);
  }
}

realtimeRouter.post("/session", async (_req, res, next) => {
  await handleRealtimeSession(res, next, getRealtimeInstructions());
});

realtimeRouter.post("/session/supplement", async (_req, res, next) => {
  await handleRealtimeSession(res, next, getSupplementRealtimeInstructions(), {
    createResponse: false,
  });
});

realtimeRouter.post("/session/task-capture", async (_req, res, next) => {
  await handleRealtimeSession(res, next, getTaskCaptureRealtimeInstructions(), {
    createResponse: false,
  });
});

realtimeRouter.post("/session/event-capture", async (_req, res, next) => {
  await handleRealtimeSession(res, next, getEventCaptureRealtimeInstructions(), {
    createResponse: false,
  });
});

realtimeRouter.post("/session/listen", async (_req, res, next) => {
  try {
    const apiKey = getOpenAiApiKey();
    const prereq = validateRealtimeSessionPrereqs({
      enabled: isRealtimeInterviewEnabled(),
      apiKey,
    });
    if (!prereq.ok) {
      res.status(prereq.status).json({ error: prereq.error });
      return;
    }
    const model = getRealtimeModel();
    const voice = getRealtimeVoice();
    const transcriptionModel = getRealtimeTranscriptionModel();
    const instructions = getListenRealtimeInstructions();
    // Luister-sessie: VAD + transcriptie maar geen automatische AI-responses.
    // VAD-drempel (0.55) + ruisonderdrukking; echo tijdens voorlezen via software gefilterd.
    const payload = {
      session: {
        type: "realtime",
        model,
        instructions,
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              create_response: false,
              threshold: 0.55,
              silence_duration_ms: 700,
            },
            transcription: { model: transcriptionModel, language: "nl" },
            noise_reduction: { type: "near_field" },
          },
          output: { voice },
        },
      },
    };
    const resp = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      res.status(resp.status).json({ error: parseRealtimeErrorBody(json) });
      return;
    }
    const parsed = extractClientSecretPayload(json);
    if (!parsed.secret) {
      res.status(500).json({ error: "Realtime sessie heeft geen client secret teruggegeven." });
      return;
    }
    res.json({ clientSecret: parsed.secret, expiresAt: parsed.expiresAt, sessionId: parsed.sessionId, model, voice });
  } catch (err) {
    next(err);
  }
});

realtimeRouter.post("/session/review", async (_req, res, next) => {
  try {
    const apiKey = getOpenAiApiKey();
    const prereq = validateRealtimeSessionPrereqs({
      enabled: isRealtimeInterviewEnabled(),
      apiKey,
    });
    if (!prereq.ok) {
      res.status(prereq.status).json({ error: prereq.error });
      return;
    }
    const model = getRealtimeModel();
    const voice = getRealtimeVoice();
    const transcriptionModel = getRealtimeTranscriptionModel();
    const instructions = getReviewRealtimeInstructions();
    // Review session: VAD but no auto-response — we trigger each chunk manually.
    const payload = {
      session: {
        type: "realtime",
        model,
        instructions,
        audio: {
          input: {
            turn_detection: { type: "server_vad", create_response: false },
            transcription: { model: transcriptionModel, language: "nl" },
          },
          output: { voice },
        },
      },
    };
    const resp = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      res.status(resp.status).json({ error: parseRealtimeErrorBody(json) });
      return;
    }
    const parsed = extractClientSecretPayload(json);
    if (!parsed.secret) {
      res.status(500).json({ error: "Realtime sessie heeft geen client secret teruggegeven." });
      return;
    }
    res.json({ clientSecret: parsed.secret, expiresAt: parsed.expiresAt, sessionId: parsed.sessionId, model, voice });
  } catch (err) {
    next(err);
  }
});

realtimeRouter.post("/speech", async (req, res, next) => {
  try {
    const apiKey = getOpenAiApiKey();
    const prereq = validateSpeechPrereqs(apiKey);
    if (!prereq.ok) {
      res.status(prereq.status).json({ error: prereq.error });
      return;
    }

    const text = normalizeSpeechText(req.body?.text);
    if (!text) {
      res.status(400).json({ error: "Geen tekst om voor te lezen." });
      return;
    }

    const audio = await synthesizeOpenAiSpeech({
      text,
      apiKey,
      model: getSpeechModel(),
      voice: getSpeechVoice(),
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audio);
  } catch (err) {
    next(err);
  }
});
