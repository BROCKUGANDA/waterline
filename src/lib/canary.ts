// WATERLINE — the CANARY phase of the PRD 3.3 promotion lifecycle.
// Author → Shadow → CANARY → Promote. The shadow phase (round 9) scores
// every live base-pack quote against the candidate in parallel; the canary
// phase goes one honest step further: a deterministic 5% bucket of quote
// traffic is SERVED by the candidate pack — the decisions are real, they are
// recorded against the candidate version, and replay stays byte-identical
// (the row names the pack that decided, exactly as PRD 3.2 demands).
//
// Routing is DETERMINISTIC, never random: the bucket is derived from the
// feature-snapshot input hash, so the same invoice state always routes the
// same way — a re-quote cannot hop buckets, and the traffic share is a
// published, auditable constant rather than a coin flip.
//
// Automatic rollback (PRD 3.3): any automatic guardrail escalation
// (M1/M2/M3) withdraws the canary — a degraded platform invalidates the
// experiment, and the withdrawal is written to the append-only operator
// audit store with the escalation reason. Offers already quoted under the
// candidate are honoured at acceptance only while the canary that priced
// them is still active; after a rollback they re-quote under the base pack
// (a changed price is surfaced explicitly, never applied silently — PRD 6.2).

import { db } from "@/lib/db";

/** Published traffic share: 500 permyriad = 5.0% of quote traffic. */
export const CANARY_TRAFFIC_PERMYRIAD = 500;

export interface CanaryState {
  /** When the canary was promoted (ISO timestamp). */
  since: string;
  /** Traffic share in permyriad — always 500 (5%) in this build; carried on
   * the record so the published figure is data, not a caption. */
  trafficPermyriad: number;
  promotedBy: string;
  reason: string;
}

/** Parse the persisted canary state; null when the candidate is not
 * canaried. A malformed record is treated as not-canaried — the base pack
 * is the safe default, and the ops console shows the honest null state. */
export async function canaryState(): Promise<CanaryState | null> {
  try {
    const st = await db.statusState.findUnique({ where: { id: "singleton" }, select: { canaryJson: true } });
    if (!st?.canaryJson) return null;
    const parsed = JSON.parse(st.canaryJson) as Partial<CanaryState>;
    if (
      typeof parsed.since !== "string" ||
      typeof parsed.trafficPermyriad !== "number" ||
      typeof parsed.promotedBy !== "string" ||
      typeof parsed.reason !== "string"
    ) {
      return null;
    }
    return {
      since: parsed.since,
      trafficPermyriad: parsed.trafficPermyriad,
      promotedBy: parsed.promotedBy,
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}

/** Deterministic bucket 0–9999 from the snapshot input hash. The last eight
 * hex characters give a stable 32-bit slice; modulo 10,000 distributes the
 * bucket space evenly. Same hash → same bucket, forever. */
export function canaryBucket(inputHash: string): number {
  const tail = inputHash.slice(-8);
  const n = Number.parseInt(tail, 16);
  if (Number.isNaN(n)) return 10_000; // never routes — fail safe to base
  return n % 10_000;
}

/** Does this request route to the candidate? Only while M0 holds and the
 * canary is promoted — M1's cautious delta is its own experiment and must
 * never be conflated with the candidate (same discipline as the shadow).
 * The bucket (0–9999) routes when it falls inside the traffic share:
 * bucket/10,000 < trafficPermyriad/10,000 — plain integer comparison. */
export function routesToCanary(inputHash: string, mode: string | null | undefined, state: CanaryState | null): boolean {
  if (state === null) return false;
  if (mode !== "M0") return false;
  return canaryBucket(inputHash) < state.trafficPermyriad;
}

/** Promote / withdraw, with the append-only audit trail. Returns the new
 * state. The caller validates the two-person reason. */
export async function setCanary(
  next: CanaryState | null,
  actor: string,
  action: "canary_promote" | "canary_withdraw" | "canary_auto_rollback",
  reason: string,
  detail?: Record<string, unknown>,
): Promise<CanaryState | null> {
  await db.$transaction(async (tx) => {
    await tx.statusState.update({
      where: { id: "singleton" },
      data: { canaryJson: next === null ? null : JSON.stringify(next) },
    });
    await tx.operatorAction.create({
      data: {
        actor,
        action,
        targetRef: "rulepack:candidate",
        reason,
        detailJson: JSON.stringify({
          canary: next,
          ...(detail ?? {}),
        }),
      },
    });
  });
  return next;
}

/** Auto-rollback hook — called by the guardrail engine when an automatic
 * escalation fires. Best-effort by design (a rollback failure must never
 * fail the escalation); idempotent when the canary is already withdrawn. */
export async function autoRollbackCanary(escalationReason: string, appliedMode: string): Promise<boolean> {
  const current = await canaryState();
  if (current === null) return false;
  try {
    await setCanary(
      null,
      "system:guardrails",
      "canary_auto_rollback",
      `automatic — guardrail escalation to ${appliedMode} withdraws the canary. A degraded platform invalidates the experiment; the base pack serves all traffic again. Escalation: ${escalationReason}`,
      { escalatedTo: appliedMode },
    );
    return true;
  } catch {
    return false;
  }
}
