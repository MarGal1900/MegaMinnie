import { Router } from "express";
import multer from "multer";
import {
  MegaMinnieOutputSchema,
  type MegaMinnieOutput,
} from "../types/visit-report.js";
import { rateLimitTranscribe, rateLimitUploads } from "../lib/rate-limit.js";
import {
  extendVisitReport,
  processVisitReport,
  processVisitReportFromPhotos,
  syncVisitReportToSalesforce,
} from "../services/visit-report-pipeline.js";
import {
  extractTextFromDocument,
  isSupportedDocument,
} from "../services/document-extract.js";
import { transcribeAudio, isSupportedAudio } from "../services/transcription.js";
import {
  processConversationReport,
  transcribeConversationChunk,
} from "../services/conversation-pipeline.js";
import { runEmailDraftAgent } from "../agent/email-draft-agent.js";
import {
  ConversationAnalysisSchema,
  type ConversationAnalysis,
} from "../types/visit-report.js";
import { prepareImageForApi } from "../lib/image-prepare.js";
import {
  extractTextFromPhotos,
  guessImageMimeType,
  isSupportedImage,
} from "../services/vision.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 11 },
});

export const visitReportRouter = Router();

function parseExistingMegaMinnie(body: Record<string, unknown>): MegaMinnieOutput | null {
  const raw = body.existing;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = MegaMinnieOutputSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function getField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** POST /api/visit-report/transcribe — alleen speech-to-text (interview-antwoorden) */
visitReportRouter.post(
  "/transcribe",
  rateLimitTranscribe,
  upload.single("audio"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file?.size) {
        res.status(400).json({ error: "Veld 'audio' is verplicht" });
        return;
      }
      if (!isSupportedAudio(file.mimetype)) {
        res.status(400).json({ error: `Audioformaat niet ondersteund: ${file.mimetype}` });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const transcription = await transcribeAudio(
        file.buffer,
        file.originalname,
        file.mimetype,
        {
          prompt: getField(body, "prompt"),
          useDomainPrompt: getField(body, "useDomainPrompt") !== "false",
        },
      );
      res.json({
        text: transcription.text,
        qualityWarning: transcription.qualityWarning,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/visit-report/voice — audio → transcript → MegaMinnie → optioneel Salesforce */
visitReportRouter.post(
  "/voice",
  rateLimitUploads,
  upload.single("audio"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Veld 'audio' is verplicht (multipart)" });
        return;
      }
      if (!file.size) {
        res.status(400).json({ error: "Audiobestand is leeg" });
        return;
      }
      if (!isSupportedAudio(file.mimetype)) {
        res.status(400).json({ error: `Audioformaat niet ondersteund: ${file.mimetype}` });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const transcription = await transcribeAudio(
        file.buffer,
        file.originalname,
        file.mimetype,
        {
          useDomainPrompt: true,
          diarize: getField(body, "diarize") === "true",
        },
      );
      const rawText = transcription.text;
      const result = await processVisitReport({
        source: "voice",
        rawText,
        context: getField(body, "context"),
      });

      res.json({
        ...result,
        transcript: rawText,
        qualityWarning: transcription.qualityWarning,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/visit-report/photo — foto('s) → tekst → MegaMinnie */
visitReportRouter.post(
  "/photo",
  rateLimitUploads,
  upload.array("photos", 10),
  async (req, res, next) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        res.status(400).json({
          error: "Upload minimaal één foto (veld 'photos')",
        });
        return;
      }

      for (const file of files) {
        if (!isSupportedImage(file.mimetype, file.originalname)) {
          res.status(400).json({
            error: `Afbeelding niet ondersteund: ${file.originalname} (${file.mimetype || "onbekend type"})`,
          });
          return;
        }
      }

      const result = await processVisitReportFromPhotos(
        files.map((f) => ({
          buffer: f.buffer,
          mimeType: isSupportedImage(f.mimetype)
            ? f.mimetype
            : guessImageMimeType(f.originalname),
        })),
        getField(req.body as Record<string, unknown>, "context"),
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/visit-report/extract-text — Word/PDF/txt → platte tekst */
visitReportRouter.post(
  "/extract-text",
  rateLimitUploads,
  upload.single("document"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Veld 'document' is verplicht" });
        return;
      }
      if (!isSupportedDocument(file.mimetype, file.originalname)) {
        res.status(400).json({
          error: `Document niet ondersteund: ${file.originalname}`,
        });
        return;
      }

      const text = await extractTextFromDocument(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      res.json({ text, filename: file.originalname });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/visit-report/extend — bestaand concept + audio of foto('s) */
visitReportRouter.post(
  "/extend",
  rateLimitUploads,
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "photos", maxCount: 10 },
  ]),
  async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const existing = parseExistingMegaMinnie(body);
      if (!existing) {
        res.status(400).json({
          error: "Veld 'existing' is verplicht (JSON van het huidige concept)",
        });
        return;
      }

      const supplementText = getField(body, "supplementText");
      if (supplementText) {
        const result = await extendVisitReport({
          existing,
          supplementRawText: supplementText,
          supplementSource: "voice",
        });
        res.json({ ...result, transcript: supplementText, extended: true });
        return;
      }

      const files = req.files as
        | { audio?: Express.Multer.File[]; photos?: Express.Multer.File[] }
        | undefined;
      const audioFile = files?.audio?.[0];
      const photoFiles = files?.photos ?? [];

      if (audioFile?.size) {
        if (!isSupportedAudio(audioFile.mimetype)) {
          res.status(400).json({
            error: `Audioformaat niet ondersteund: ${audioFile.mimetype}`,
          });
          return;
        }
        const transcription = await transcribeAudio(
          audioFile.buffer,
          audioFile.originalname,
          audioFile.mimetype,
          { useDomainPrompt: true },
        );
        const rawText = transcription.text;
        const result = await extendVisitReport({
          existing,
          supplementRawText: rawText,
          supplementSource: "voice",
        });
        res.json({
          ...result,
          transcript: rawText,
          qualityWarning: transcription.qualityWarning,
        });
        return;
      }

      if (photoFiles.length) {
        for (const file of photoFiles) {
          if (!isSupportedImage(file.mimetype, file.originalname)) {
            res.status(400).json({
              error: `Afbeelding niet ondersteund: ${file.originalname}`,
            });
            return;
          }
        }
        const prepared = await Promise.all(
          photoFiles.map((f) =>
            prepareImageForApi(
              f.buffer,
              isSupportedImage(f.mimetype)
                ? f.mimetype
                : guessImageMimeType(f.originalname),
            ),
          ),
        );
        const rawText = await extractTextFromPhotos(prepared);
        if (!rawText.trim()) {
          res.status(400).json({
            error: "Geen tekst uit de foto's gehaald — probeer een scherpere foto.",
          });
          return;
        }
        const result = await extendVisitReport({
          existing,
          supplementRawText: rawText,
          supplementSource: "photo",
        });
        res.json(result);
        return;
      }

      res.status(400).json({
        error: "Upload audio (veld 'audio') of minimaal één foto (veld 'photos')",
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/visit-report/text — tekst (getypt, geplakt of uit document) */
visitReportRouter.post("/text", rateLimitUploads, async (req, res, next) => {
  try {
    const { text, context, source } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Veld 'text' is verplicht" });
      return;
    }

    const result = await processVisitReport({
      source:
        source === "photo"
          ? "photo"
          : source === "interview"
            ? "interview"
            : source === "conversation"
              ? "conversation"
              : "voice",
      rawText: text.trim(),
      context: typeof context === "string" ? context : undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/visit-report/conversation/transcribe — één audioblob/chunk met sprekerherkenning */
visitReportRouter.post(
  "/conversation/transcribe",
  rateLimitTranscribe,
  upload.single("audio"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file?.size) {
        res.status(400).json({ error: "Veld 'audio' is verplicht" });
        return;
      }
      if (!isSupportedAudio(file.mimetype)) {
        res.status(400).json({ error: `Audioformaat niet ondersteund: ${file.mimetype}` });
        return;
      }

      const transcription = await transcribeConversationChunk(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      res.json({
        text: transcription.text,
        segments: transcription.segments,
        qualityWarning: transcription.qualityWarning,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/visit-report/conversation — volledig transcript → Claude → verslag */
visitReportRouter.post("/conversation", rateLimitUploads, async (req, res, next) => {
  try {
    const { transcript, context, recordId } = req.body ?? {};
    if (typeof transcript !== "string" || !transcript.trim()) {
      res.status(400).json({ error: "Veld 'transcript' is verplicht" });
      return;
    }

    const result = await processConversationReport(
      transcript.trim(),
      typeof context === "string" ? context : undefined,
      typeof recordId === "string" ? recordId : undefined,
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/visit-report/email-draft — LLM e-mailconcept afgestemd op het gesprek */
visitReportRouter.post("/email-draft", rateLimitUploads, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const meetingSubject = getField(body, "meetingSubject");
    if (!meetingSubject) {
      res.status(400).json({ error: "Veld 'meetingSubject' is verplicht" });
      return;
    }

    const meetingDate = getField(body, "meetingDate");
    if (!meetingDate) {
      res.status(400).json({ error: "Veld 'meetingDate' is verplicht" });
      return;
    }

    let conversationAnalysis: ConversationAnalysis | undefined;
    if (body.conversationAnalysis != null) {
      const parsed = ConversationAnalysisSchema.safeParse(body.conversationAnalysis);
      if (!parsed.success) {
        res.status(400).json({
          error: "Ongeldige conversationAnalysis",
          details: parsed.error.flatten(),
        });
        return;
      }
      conversationAnalysis = parsed.data;
    }

    const source = body.source;
    const validSource =
      source === "voice" ||
      source === "photo" ||
      source === "interview" ||
      source === "conversation"
        ? source
        : undefined;

    const draft = await runEmailDraftAgent({
      meetingSubject,
      contactName: getField(body, "contactName"),
      meetingDate,
      summary: getField(body, "summary"),
      conversationAnalysis,
      source: validSource,
    });

    res.json(draft);
  } catch (err) {
    next(err);
  }
});

/** POST /api/visit-report/sync — bewerkte notitie + taken/events naar Salesforce */
visitReportRouter.post("/sync", rateLimitUploads, async (req, res, next) => {
  try {
    const { recordId, megaMinnie, rawInput, source } = req.body ?? {};
    if (typeof recordId !== "string" || !recordId.trim()) {
      res.status(400).json({ error: "Veld 'recordId' is verplicht" });
      return;
    }
    const parsed = MegaMinnieOutputSchema.safeParse(megaMinnie);
    if (!parsed.success) {
      res.status(400).json({
        error: "Ongeldige MegaMinnie-data",
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await syncVisitReportToSalesforce({
      recordId: recordId.trim(),
      megaMinnie: parsed.data,
      rawInput: typeof rawInput === "string" ? rawInput : "",
      source:
        source === "photo"
          ? "photo"
          : source === "interview"
            ? "interview"
            : source === "conversation"
              ? "conversation"
              : "voice",
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
