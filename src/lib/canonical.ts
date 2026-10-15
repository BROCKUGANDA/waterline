// WATERLINE — canonical serialisation and hashing (PRD 3.2).
// The feature snapshot is canonicalised (sorted keys, stable scalars) and hashed;
// replaying the same hash against the same pack version must produce a
// byte-identical outcome.

import { createHash } from "crypto";

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** SHA-256 hex with the PRD's `sha256:` prefix. */
export function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
}

/** Hash a feature snapshot canonically. */
export function hashSnapshot(snapshot: unknown): string {
  return sha256(canonicalJson(snapshot));
}

/** Short, stable, URL-safe id: prefix + 10 chars of base32 entropy. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function shortId(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % 32];
  return `${prefix}_${s}`;
}

/** Deterministic idempotency key derived from the offer id — a retry after an
 * ambiguous timeout cannot produce a second payment (PRD 6.2). */
export function payoutIdempotencyKey(offerId: string): string {
  return `pay_${sha256(`payout:${offerId}`).slice(7, 23)}`;
}
