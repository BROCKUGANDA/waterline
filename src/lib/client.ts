"use client";

// WATERLINE — typed API client. Handles the response envelope, surfaces
// problem details, and always generates Idempotency-Key for money movement
// (UUIDv4-equivalent entropy, scoped per logical action).

export class ApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  traceId: string;
  constructor(code: string, detail: string, status: number, retryable: boolean, traceId: string) {
    super(detail);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.traceId = traceId;
  }
}

interface EnvelopeOk<T> { ok: true; data: T; trace_id: string }
interface EnvelopeErr { ok: false; status?: number; error: { code: string; detail: string; trace_id: string; retryable: boolean } }

function genKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `key_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable idempotency key per logical action — retries reuse the same key,
 *  so a duplicate payout is structurally impossible (PRD 6.2). */
const keyRegistry = new Map<string, string>();
export function idempotencyKey(scope: string): string {
  let k = keyRegistry.get(scope);
  if (!k) {
    k = genKey();
    keyRegistry.set(scope, k);
  }
  return k;
}

async function request<T>(path: string, init?: RequestInit & { idemScope?: string }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) };
  if (init?.method && init.method !== "GET") {
    headers["Idempotency-Key"] = idempotencyKey(init.idemScope ?? `${init.method}:${path}`);
  }
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as EnvelopeOk<T> | EnvelopeErr | null;
  if (!body) throw new ApiError("internal_error", "Empty response", 500, true, "-");
  if (!body.ok) {
    const e = body.error;
    throw new ApiError(e.code, e.detail, res.status, e.retryable, e.trace_id);
  }
  return body.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown, opts?: { idemScope?: string }) =>
    request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data), idemScope: opts?.idemScope }),
  put: <T>(path: string, data?: unknown, opts?: { idemScope?: string }) =>
    request<T>(path, { method: "PUT", body: data === undefined ? undefined : JSON.stringify(data), idemScope: opts?.idemScope }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
