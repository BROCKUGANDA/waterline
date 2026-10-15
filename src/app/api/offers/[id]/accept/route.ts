// WATERLINE — POST /api/offers/[id]/accept  (Task 2-b1; PRD 4.3-03/04, 6.2, Part 8).
// Accept an early-payment offer. The server re-validates everything the SME
// saw on screen: offer state, expiry, rule-pack version and the price
// recomputed from the SAME hashed feature snapshot — a changed price is
// surfaced explicitly and never applied silently. State change, payout
// creation and the balanced funding txn are all idempotent: the payout's
// provider key is derived deterministically from the offer id, so a retry
// after an ambiguous timeout cannot produce a second payment.
//
// M2 QUOTE-ONLY (PRD Part 8): when the payout rail is down (mode M2 or the
// dupay breaker open), the acceptance is HONOURED at the quoted price but
// does not fund — the payout is created "queued", no money moves, and the
// queue drains the moment the rail returns (see src/lib/payout-queue.ts).

import { db } from "@/lib/db";
import {
  DEMO_TENANT,
  errors,
  ok,
  problem,
  readJson,
  requireIdempotencyKey,
  type ApiErr,
} from "@/lib/api";
import { postFundingTxn, railDown } from "@/lib/payout-queue";
import { payoutIdempotencyKey, shortId } from "@/lib/canonical";
import { evaluateAdvance, feeFor, type FeatureSnapshot } from "@/lib/ruleengine";
import { RULEPACK_VERSION, rulePack } from "@/lib/rulepack";
import { ensureSeed } from "@/lib/seed";
import type { NextResponse } from "next/server";
import type { Offer, Payout, StatusState } from "@prisma/client";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

interface AcceptBody {
  daysEarly?: unknown;
}

/** Status guard for the funding engine (contract rule 4): M4 read-only →
 * 503 degraded; M3 funding suspended or global/dynamicDiscounting kill
 * switch → 423 kill_switch_active. Escrow releases and recalls continue in
 * M3 by design — only NEW funding is blocked. M2 does NOT block here: the
 * acceptance is honoured and queued (PRD Part 8). */
async function fundingGuard(st: StatusState | null): Promise<NextResponse<ApiErr> | null> {
  if (!st) return null;
  if (st.mode === "M4") return errors.degraded("M4");
  const switches = safeSwitches(st.killSwitchesJson);
  if (st.mode === "M3") {
    return errors.killSwitchActive(
      "Funding is suspended (mode M3 — no new funding of any kind). Positions, collections, escrow releases and recalls continue. Poll /api/status for the review update.",
    );
  }
  if (switches.global) {
    return errors.killSwitchActive("The global funding kill switch is engaged — all new advances are halted. Poll /api/status.");
  }
  if (switches.dynamicDiscounting) {
    return errors.killSwitchActive("The dynamic-discounting engine is switched off by an operator. Poll /api/status.");
  }
  return null;
}

function safeSwitches(json: string): Record<string, boolean> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function serializeOffer(o: Offer) {
  return {
    id: o.id,
    invoiceId: o.invoiceId,
    decisionId: o.decisionId,
    grossFils: o.grossFils,
    advanceRatePermyriad: o.advanceRatePermyriad,
    principalFils: o.principalFils,
    rateMilliBps: o.rateMilliBps,
    expiresAt: o.expiresAt.toISOString(),
    state: o.state,
    settlementDate: o.settlementDate ? o.settlementDate.toISOString() : null,
    daysEarly: o.daysEarly,
    feeFils: o.feeFils,
    netProceedsFils: o.netProceedsFils,
    acceptedAt: o.acceptedAt ? o.acceptedAt.toISOString() : null,
    acceptedIdempotencyKey: o.acceptedIdempotencyKey,
    createdAt: o.createdAt.toISOString(),
  };
}

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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await ensureSeed();
    const { id } = await ctx.params;

    // PRD 5.1 / contract rule 1 — money-moving POST needs an idempotency key.
    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const offer = await db.offer.findUnique({
      where: { id },
      include: { invoice: { include: { entity: true } } },
    });
    if (!offer || offer.tenantId !== DEMO_TENANT) return errors.notFound("Offer");
    const invoice = offer.invoice;

    // ── Idempotent replay: a payout for this offer means the accept already
    // succeeded. Return the original outcome, never a second payment.
    const existingPayout = await db.payout.findUnique({ where: { offerId: offer.id } });
    if (existingPayout) {
      if (existingPayout.state === "queued") {
        // Queued in M2 — the funding txn is deliberately absent. No money
        // moves while the rail is down; the queue drains on release.
        return ok({ offer: serializeOffer(offer), payout: serializePayout(existingPayout), replayed: true, queued: true });
      }
      // Self-heal: ensure the funding txn is present (no-op when posted) —
      // a crash between payout creation and ledger posting recovers here.
      const days = offer.daysEarly ?? 0;
      const fee = offer.feeFils ?? feeFor(Math.max(1, days), offer.rateMilliBps, offer.principalFils);
      const net = offer.netProceedsFils ?? offer.principalFils - fee;
      await postFundingTxn(offer, invoice.externalRef, invoice.entity.duPaySuffix, days, fee, net, existingPayout.id);
      return ok({ offer: serializeOffer(offer), payout: serializePayout(existingPayout), replayed: true });
    }

    // ── Status guard (after the replay check — a replay is a read) ──
    const st = await db.statusState.findUnique({ where: { id: "singleton" } });
    const guard = await fundingGuard(st);
    if (guard) return guard;
    // PRD Part 8 — M2/quote-only (or dupay breaker open): honour the price,
    // queue the acceptance, move no money.
    const queueing = railDown(st);

    const body = await readJson<AcceptBody>(req);
    const daysEarly = body?.daysEarly;
    if (typeof daysEarly !== "number" || !Number.isInteger(daysEarly)) {
      return errors.invalidRequest("daysEarly must be an integer number of days between 1 and the days remaining to the due date.");
    }

    const dueInDays = Math.ceil((invoice.dueDate.getTime() - Date.now()) / DAY);
    if (daysEarly < 1) {
      return errors.invalidRequest("daysEarly must be at least 1 — settlement is at least one day before the due date.");
    }
    if (daysEarly > dueInDays) {
      return errors.invalidRequest(`daysEarly must be at most ${Math.max(1, dueInDays)} — the invoice is due in ${Math.max(1, dueInDays)} days.`);
    }

    // ── Server-side re-validation (PRD 4.3-03) ──
    if (offer.state === "accepted") {
      // Prior attempt committed the offer but crashed before the payout was
      // written — recovery path below re-creates the payout from stored fields.
      if (offer.daysEarly !== null && offer.daysEarly !== daysEarly) {
        return errors.invalidRequest(`This offer was already accepted with daysEarly=${offer.daysEarly}. Replay the same payload to recover.`);
      }
    } else if (offer.state !== "offered") {
      return errors.offerExpired();
    } else {
      if (offer.expiresAt.getTime() <= Date.now()) {
        return problem(409, "offer_expired", `The offer expired at ${offer.expiresAt.toISOString()}. Re-quote to see the current price.`);
      }
      const decision = await db.decision.findUnique({ where: { id: offer.decisionId } });
      if (!decision) {
        return problem(409, "offer_expired", "The decision behind this offer is no longer readable. Re-quote to see the current price.");
      }
      if (decision.rulepackVersion !== RULEPACK_VERSION) {
        return problem(
          409,
          "offer_expired",
          `The rule pack changed since this quote (${decision.rulepackVersion} → ${RULEPACK_VERSION}). The price is re-quoted, never applied silently.`,
        );
      }
      let snapshot: FeatureSnapshot | null = null;
      try {
        snapshot = JSON.parse(decision.featureSnapshot) as FeatureSnapshot;
      } catch {
        snapshot = null;
      }
      if (!snapshot) {
        return problem(409, "offer_expired", "The priced feature snapshot is unreadable. Re-quote to see the current price.");
      }
      // Recompute from the SAME snapshot — the pack decides, always.
      const replay = evaluateAdvance(snapshot, rulePack);
      if (replay.priceMilliBpsPerDay !== offer.rateMilliBps) {
        return problem(
          409,
          "offer_expired",
          `price changed — re-quote (${offer.rateMilliBps / 10} bps/day quoted, ${(replay.priceMilliBpsPerDay ?? 0) / 10} bps/day now). A changed price requires fresh acceptance.`,
        );
      }
      if (replay.limitFils !== null && replay.limitFils !== offer.principalFils) {
        return problem(
          409,
          "offer_expired",
          `limit changed — re-quote (principal ${offer.principalFils} fils quoted, ${replay.limitFils} fils now). The new limit is shown explicitly, never applied silently.`,
        );
      }
    }

    // ── Integer money arithmetic (PRD 3.2) ──
    const now = new Date();
    const settlementDate = new Date(invoice.dueDate.getTime() - daysEarly * DAY);
    const fee = feeFor(daysEarly, offer.rateMilliBps, offer.principalFils);
    const net = offer.principalFils - fee;
    const destination = `du Pay ${invoice.entity.duPaySuffix ?? "•••• ••••"}`;

    // ── Atomic state change: offer → accepted, invoice → accepted, payout
    // created with the deterministic provider idempotency key. The unique
    // constraints on (offerId) and (idempotencyKey) make a duplicate payout
    // structurally impossible even under a race (PRD 6.2). In M2 the payout
    // is created "queued" — accepted at the quoted price, funding deferred
    // until the rail returns (PRD Part 8).
    const payoutId = shortId("pay");
    let payout: Payout;
    try {
      payout = await db.$transaction(async (tx) => {
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            state: "accepted",
            settlementDate,
            daysEarly,
            feeFils: fee,
            netProceedsFils: net,
            acceptedAt: now,
            acceptedIdempotencyKey: idemKey,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { fundingState: "accepted" },
        });
        return tx.payout.create({
          data: {
            id: payoutId,
            tenantId: DEMO_TENANT,
            offerId: offer.id,
            idempotencyKey: payoutIdempotencyKey(offer.id),
            rail: "dupay",
            destinationRef: destination,
            amountFils: net,
            state: queueing ? "queued" : "accepted",
            acceptedAt: now,
            etaSeconds: 16,
          },
        });
      });
    } catch (e) {
      // Lost a race against a concurrent accept: the payout already exists.
      if ((e as { code?: string }).code === "P2002") {
        const winner = await db.payout.findUnique({ where: { offerId: offer.id } });
        if (winner) {
          const fresh = await db.offer.findUniqueOrThrow({ where: { id: offer.id } });
          if (winner.state !== "queued") {
            // The race winner funded — self-heal the funding txn with the
            // winner's stored figures. A queued winner needs no posting.
            const wDays = fresh.daysEarly ?? daysEarly;
            const wFee = fresh.feeFils ?? fee;
            const wNet = fresh.netProceedsFils ?? net;
            await postFundingTxn(fresh, invoice.externalRef, invoice.entity.duPaySuffix, wDays, wFee, wNet, winner.id);
          }
          return ok({ offer: serializeOffer(fresh), payout: serializePayout(winner), replayed: true, queued: winner.state === "queued" });
        }
      }
      throw e;
    }

    if (queueing) {
      // ── M2: no money moves. The acceptance is recorded at the quoted
      // price and the payout waits for the rail — the append-only trail
      // carries exactly what happened.
      await db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "payout.queued",
          subjectRef: payout.id,
          payloadJson: JSON.stringify({
            amountFils: net,
            offerId: offer.id,
            rail: "dupay",
            reason: "Payout rail unavailable — acceptance honoured at the quoted price, money moves when the rail returns.",
          }),
        },
      });
      const freshOffer = await db.offer.findUniqueOrThrow({ where: { id: offer.id } });
      return ok({
        offer: serializeOffer(freshOffer),
        payout: serializePayout(payout),
        replayed: false,
        queued: true,
      });
    }

    // ── Funding txn: control the claim, pay the net, earn the fee, hold the
    // reserve (PRD 4.3-04). Idempotent on (tenant, source_event_id).
    await postFundingTxn(offer, invoice.externalRef, invoice.entity.duPaySuffix, daysEarly, fee, net, payout.id);

    const freshOffer = await db.offer.findUniqueOrThrow({ where: { id: offer.id } });
    return ok({
      offer: serializeOffer(freshOffer),
      payout: serializePayout(payout),
      replayed: false,
    });
  } catch (e) {
    console.error("[api/offers/[id]/accept]", e);
    return errors.internal();
  }
}
