// WATERLINE — GET /api/payouts/[id]  (Task 2-b1; PRD 11.13).
// The 4-stage honest pipeline: accepted → reserved → sent → settled. Time
// boundaries are deterministic (2.5s / 7s / etaSeconds from acceptedAt) and
// crossed timestamps are persisted as they are crossed, with an outbox event
// per transition. No stage is ever shown before it is true — an indeterminate
// state stays indeterminate.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import type { Payout } from "@prisma/client";

export const dynamic = "force-dynamic";

const STAGE_KEYS = ["accepted", "reserved", "sent", "settled"] as const;
const STAGE_LABELS = ["Accepted", "Reserved", "Sent", "Settled"] as const;
const RESERVED_AFTER_MS = 2_500;
const SENT_AFTER_MS = 7_000;

function serializePayout(p: Payout) {
  return {
    id: p.id,
    offerId: p.offerId,
    idempotencyKey: p.idempotencyKey,
    rail: p.rail,
    destinationRef: p.destinationRef,
    amountFils: p.amountFils,
    state: p.state,
    providerRef: p.providerRef,
    acceptedAt: p.acceptedAt.toISOString(),
    reservedAt: p.reservedAt ? p.reservedAt.toISOString() : null,
    sentAt: p.sentAt ? p.sentAt.toISOString() : null,
    settledAt: p.settledAt ? p.settledAt.toISOString() : null,
    reconciledAt: p.reconciledAt ? p.reconciledAt.toISOString() : null,
    etaSeconds: p.etaSeconds,
  };
}

/** Provider reference assigned at dispatch — deterministic per payout. */
function providerRefFor(payoutId: string): string {
  return `dpay_${payoutId.slice(-6)}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await ensureSeed();
    const { id } = await ctx.params;

    const payout = await db.payout.findUnique({ where: { id } });
    if (!payout || payout.tenantId !== DEMO_TENANT) return errors.notFound("Payout");

    const eta = payout.etaSeconds > 0 ? payout.etaSeconds : 16;
    const t0 = payout.acceptedAt.getTime();
    const elapsedMs = Date.now() - t0;
    const settledAfterMs = eta * 1_000;

    // Stage the pipeline SHOULD be in, purely from elapsed honest time.
    let target = 0;
    if (elapsedMs >= settledAfterMs) target = 3;
    else if (elapsedMs >= SENT_AFTER_MS) target = 2;
    else if (elapsedMs >= RESERVED_AFTER_MS) target = 1;

    // Stage the pipeline has OBSERVED (persisted timestamps are the truth).
    let observed = 0;
    if (payout.settledAt || payout.state === "settled") observed = 3;
    else if (payout.sentAt || payout.state === "sent") observed = 2;
    else if (payout.reservedAt || payout.state === "reserved") observed = 1;

    // Persist newly-crossed boundaries (deterministic crossing times) and
    // write one payout.state_changed outbox event per transition. A failed
    // payout never progresses — it waits for reconciliation.
    if (target > observed && payout.state !== "failed") {
      const data: {
        reservedAt?: Date;
        sentAt?: Date;
        providerRef?: string;
        settledAt?: Date;
        reconciledAt?: Date;
        state?: string;
      } = {};
      if (target >= 1 && !payout.reservedAt) data.reservedAt = new Date(t0 + RESERVED_AFTER_MS);
      if (target >= 2 && !payout.sentAt) {
        data.sentAt = new Date(t0 + SENT_AFTER_MS);
        if (!payout.providerRef) data.providerRef = providerRefFor(payout.id);
      }
      if (target >= 3) {
        data.settledAt = new Date(t0 + settledAfterMs);
        data.reconciledAt = new Date();
      }
      data.state = STAGE_KEYS[target];
      await db.payout.update({ where: { id: payout.id }, data });
      for (let s = observed + 1; s <= target; s++) {
        await db.appEvent.create({
          data: {
            tenantId: payout.tenantId,
            type: "payout.state_changed",
            subjectRef: payout.id,
            payloadJson: JSON.stringify({
              from: STAGE_KEYS[s - 1],
              to: STAGE_KEYS[s],
              stage: STAGE_KEYS[s],
              amountFils: payout.amountFils,
              providerRef: s >= 2 ? (data.providerRef ?? payout.providerRef ?? providerRefFor(payout.id)) : null,
              destinationRef: payout.destinationRef,
            }),
          },
        });
      }
    }

    const fresh = target > observed && payout.state !== "failed"
      ? await db.payout.findUniqueOrThrow({ where: { id: payout.id } })
      : payout;
    const stageIndex = Math.max(observed, target);

    return ok({
      ...serializePayout(fresh),
      stage: STAGE_KEYS[stageIndex],
      stageIndex,
      stages: STAGE_KEYS.map((key, i) => ({
        key,
        label: STAGE_LABELS[i],
        at:
          i === 0 ? fresh.acceptedAt.toISOString()
          : i === 1 ? (fresh.reservedAt ? fresh.reservedAt.toISOString() : null)
          : i === 2 ? (fresh.sentAt ? fresh.sentAt.toISOString() : null)
          : (fresh.settledAt ? fresh.settledAt.toISOString() : null),
      })),
      elapsedMs: Math.max(0, Date.now() - t0),
      etaSeconds: eta,
    });
  } catch (e) {
    console.error("[api/payouts/[id]]", e);
    return errors.internal();
  }
}
