import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { formatApiError } from "./lib/api-errors.js";
import {
  getLlmProvider,
  isLlmConfigured,
} from "./lib/llm-config.js";
import { getWhisperProvider, isWhisperConfigured } from "./lib/whisper-config.js";
import { isWhisperServiceReachable } from "./lib/whisper-health.js";
import { isApiKeyRequired, requireApiKey } from "./lib/auth.js";
import { isKeepInputEnabled } from "./lib/keep-input.js";
import { isRealtimeInterviewEnabled } from "./lib/realtime-config.js";
import { getSalesforceConfigStatus } from "./lib/salesforce-config.js";
import { checkSalesforceConnection } from "./lib/salesforce-health.js";
import { getMailSignature } from "./lib/mail-config.js";
import { getDefaultAccountManager } from "./lib/task-assignee-config.js";
import { salesforceRouter } from "./routes/salesforce.js";
import { realtimeRouter } from "./routes/realtime.js";
import { shareReportRouter } from "./routes/share-report.js";
import { visitReportRouter } from "./routes/visit-report.js";
import { voiceRouter } from "./routes/voice.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST ?? "127.0.0.1";
const publicDir = path.join(process.cwd(), "public");

app.use(express.json({ limit: "2mb" }));

app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "microphone=(self), camera=(self)");
  next();
});

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", async (_req, res) => {
  const llmProvider = getLlmProvider();
  const llmConfigured = isLlmConfigured();
  const whisperConfigured = isWhisperConfigured();
  const whisperProvider = whisperConfigured ? getWhisperProvider() : null;
  const whisperReachable =
    whisperProvider === "local" ? await isWhisperServiceReachable() : null;

  const sfStatus = getSalesforceConfigStatus();
  const sfHealth = sfStatus.configured
    ? await checkSalesforceConnection()
    : null;

  let hint: string | undefined;
  if (!llmConfigured) {
    hint =
      llmProvider === "anthropic"
        ? "Zet ANTHROPIC_API_KEY in .env (bedrijfs-Claude API-sleutel)"
        : "Zet OPENAI_API_KEY in .env (zie .env.example)";
  } else if (whisperProvider === "local" && !whisperReachable) {
    hint =
      "Whisper lokaal niet bereikbaar. Start met: npm run whisper:up (Docker, poort 8000).";
  } else if (!sfStatus.configured) {
    hint =
      "Salesforce: vul SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME en SF_PASSWORD in .env in. Zie docs/SALESFORCE.md.";
  } else if (sfHealth && !sfHealth.reachable) {
    hint = sfHealth.error ?? "Salesforce-login mislukt. Controleer credentials in .env.";
  } else if (sfStatus.configured && sfStatus.dryRun) {
    hint =
      "Salesforce staat klaar. Zet MEGAMINNIE_DRY_RUN=false in .env voor live upload.";
  }

  res.json({
    ok: llmConfigured && (whisperProvider !== "local" || Boolean(whisperReachable)),
    service: "megaminnie",
    llmProvider,
    dryRun: process.env.MEGAMINNIE_DRY_RUN === "true",
    llmConfigured,
    whisperConfigured,
    whisperProvider,
    whisperReachable,
    salesforceConfigured: sfStatus.configured,
    salesforceReachable: sfHealth?.reachable ?? null,
    salesforceDryRun: sfStatus.dryRun,
    salesforceLiveUpload: sfStatus.liveUploadEnabled,
    apiKeyRequired: isApiKeyRequired(),
    keepInput: isKeepInputEnabled(),
    realtimeInterviewEnabled: isRealtimeInterviewEnabled(),
    mailSignature: getMailSignature(),
    defaultAccountManager: getDefaultAccountManager(),
    hint,
  });
});

app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use("/api", requireApiKey);
app.use("/api/visit-report", visitReportRouter);
app.use("/api/share-report", shareReportRouter);
app.use("/api/salesforce", salesforceRouter);
app.use("/api/realtime", realtimeRouter);
app.use("/api/voice", voiceRouter);
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html") || filePath.endsWith("app.js")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error:
            "Bestand te groot (max. 25 MB). Neem korter op of exporteer als kleiner audiobestand.",
        });
        return;
      }
    }
    const message = formatApiError(err);
    const status =
      err && typeof err === "object" && "status" in err && typeof err.status === "number"
        ? err.status >= 400 && err.status < 600
          ? err.status
          : 500
        : 500;
    res.status(status).json({ error: message });
  },
);

export default app;

if (!process.env.VERCEL) {
  app.listen(port, host, () => {
    console.log(`MegaMinnie: http://${host}:${port}`);
  });
}

