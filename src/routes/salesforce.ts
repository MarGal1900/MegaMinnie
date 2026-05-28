import { Router } from "express";
import { CustomerHintsSchema } from "../types/salesforce-records.js";
import { getSalesforceConfigStatus } from "../lib/salesforce-config.js";
import { checkSalesforceConnection } from "../lib/salesforce-health.js";
import { salesforceConfigured } from "../services/salesforce.js";
import {
  matchSalesforceFromHints,
  searchSalesforceRecords,
} from "../services/salesforce-search.js";

export const salesforceRouter = Router();

/** GET /api/salesforce/status — configuratie + login-test */
salesforceRouter.get("/status", async (_req, res, next) => {
  try {
    const config = getSalesforceConfigStatus();
    if (!config.configured) {
      res.json({
        ...config,
        reachable: null,
        hint: "Vul ontbrekende variabelen in .env in. Zie docs/SALESFORCE.md.",
      });
      return;
    }

    const health = await checkSalesforceConnection(true);
    res.json({
      ...config,
      reachable: health?.reachable ?? false,
      userId: health?.userId,
      orgId: health?.orgId,
      error: health?.error,
      hint: config.dryRun
        ? "Login OK. Zet MEGAMINNIE_DRY_RUN=false voor live upload."
        : health?.reachable
          ? "Salesforce is klaar voor live upload."
          : health?.error,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/salesforce/search?q=... */
salesforceRouter.get("/search", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) {
      res.json({ configured: salesforceConfigured(), results: [] });
      return;
    }
    if (!salesforceConfigured()) {
      res.status(503).json({
        error: "Salesforce is niet geconfigureerd. Vul SF_* in .env in.",
        configured: false,
      });
      return;
    }
    const results = await searchSalesforceRecords(q);
    res.json({ configured: true, results });
  } catch (err) {
    next(err);
  }
});

/** POST /api/salesforce/match — zoek op geëxtraheerde klantgegevens */
salesforceRouter.post("/match", async (req, res, next) => {
  try {
    const parsed = CustomerHintsSchema.safeParse(req.body?.customer ?? req.body);
    const hints = parsed.success ? parsed.data : undefined;
    const link = await matchSalesforceFromHints(hints);
    res.json(link);
  } catch (err) {
    next(err);
  }
});
