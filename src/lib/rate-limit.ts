// Lightweight in-memory fixed-window rate limiter. Server-only.
//
// NOTE: this is per-process. For multi-instance deployments move this to a shared
// store (Redis). Good enough to blunt brute-force / abuse on a single instance.

interface Window {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Window>();

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, retryAfterSec: 0 };
  }
  if (w.count >= max) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  }
  w.count += 1;
  return { ok: true, remaining: max - w.count, retryAfterSec: 0 };
}

/** Best-effort client key from a request (proxy-aware). */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Periodically drop expired buckets so the map can't grow unbounded.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, w] of buckets) if (now >= w.resetAt) buckets.delete(k);
}, 60_000);
// Don't keep the event loop alive just for the sweeper.
if (typeof sweep.unref === "function") sweep.unref();
