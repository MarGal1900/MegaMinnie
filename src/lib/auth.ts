import type { Request, Response, NextFunction } from "express";

const apiKey = process.env.MEGAMINNIE_API_KEY?.trim();

/** Vereist X-API-Key wanneer MEGAMINNIE_API_KEY is gezet. */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!apiKey) {
    next();
    return;
  }

  const provided =
    req.header("X-API-Key") ??
    req.header("Authorization")?.replace(/^Bearer\s+/i, "");

  if (provided !== apiKey) {
    res.status(401).json({ error: "Ongeldige of ontbrekende API-sleutel" });
    return;
  }

  next();
}

export function isApiKeyRequired(): boolean {
  return Boolean(apiKey);
}
