import { createHash, randomBytes, timingSafeEqual } from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 12 chars from a 57-symbol alphabet, about 70 bits. */
export function newEventId(): string {
  const bytes = randomBytes(24);
  let out = "";
  for (const b of bytes) {
    if (b < 57 * 4) out += ALPHABET[b % 57];
    if (out.length === 12) break;
  }
  return out.length === 12 ? out : newEventId();
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string | null | undefined, hash: string | null | undefined): boolean {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
