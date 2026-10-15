// WATERLINE — API helpers. RFC 9457-style problem responses (PRD 5.3),
// success envelope, idempotency-key enforcement, and trace ids.

import { NextResponse } from "next/server";
import { shortId } from "./canonical";

export interface ApiOk<T> { ok: true; data: T; trace_id: string }
export interface ApiErr {
  ok: false;
  status: number;
  error: { code: string; detail: string; trace_id: string; retryable: boolean };
}

export function ok<T>(data: T, status = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true as const, data, trace_id: shortId("trc") }, { status });
}

export function problem(status: number, code: string, detail: string, retryable = false): NextResponse<ApiErr> {
  return NextResponse.json(
    { ok: false as const, status, error: { code, detail, trace_id: shortId("trc"), retryable } },
    { status }
  );
}

export const errors = {
  invalidRequest: (detail: string) => problem(400, "invalid_request", detail),
  unauthenticated: () => problem(401, "unauthenticated", "Token missing, expired or wrong audience."),
  consentRequired: () => problem(403, "consent_required", "This operation needs a consent that is absent or revoked."),
  notFound: (what: string) => problem(404, "not_found", `${what} is absent or outside your tenant scope.`),
  idempotencyConflict: () => problem(409, "idempotency_conflict", "Idempotency key reused with a different payload."),
  offerExpired: () => problem(409, "offer_expired", "The offer lapsed or the pack changed since the quote. Re-quote to see the new price."),
  duplicateInvoice: () => problem(409, "duplicate_invoice", "This invoice hash is already present. Surfacing the original."),
  ruleRejected: (code: string, detail: string) => problem(422, "rule_rejected", detail),
  killSwitchActive: (detail: string) => problem(423, "kill_switch_active", detail),
  rateLimited: () => problem(429, "rate_limited", "Quota exhausted. Honour Retry-After."),
  internal: () => problem(500, "internal_error", "Unexpected failure — already alerted. Safe to retry with an idempotency key.", true),
  degraded: (mode: string) => problem(503, "degraded", `Service is in declared degrade mode ${mode}. Read degrade_mode and adapt.`, true),
};

/** Extract and normalise an Idempotency-Key header (PRD 5.1). */
export function requireIdempotencyKey(req: Request): string | null {
  const key = req.headers.get("idempotency-key")?.trim();
  return key && key.length >= 8 ? key : null;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export const DEMO_TENANT = "t_8821";
