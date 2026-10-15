// WATERLINE — POST /api/treasury/recall  (Task 2-b2; PRD 4.5).
// Recall a swept position back to the wallet with the accrued yield credited
// on top. Yield is computed live with pure integer arithmetic (per-day rate
// × whole days) and STORED on the sweep at recall time. Only active 'swept'
// positions are recallable; a repeat call is an idempotent replay. Recall
// keeps working in M3 — existing money keeps working (PRD Part 8).

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey } from "@/lib/api";
import { LEDGER_ACCOUNTS, postTransaction } from "@/lib/ledger";
import { mulDivFloor } from "@/lib/money";
import { rulePack } from "@/lib/rulepack";
import { ensureSeed } from "@/lib/seed";
import type { Sweep } from "@prisma/client";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

interface RecallBody {
  sweepId?: unknown;
}

/** Kill-switch guard: the treasury / global switch pauses treasury moves
 *  (423); M4 is read-only and blocks all writes (503). M3 funding
 *  suspension explicitly does NOT block recalls (PRD Part 8). */
async function treasuryGuard(): Promise<Response | null> {
  const st = await db.statusState.findUnique({ where: { id: "singleton" } });
  if (!st) return null;
  let switches: Record<string, unknown> = {};
  try {
    const v = JSON.parse(st.killSwitchesJson);
    if (v && typeof v === "object" && !Array.isArray(v)) switches = v as Record<string, unknown>;
  } catch {
    switches = {};
  }
  if (switches.treasury === true) {
    return errors.killSwitchActive("The treasury engine is switched off by an operator — treasury moves are paused with it. Poll /api/status.");
  }
  if (switches.global === true) {
    return errors.killSwitchActive("The global kill switch is engaged — treasury moves are paused. Poll /api/status.");
  }
  if (st.mode === "M4") return errors.degraded("M4");
  return null;
}

/** Accrued yield: per-day rate (permyriad of amount) × whole days elapsed.
 *  Pure integer arithmetic — no float ever touches a money path. */
function accruedYieldFils(sweep: Sweep): number {
  const instrument = rulePack.treasury.instruments.find((i) => i.ref === sweep.instrumentRef);
  if (!instrument) return 0;
  const perDay = mulDivFloor(sweep.amountFils, instrument.yieldMbsdPermyriad, 10_000);
  const days = Math.max(0, Math.floor((Date.now() - sweep.createdAt.getTime()) / DAY));
  return perDay * days;
}

function serializeSweep(s: Sweep) {
  const instrument = rulePack.treasury.instruments.find((i) => i.ref === s.instrumentRef);
  return {
    id: s.id,
    direction: s.direction,
    amountFils: s.amountFils,
    instrumentRef: s.instrumentRef,
    instrumentName: instrument?.name ?? s.instrumentRef,
    yieldMbsdPermyriad: instrument?.yieldMbsdPermyriad ?? null,
    floorAtDecisionFils: s.floorAtDecisionFils,
    state: s.state,
    yieldFils: s.yieldFils,
    createdAt: s.createdAt.toISOString(),
    recalledAt: s.recalledAt ? s.recalledAt.toISOString() : null,
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const body = await readJson<RecallBody>(req);
    const sweepId = body?.sweepId;
    if (typeof sweepId !== "string" || sweepId.length < 3) {
      return errors.invalidRequest("sweepId must be the id of the sweep to recall.");
    }

    const sweep = await db.sweep.findUnique({ where: { id: sweepId } });
    if (!sweep || sweep.tenantId !== DEMO_TENANT) return errors.notFound("Sweep");

    // Idempotent replay: an already-recalled sweep returns its stored outcome.
    if (sweep.state === "recalled") {
      return ok({ sweep: serializeSweep(sweep), replayed: true });
    }
    if (sweep.state !== "swept") {
      return errors.invalidRequest(`Only an active swept position can be recalled (state=${sweep.state}).`);
    }

    const guard = await treasuryGuard();
    if (guard) return guard;

    const instrument = rulePack.treasury.instruments.find((i) => i.ref === sweep.instrumentRef);
    if (!instrument) {
      return errors.invalidRequest("This sweep's instrument is no longer in the rule pack — the holding runs to maturity.");
    }

    const yieldFils = accruedYieldFils(sweep);
    const totalFils = sweep.amountFils + yieldFils;

    // Instrument holding → wallet, principal + accrued yield. Idempotent on
    // (tenant, source_event_id); P2002 means a racing retry already posted it.
    let alreadyPosted = false;
    try {
      const posted = await postTransaction({
        tenantId: DEMO_TENANT,
        txnId: `txn_recall_${sweep.id.slice(6)}`,
        sourceEventId: `treasury.recall:${sweep.id}`,
        valueDate: new Date(),
        entries: [
          { accountCode: LEDGER_ACCOUNTS.INSTRUMENT_HOLDING(sweep.instrumentRef), direction: "debit", amountFils: totalFils, memo: `Recall from ${instrument.name} — principal + yield` },
          { accountCode: LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT), direction: "credit", amountFils: totalFils, memo: `Recall to du Pay — ${instrument.name}` },
        ],
        eventType: "sweep.recalled",
        eventSubjectRef: sweep.id,
        eventPayload: { amountFils: sweep.amountFils, yieldFils, totalFils, instrumentRef: sweep.instrumentRef, instrumentName: instrument.name },
      });
      alreadyPosted = posted.alreadyPosted;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      alreadyPosted = true;
    }

    // Crash recovery: if the txn had already landed in a prior attempt, use
    // the amount actually posted to the wallet so the stored yield matches
    // the ledger to the fil.
    let storedYieldFils = yieldFils;
    if (alreadyPosted) {
      const credit = await db.ledgerEntry.findFirst({
        where: {
          tenantId: DEMO_TENANT,
          sourceEventId: `treasury.recall:${sweep.id}:${LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT)}`,
        },
        select: { amountFils: true },
      });
      if (credit) storedYieldFils = credit.amountFils - sweep.amountFils;
    }

    const recalled = await db.sweep.update({
      where: { id: sweep.id },
      data: { state: "recalled", recalledAt: new Date(), yieldFils: storedYieldFils },
    });

    return ok({ sweep: serializeSweep(recalled), replayed: alreadyPosted });
  } catch {
    return errors.internal();
  }
}
