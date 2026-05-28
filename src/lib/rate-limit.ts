import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  /** Max. requests per venster; 0 = uitgeschakeld */
  maxRequests: number;
  windowMs?: number;
  errorMessage?: string;
}

function clientKey(req: Request): string {
  const forwarded = req.header("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** In-memory rate limiter (per IP, sliding window). */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, Bucket>();
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests;
  const errorMessage =
    options.errorMessage ??
    "Te veel verzoeken. Probeer het over een minuut opnieuw.";

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    if (maxRequests <= 0) {
      next();
      return;
    }

    const key = clientKey(req);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, maxRequests - bucket.count)));

    if (bucket.count > maxRequests) {
      res.status(429).json({ error: errorMessage });
      return;
    }

    next();
  };
}

/** Zware endpoints: foto, LLM, Salesforce (standaard 30/min). */
export const rateLimitUploads = createRateLimiter({
  maxRequests: Number(process.env.MEGAMINNIE_RATE_LIMIT) || 30,
});

/** Transcriptie — interview gebruikt frequente korte checks (standaard 180/min). */
export const rateLimitTranscribe = createRateLimiter({
  maxRequests: Number(process.env.MEGAMINNIE_TRANSCRIBE_RATE_LIMIT) || 180,
});
