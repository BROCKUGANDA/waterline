// WATERLINE — GET /api/treasury  (Task 2-b2; PRD 4.5 Treasury autopilot).
// The autopilot view: policy, the obligation calendar (next 30 days), the
// forward projection (wallet − floor − obligations(horizon) − safety margin =
// sweepable, derived through the PURE rule engine so the floor is an absolute
// hard stop), rule-pack instruments, sweep history with LIVE accrued yield
// (display only — stored on recall), invested total and earned yield total.
// Every money figure is derived from the ledger, never stored as truth.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok } from "@/lib/api";
import { accountBalance, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { applyPermyriad, mulDivFloor } from "@/lib/money";
import { rulePack } from "@/lib/rulepack";
import { evaluateSweep, type FeatureSnapshot } from "@/lib/ruleengine";
import { ensureSeed } from "@/lib/seed";
import type { Obligation, Sweep, TreasuryPolicy } from "@prisma/client";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/** The SME's du Pay wallet is a credit-normal account: its derived ledger
 *  balance (debits − credits) is negative, so the wallet balance is the
 *  negation. Derived, never stored (PRD 2.5). */
async function treasuryWalletFils(): Promise<number> {
  const balance = await accountBalance(DEMO_TENANT, LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT));
  return -balance;
}

/** Everything the autopilot needs, derived NOW. The FeatureSnapshot built
 *  here is byte-identical to the one built in POST /api/treasury/sweep —
 *  the decision trail and this projection must never disagree about the
 *  wallet, the floor or the obligation calendar. */
async function buildTreasuryInputs(): Promise<{
  snapshot: FeatureSnapshot;
  walletFils: number;
  obligationsInHorizonFils: number;
  safetyMarginFils: number;
} | null> {
  const [entity, policy] = await Promise.all([
    db.entity.findFirst({ where: { tenantId: DEMO_TENANT, role: "sme" } }),
    db.treasuryPolicy.findUnique({ where: { tenantId: DEMO_TENANT } }),
  ]);
  if (!entity || !policy) return null;

  const walletFils = await treasuryWalletFils();
  const horizonEnd = new Date(Date.now() + policy.horizonDays * DAY);
  const inHorizon = await db.obligation.findMany({
    where: { tenantId: DEMO_TENANT, active: true, dueDate: { lte: horizonEnd } },
    select: { amountFils: true },
  });
  const obligationsInHorizonFils = inHorizon.reduce((acc, o) => acc + o.amountFils, 0);
  const safetyMarginFils = applyPermyriad(walletFils, policy.safetyMarginPermyriad);

  const snapshot: FeatureSnapshot = {
    asOfDate: new Date().toISOString().slice(0, 10),
    decisionType: "treasury_sweep",
    entity: {
      kybState: entity.kybState,
      licenceDaysRemaining: Math.ceil((entity.licenceExpiry.getTime() - Date.now()) / DAY),
      tenureMonths: entity.tenureMonths,
      sectorCode: entity.sectorCode,
      billingBand: entity.billingBand,
    },
    invoice: null,
    buyer: null,
    portfolio: { bookExposureFils: 0 },
    treasury: {
      balanceFils: walletFils,
      floorFils: policy.floorFils,
      obligationsFils: obligationsInHorizonFils,
      safetyMarginPermyriad: policy.safetyMarginPermyriad,
    },
  };
  return { snapshot, walletFils, obligationsInHorizonFils, safetyMarginFils };
}

/** Live accrued yield for one sweep: per-day yield × whole days since it was
 *  placed (integer fils — no float touches a money path). Recalled sweeps
 *  show the yield that was stored at recall time. */
function accruedYieldFor(s: Sweep): number {
  if (s.state !== "swept") return s.yieldFils;
  const instrument = rulePack.treasury.instruments.find((i) => i.ref === s.instrumentRef);
  if (!instrument) return 0;
  const perDay = mulDivFloor(s.amountFils, instrument.yieldMbsdPermyriad, 10_000);
  const days = Math.max(0, Math.floor((Date.now() - s.createdAt.getTime()) / DAY));
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
    accruedYieldFils: accruedYieldFor(s),
    createdAt: s.createdAt.toISOString(),
    recalledAt: s.recalledAt ? s.recalledAt.toISOString() : null,
  };
}

function serializePolicy(p: TreasuryPolicy) {
  return {
    floorFils: p.floorFils,
    horizonDays: p.horizonDays,
    safetyMarginPermyriad: p.safetyMarginPermyriad,
    autoPilotEnabled: p.autoPilotEnabled,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeObligation(o: Obligation) {
  return {
    id: o.id,
    label: o.label,
    kind: o.kind,
    dueDate: o.dueDate.toISOString(),
    dueInDays: Math.ceil((o.dueDate.getTime() - Date.now()) / DAY),
    amountFils: o.amountFils,
    cadence: o.cadence,
    confidencePermyriad: o.confidencePermyriad,
  };
}

export async function GET(): Promise<Response> {
  try {
    await ensureSeed();

    const policy = await db.treasuryPolicy.findUnique({ where: { tenantId: DEMO_TENANT } });
    if (!policy) return errors.internal();

    // Obligation calendar — the next 30 days, active only, ordered by due date.
    const obligations = await db.obligation.findMany({
      where: { tenantId: DEMO_TENANT, active: true, dueDate: { lte: new Date(Date.now() + 30 * DAY) } },
      orderBy: { dueDate: "asc" },
    });

    // The projection runs through the same pure engine the sweep decision
    // uses — the floor is a hard stop, never a suggestion (PRD 4.5).
    const inputs = await buildTreasuryInputs();
    if (!inputs) return errors.internal();
    const { snapshot, walletFils, obligationsInHorizonFils, safetyMarginFils } = inputs;
    const sweep = evaluateSweep(snapshot, rulePack);

    // Sweep history, newest first; invested = principal currently deployed;
    // earned = yield actually banked on recalled sweeps.
    const sweeps = await db.sweep.findMany({
      where: { tenantId: DEMO_TENANT },
      orderBy: { createdAt: "desc" },
    });
    const investedFils = sweeps
      .filter((s) => s.state === "swept")
      .reduce((acc, s) => acc + s.amountFils, 0);
    const earnedYieldFils = sweeps
      .filter((s) => s.state === "recalled")
      .reduce((acc, s) => acc + s.yieldFils, 0);

    return ok({
      policy: serializePolicy(policy),
      obligations: obligations.map(serializeObligation),
      projection: {
        walletFils,
        asOf: new Date().toISOString(),
        floorFils: policy.floorFils,
        obligationsInHorizonFils,
        safetyMarginFils,
        sweepableFils: sweep.sweepableFils,
        sweepOutcome: sweep.outcome,
        sweepReasonCode: sweep.reasonCode,
        sweepReasonText: sweep.reasonText,
      },
      instruments: rulePack.treasury.instruments.map((i) => ({
        ref: i.ref,
        name: i.name,
        yieldMbsdPermyriad: i.yieldMbsdPermyriad,
        maturityDays: i.maturityDays,
        liquidityDays: i.liquidityDays,
      })),
      sweeps: sweeps.map(serializeSweep),
      investedFils,
      earnedYieldFils,
    });
  } catch {
    return errors.internal();
  }
}
