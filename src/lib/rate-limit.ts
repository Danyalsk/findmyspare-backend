// In-memory sliding-window rate limiter. Suitable for single-instance Render
// deployment. Move to Redis when scaling horizontally.

type Bucket = { hits: number[]; }; // hits = timestamps (ms)

const buckets = new Map<string, Bucket>();

// Garbage-collect cold keys every 10 minutes so the map can't grow forever.
let gcStarted = false;
function startGc() {
  if (gcStarted) return;
  gcStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [k, b] of buckets) {
      const fresh = b.hits.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(k);
      else b.hits = fresh;
    }
  }, 10 * 60 * 1000).unref?.();
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetMs: number; // ms until oldest hit expires
};

export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  startGc();
  const now = Date.now();
  const cutoff = now - windowMs;
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => t > cutoff);
  if (b.hits.length >= max) {
    buckets.set(key, b);
    return { ok: false, remaining: 0, resetMs: b.hits[0]! + windowMs - now };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true, remaining: max - b.hits.length, resetMs: windowMs };
}

export function rateLimitKey(req: Request, prefix: string, suffix?: string): string {
  // Use forwarded IP if behind Render/Vercel proxy, else fall back to header.
  const fwd = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anon";
  const ip = fwd.split(",")[0]!.trim();
  return suffix ? `${prefix}:${ip}:${suffix}` : `${prefix}:${ip}`;
}
