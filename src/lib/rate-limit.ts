import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Per-IP, per-form rate limiting (audit S-03, decision Q4: Upstash Redis).
 * Sliding window: 5 requests / 10 minutes per IP per form.
 *
 * Graceful degradation: when the Upstash env vars are unset the limiter is a
 * no-op (always allows) so local dev and secretless builds keep working.
 */
const WINDOW_LIMIT = 5;
const WINDOW = "10 m";

const limiters = new Map<string, Ratelimit>();
let redis: Redis | null = null;

function getLimiter(form: string, limit: number): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const existing = limiters.get(form);
  if (existing) return existing;

  redis ??= new Redis({ url, token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    prefix: `rl:${form}`,
  });
  limiters.set(form, limiter);
  return limiter;
}

/**
 * Returns true when the request is allowed. `limit` overrides the 5/10min
 * default for multi-request flows (M-21 document uploads send 4+ files plus
 * retries in one sitting — S-03 still caps them, just wider).
 */
export async function checkRateLimit(
  form: string,
  ip: string,
  limit: number = WINDOW_LIMIT,
): Promise<boolean> {
  const limiter = getLimiter(form, limit);
  if (!limiter) {
    console.warn("[rate-limit] Upstash env unset — limiter disabled (dev mode)");
    return true;
  }
  try {
    const { success } = await limiter.limit(ip);
    return success;
  } catch (err) {
    // Redis outage must not take lead capture down — allow and log (S-03
    // defense in depth: Turnstile still gates the request).
    console.error("[rate-limit] limiter error — allowing request", err);
    return true;
  }
}
