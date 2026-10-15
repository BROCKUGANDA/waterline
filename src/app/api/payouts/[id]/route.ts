// WATERLINE — GET /api/payouts/[id]  (Task 2-b1; PRD 11.13, Part 8).
// The 4-stage honest pipeline: accepted → reserved → sent → settled. Time
// boundaries are deterministic (2.5s / 7s / etaSeconds from acceptedAt) and
// crossed timestamps are persisted as they are crossed, with an outbox event
// per transition. No stage is ever shown before it is true — an indeterminate
// state stays indeterminate.
//
// A QUEUED payout (accepted while the rail was down — mode M2 / open dupay
// breaker) is released here the moment the rail is back: the funding txn
// posts, the state flips queued → accepted and the pipeline starts fresh
// from that instant, so no fabricated progress is ever shown.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok } from "@/lib/api";
import { advancePayoutPipeline, pipelineView, releaseQueuedPayouts } from "@/lib/payout-queue";
import { ensureSeed } from "@/lib/seed";
import type { Payout } from "@prisma/client";

export const dynamic = "force-dynamic";

const STAGE_KEYS = ["accepted", "reserved", "sent", "settled"] as const;
const STAGE_LABELS = ["Accepted", "Reserved", "Sent", "Settled"] as const;

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await ensureSeed();
    const { id } = await ctx.params;

    const payout = await db.payout.findUnique({ where: { id } });
    if (!payout || payout.tenantId !== DEMO_TENANT) return errors.notFound("Payout");

    // ── Queue release (PRD Part 8): a queued payout drains the moment the
    // rail is back. releaseQueuedPayouts is idempotent and a no-op when the
    // rail is still down or the payout is not queued.
    let current = payout;
    if (current.state === "queued") {
      await releaseQueuedPayouts();
      current = await db.payout.findUniqueOrThrow({ where: { id } });
    }
    const p = current;

    if (p.state === "queued") {
      // Still queued — the rail is still down. Honest indeterminate state:
      // no stages, no elapsed timer, just the locked amount and the reason.
      return ok({
        ...serializePayout(p),
        stage: "queued",
        stageIndex: -1,
        stages: STAGE_KEYS.map((key, i) => ({
          key,
          label: STAGE_LABELS[i],
          at: null,
        })),
        elapsedMs: 0,
        etaSeconds: p.etaSeconds > 0 ? p.etaSeconds : 16,
      });
    }

    // Advance the pipeline to the stage elapsed honest time dictates, then
    // derive the view from the persisted timestamps (never fabricated).
    const fresh = await advancePayoutPipeline(p);
    const view = pipelineView(fresh);
    return ok({
      ...serializePayout(fresh),
      stage: view.stage,
      stageIndex: view.stageIndex,
      stages: view.stages.map((s, i) => ({ ...s, label: STAGE_LABELS[i] })),
      elapsedMs: view.elapsedMs,
      etaSeconds: view.etaSeconds,
    });
  } catch (e) {
    console.error("[api/payouts/[id]]", e);
    return errors.internal();
  }
}
