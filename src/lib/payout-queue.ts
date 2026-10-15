// WATERLINE — payout queue (PRD Part 8, mode M2: "Quotes continue and are
// honoured at the past quoted price. Acceptances queue. No money moves.")
//
// When the payout rail is unavailable (mode M2, or the dupay breaker open),
// an acceptance is honoured at the quoted price but does NOT fund: the payout
// is created in state "queued" and no ledger txn is posted. The moment the
// rail returns (mode M0/M1 and the breaker closed) the queue drains: the
// funding txn posts (idempotent on its source event) and the payout's
// 4-stage pipeline starts fresh from the release instant — no stage is ever
// shown before it is true.
//
// Money invariants hold end-to-end:
// - No float: fee/net come from the stored offer fields, integer fils.
// - Idempotency: the funding txn keeps its `offer.accept:{offerId}` source
//   event, so a double release or a crash mid-release is a no-op on the
//   ledger; the state machine (queued → accepted) is checked-and-set.
// - Append-only trail: queueing writes payout.queued; release writes the
//   ledger outbox (offer.accepted) + payout.initiated + payout.released.

import { db } from "@/lib/db";
import { shortId } from "@/lib/canonical";
import { postTransaction, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { feeFils } from "@/lib/money";
import type { Offer, Payout, StatusState } from "@prisma/client";

/** Is the payout rail down right now? M2 declares it, and an open dupay
 *  breaker is the dependency-level signal for the same fact. M3/M4 block
 *  funding outright (kill switch / read-only) — they never queue. */
export function railDown(st: StatusState | null): boolean {
  if (!st) return false;
  if (st.mode === "M2") return true;
  try {
    const breakers = JSON.parse(st.breakersJson) as Record<string, string>;
    return breakers.dupay === "open";
  } catch {
    return false;
  }
}

/** Can queued payouts be released? Rail back: funding modes with the
 *  breaker closed. M3 (funding suspended) and M4 (read-only) hold the queue. */
export function railBack(st: StatusState | null): boolean {
  if (!st) return true;
  if (st.mode !== "M0" && st.mode !== "M1") return false;
  try {
    const breakers = JSON.parse(st.breakersJson) as Record<string, string>;
    return breakers.dupay !== "open";
  } catch {
    return true;
  }
}

async function fundingTxnPosted(tenantId: string, offerId: string): Promise<boolean> {
  const existing = await db.ledgerEntry.findFirst({
    where: { tenantId, sourceEventId: { startsWith: `offer.accept:${offerId}:` } },
    select: { id: true },
  });
  return existing !== null;
}

/** The funding transaction: control the claim, pay the net, earn the fee,
 *  hold the reserve (PRD 4.3-04). Idempotent on (tenant, sourceEventId);
 *  a P2002 from the unique constraint is treated as already-posted. Writes
 *  the payout.initiated outbox row. Safe to call from the accept path and
 *  from the queue release — the same logical event posts exactly once. */
export async function postFundingTxn(
  offer: Offer,
  invoiceRef: string,
  duPaySuffix: string | null,
  daysEarly: number,
  fee: number,
  net: number,
  payoutId?: string,
): Promise<void> {
  if (await fundingTxnPosted(offer.tenantId, offer.id)) return;
  const reserve = offer.grossFils - net - fee;
  try {
    await postTransaction({
      tenantId: offer.tenantId,
      txnId: `txn_${shortId("f")}`,
      sourceEventId: `offer.accept:${offer.id}`,
      valueDate: new Date(),
      entries: [
        { accountCode: LEDGER_ACCOUNTS.RECEIVABLE_CONTROL, direction: "debit", amountFils: offer.grossFils, memo: `Assignment recorded — ${invoiceRef}` },
        { accountCode: LEDGER_ACCOUNTS.FUNDING_POOL, direction: "credit", amountFils: net, memo: `Advance to du Pay ${duPaySuffix ?? ""}`.trim() },
        { accountCode: LEDGER_ACCOUNTS.FEE_INCOME, direction: "credit", amountFils: fee, memo: `Discount fee — ${daysEarly} days early` },
        { accountCode: LEDGER_ACCOUNTS.RESERVE_HELD, direction: "credit", amountFils: reserve, memo: "Reserve held for SME" },
      ],
      eventType: "offer.accepted",
      eventSubjectRef: offer.id,
      eventPayload: { principalFils: offer.principalFils, feeFils: fee, netProceedsFils: net, daysEarly, payoutId: payoutId ?? null },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // duplicate post → already posted
  }
  if (payoutId) {
    const existing = await db.appEvent.findFirst({
      where: { tenantId: offer.tenantId, type: "payout.initiated", subjectRef: payoutId },
      select: { id: true },
    });
    if (!existing) {
      await db.appEvent.create({
        data: {
          tenantId: offer.tenantId,
          type: "payout.initiated",
          subjectRef: payoutId,
          payloadJson: JSON.stringify({ amountFils: net, rail: "dupay", offerId: offer.id }),
        },
      });
    }
  }
}

/** Drain the queue when the rail is back. For every queued payout (in
 *  acceptance order): post the funding txn (idempotent), flip the state to
 *  accepted with acceptedAt = the release instant so the stage pipeline
 *  starts honestly, and write the payout.released outbox event. A payout
 *  whose offer lost its stored fee fields recomputes them with the same
 *  pure integer formula. Returns how many payouts were released. */
export async function releaseQueuedPayouts(): Promise<{ released: number; held: number }> {
  const st = await db.statusState.findUnique({ where: { id: "singleton" } });
  const queued = await db.payout.findMany({
    where: { tenantId: "t_8821", state: "queued" },
    orderBy: { acceptedAt: "asc" },
    include: { offer: { include: { invoice: { include: { entity: true } } } } },
  });
  if (queued.length === 0) return { released: 0, held: 0 };
  if (!railBack(st)) return { released: 0, held: queued.length };

  let released = 0;
  for (const p of queued) {
    const offer = p.offer;
    const invoice = offer.invoice;
    const days = offer.daysEarly ?? Math.max(1, Math.ceil((invoice.dueDate.getTime() - offer.createdAt.getTime()) / 86_400_000));
    const fee = offer.feeFils ?? feeFils(days, offer.rateMilliBps, offer.principalFils);
    const net = offer.netProceedsFils ?? offer.principalFils - fee;
    // Released first (the queue drains), then the funding + pipeline events —
    // the causal order reads correctly in the activity feed.
    await db.appEvent.create({
      data: {
        tenantId: p.tenantId,
        type: "payout.released",
        subjectRef: p.id,
        payloadJson: JSON.stringify({
          amountFils: p.amountFils,
          offerId: offer.id,
          from: "queued",
          to: "accepted",
          note: "Payout rail restored — queued acceptance released at the quoted price.",
        }),
      },
    });
    await postFundingTxn(offer, invoice.externalRef, invoice.entity?.duPaySuffix ?? null, days, fee, net, p.id);
    // Checked-and-set: only a still-queued payout transitions.
    await db.payout.updateMany({
      where: { id: p.id, state: "queued" },
      data: { state: "accepted", acceptedAt: new Date() },
    });
    released += 1;
  }
  return { released, held: 0 };
}

/** Serialize helper shared by the payout routes (queued included). */
export function serializePayoutBase(p: Payout) {
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

// ── The 4-stage honest pipeline (PRD 11.13) ─────────────────────────────────
// Deterministic time boundaries (2.5s / 7s / etaSeconds from acceptedAt),
// persisted as crossed, one outbox event per transition. No stage is ever
// shown before it is true. Shared by the payout GET route and the invoice
// detail route so every read advances the pipeline identically.

const STAGE_KEYS = ["accepted", "reserved", "sent", "settled"] as const;
const RESERVED_AFTER_MS = 2_500;
const SENT_AFTER_MS = 7_000;

/** Provider reference assigned at dispatch — deterministic per payout. */
function providerRefFor(payoutId: string): string {
  return `dpay_${payoutId.slice(-6)}`;
}

/** Advance the pipeline to the stage elapsed honest time dictates, persist
 *  newly-crossed boundaries and write the outbox events. Returns the FRESH
 *  payout row (the input row is never mutated by reference). */
export async function advancePayoutPipeline(p: Payout): Promise<Payout> {
  if (p.state === "queued" || p.state === "failed") return p;
  const eta = p.etaSeconds > 0 ? p.etaSeconds : 16;
  const t0 = p.acceptedAt.getTime();
  const elapsedMs = Date.now() - t0;
  const settledAfterMs = eta * 1_000;

  // Stage the pipeline SHOULD be in, purely from elapsed honest time.
  let target = 0;
  if (elapsedMs >= settledAfterMs) target = 3;
  else if (elapsedMs >= SENT_AFTER_MS) target = 2;
  else if (elapsedMs >= RESERVED_AFTER_MS) target = 1;

  // Stage the pipeline has OBSERVED (persisted timestamps are the truth).
  let observed = 0;
  if (p.settledAt || p.state === "settled") observed = 3;
  else if (p.sentAt || p.state === "sent") observed = 2;
  else if (p.reservedAt || p.state === "reserved") observed = 1;

  if (target > observed) {
    const data: {
      reservedAt?: Date;
      sentAt?: Date;
      providerRef?: string;
      settledAt?: Date;
      reconciledAt?: Date;
      state?: string;
    } = {};
    if (target >= 1 && !p.reservedAt) data.reservedAt = new Date(t0 + RESERVED_AFTER_MS);
    if (target >= 2 && !p.sentAt) {
      data.sentAt = new Date(t0 + SENT_AFTER_MS);
      if (!p.providerRef) data.providerRef = providerRefFor(p.id);
    }
    if (target >= 3) {
      data.settledAt = new Date(t0 + settledAfterMs);
      data.reconciledAt = new Date();
    }
    data.state = STAGE_KEYS[target];

    // Delivery completion (posted exactly once, idempotent on its source
    // event): the moment the payout SETTLES, the advance is delivered to the
    // SME's du Pay wallet — the wallet the UI calls "Available now" must
    // move when money actually arrives. The funding txn credited the pool
    // with the net at accept; delivery debits it back and credits the
    // wallet. Net effect on the pool: zero. Double-entry stays balanced.
    if (target >= 3) {
      try {
        await postTransaction({
          tenantId: p.tenantId,
          txnId: `txn_${shortId("d")}`,
          sourceEventId: `payout.settled:${p.id}`,
          valueDate: new Date(),
          entries: [
            { accountCode: LEDGER_ACCOUNTS.FUNDING_POOL, direction: "debit", amountFils: p.amountFils, memo: `Advance delivered — ${p.destinationRef}` },
            { accountCode: LEDGER_ACCOUNTS.SME_WALLET(p.tenantId), direction: "credit", amountFils: p.amountFils, memo: `Early payment received — ${p.destinationRef}` },
          ],
          eventType: "payout.settled",
          eventSubjectRef: p.id,
          eventPayload: { amountFils: p.amountFils, providerRef: p.providerRef ?? providerRefFor(p.id) },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e; // duplicate → already delivered
      }
    }

    await db.payout.update({ where: { id: p.id }, data });
    for (let s = observed + 1; s <= target; s++) {
      // The settled crossing is told by the delivery event (payout.settled,
      // written by the completion txn above) — a duplicate stage event would
      // narrate the same moment twice in the activity feed.
      if (s === 3) continue;
      await db.appEvent.create({
        data: {
          tenantId: p.tenantId,
          type: "payout.state_changed",
          subjectRef: p.id,
          payloadJson: JSON.stringify({
            from: STAGE_KEYS[s - 1],
            to: STAGE_KEYS[s],
            stage: STAGE_KEYS[s],
            amountFils: p.amountFils,
            providerRef: s >= 2 ? (data.providerRef ?? p.providerRef ?? providerRefFor(p.id)) : null,
            destinationRef: p.destinationRef,
          }),
        },
      });
    }
    return db.payout.findUniqueOrThrow({ where: { id: p.id } });
  }
  return p;
}

/** Pipeline view fields (stage/stageIndex/stages) for a payout that is NOT
 *  queued — derived from the row's persisted timestamps. */
export function pipelineView(p: Payout) {
  const eta = p.etaSeconds > 0 ? p.etaSeconds : 16;
  let observed = 0;
  if (p.settledAt || p.state === "settled") observed = 3;
  else if (p.sentAt || p.state === "sent") observed = 2;
  else if (p.reservedAt || p.state === "reserved") observed = 1;
  return {
    stage: STAGE_KEYS[observed],
    stageIndex: observed,
    stages: STAGE_KEYS.map((key, i) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      at:
        i === 0 ? p.acceptedAt.toISOString()
        : i === 1 ? (p.reservedAt ? p.reservedAt.toISOString() : null)
        : i === 2 ? (p.sentAt ? p.sentAt.toISOString() : null)
        : (p.settledAt ? p.settledAt.toISOString() : null),
    })),
    elapsedMs: Math.max(0, Date.now() - p.acceptedAt.getTime()),
    etaSeconds: eta,
  };
}
