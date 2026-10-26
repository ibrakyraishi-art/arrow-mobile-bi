/**
 * Простой in-memory rate limiter на Map. Работает в рамках одного процесса
 * Node.js — на serverless-инстансах с шардированием это «лучше чем ничего»,
 * но не строгий глобальный лимит. Достаточно, чтобы отбить случайные
 * флуды и недобросовестных клиентов.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      limit,
    };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit,
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    limit,
  };
}

export const RATE_LIMITS = {
  AI_ANALYZE: { limit: 60, windowMs: 60_000 },
  QUERY: { limit: 120, windowMs: 60_000 },
} as const;

// Периодически чистим устаревшие бакеты, чтобы Map не рос вечно.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }, 60_000).unref?.();
}
