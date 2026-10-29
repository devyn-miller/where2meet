/**
 * Fixed-window rate limiter kept in process memory. Good enough for a single
 * instance; with several instances each one enforces its own budget.
 */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(private now: () => number = Date.now) {}

  /** Returns true if the request is allowed. */
  take(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      this.sweep(t, windowMs);
      return true;
    }
    if (h.count >= limit) return false;
    h.count += 1;
    return true;
  }

  private sweep(t: number, windowMs: number) {
    if (this.hits.size < 10_000) return;
    for (const [k, h] of this.hits) if (t - h.start >= windowMs) this.hits.delete(k);
  }
}

export const limiter: RateLimiter = ((globalThis as { __w2mLimiter?: RateLimiter }).__w2mLimiter ??= new RateLimiter());

export type LimitKind = "read" | "write" | "geocode" | "places" | "create";

/** [per-IP limit, per-event limit] per minute. */
export const LIMITS: Record<LimitKind, [number, number]> = {
  read: [240, 1200],
  write: [60, 300],
  geocode: [30, 120],
  places: [20, 60],
  create: [10, 10],
};

export function allow(kind: LimitKind, ip: string, eventId?: string): boolean {
  const [perIp, perEvent] = LIMITS[kind];
  if (!limiter.take(`${kind}:ip:${ip}`, perIp, 60_000)) return false;
  if (eventId && !limiter.take(`${kind}:ev:${eventId}`, perEvent, 60_000)) return false;
  return true;
}
