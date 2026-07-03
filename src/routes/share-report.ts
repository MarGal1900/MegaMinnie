import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  isLocalShareStorageEnabled,
  isOutlookComposeAutomationEnabled,
  isSafeBezoekverslagFilename,
  resolveBezoekverslagenDir,
} from "../lib/bezoekverslagen-dir.js";
import { convertDocxToPdf } from "../services/docx-to-pdf.js";
import { saveGespreksverslagDocx } from "../services/gespreksverslag-export.js";
import { openOutlookWithAttachment } from "../services/outlook-compose.js";

export const shareReportRouter = Router();

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRecipients(value: unknown): string[] {
  return parseStringArray(value).filter((email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  );
}

/** POST /api/share-report/prepare — DOCX opslaan, PDF maken, Outlook openen met bijlage */
shareReportRouter.post("/prepare", async (req, res, next) => {
  try {
    if (!isLocalShareStorageEnabled()) {
      res.status(503).json({
        error:
          "Lokaal opslaan is niet beschikbaar op deze omgeving. Gebruik de browser-download.",
      });
      return;
    }

    const meetingSubject =
      typeof req.body?.meetingSubject === "string" ? req.body.meetingSubject.trim() : "";
    const reportBody =
      typeof req.body?.reportBody === "string" ? req.body.reportBody.trim() : "";
    const dateTimeLabel =
      typeof req.body?.dateTimeLabel === "string" ? req.body.dateTimeLabel.trim() : null;
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const mailBody = typeof req.body?.mailBody === "string" ? req.body.mailBody : "";
    const recipients = parseRecipients(req.body?.recipients);

    if (!reportBody) {
      res.status(400).json({ error: "Er is nog geen verslag om te delen." });
      return;
    }
    if (!subject || !mailBody) {
      res.status(400).json({ error: "Onderwerp en mailtekst zijn verplicht." });
      return;
    }

    const saved = await saveGespreksverslagDocx({
      meetingSubject: meetingSubject || "Meeting",
      dateTimeLabel,
      reportBody,
    });
    const pdfFilename = `${saved.basename}.pdf`;
    const pdfPath = path.join(resolveBezoekverslagenDir(), pdfFilename);

    await convertDocxToPdf(saved.docxPath, pdfPath);

    let mailOpened = false;
    let mailError: string | undefined;
    if (isOutlookComposeAutomationEnabled()) {
      try {
        await openOutlookWithAttachment({
          recipients,
          subject,
          body: mailBody,
          attachmentPath: pdfPath,
        });
        mailOpened = true;
      } catch (err) {
        mailError =
          err instanceof Error
            ? err.message
            : "Outlook kon niet worden geopend met de PDF-bijlage.";
      }
    }

    res.json({
      ok: true,
      docxFilename: saved.docxFilename,
      pdfFilename,
      docxPath: saved.docxPath,
      pdfPath,
      bezoekverslagenDir: resolveBezoekverslagenDir(),
      mailOpened,
      mailError,
      pdfDownloadUrl: `/api/share-report/files/${encodeURIComponent(pdfFilename)}`,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/share-report/files/:filename — download opgeslagen DOCX/PDF */
shareReportRouter.get("/files/:filename", async (req, res, next) => {
  try {
    if (!isLocalShareStorageEnabled()) {
      res.status(503).json({ error: "Bestanden niet beschikbaar op deze omgeving." });
      return;
    }

    const filename = req.params.filename;
    if (!isSafeBezoekverslagFilename(filename)) {
      res.status(400).json({ error: "Ongeldige bestandsnaam." });
      return;
    }

    const filePath = path.join(resolveBezoekverslagenDir(), filename);
    const data = await readFile(filePath);
    const mime = filename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(data);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      res.status(404).json({ error: "Bestand niet gevonden." });
      return;
    }
    next(err);
  }
});
