// WATERLINE — automatic guardrails (PRD Part 8).
// "Transitions are automatic on guardrail breach and manual by operator
//  command." The telemetry below is DETERMINISTIC — every value is derived
//  from the append-only stores with fixed arithmetic, evaluated on the
//  status heartbeat. Automation only ever escalates M0 → M1 (limits tighten,
//  nothing reprices); recovery is a human decision, and a human revert
//  within the same breach episode is a deliberate override that stands.
//
//  Metrics (warning bands are fixed, published data — never model output):
//   1. disputeRate   — disputed ÷ (verified + disputed) invoices, permyriad.
//                      Band: ≥ 20% (2000‱).
//   2. lossRate      — failed ÷ (failed + settled) payouts, permyriad.
//                      Band: ≥ 20% (2000‱).
//   3. coverage30d   — (wallet + recallable sweeps) − obligations due in the
//                      next 30 days vs the ABSOLUTE floor. Warning when the
//                      projected 30-day position would sit below the floor.
//   4. reconBreaks   — ledger transactions that do not sum to zero. Band: ≥ 1.
//
//  Episode semantics: the episode key is the sorted set of breached guardrail
//  keys. Auto-M1 fires once per distinct episode; the operator's revert
//  within the episode is final until the breach set changes.

import { db } from "@/lib/db";
import { DEMO_TENANT } from "@/lib/api";
import { accountBalance, verifyLedgerIntegrity, LEDGER_ACCOUNTS } from "@/lib/ledger";

const DAY = 86_400_000;

export type GuardrailKey = "disputeRate" | "lossRate" | "coverage30d" | "reconBreaks";

export interface GuardrailMetric {
  key: GuardrailKey;
  /** Current value in the metric's natural unit (permyriad / fils / count). */
  value: number;
  /** The warning band, same unit. Breached when value crosses it. */
  band: number;
  unit: "permyriad" | "fils" | "count";
  breached: boolean;
  /** Deterministic human note (EN) — the UI localises the label by key. */
  detail: string;
}

export interface GuardrailsEval {
  metrics: GuardrailMetric[];
  breachedKeys: GuardrailKey[];
  episodeKey: string | null;
}

/** Fixed warning bands — published data, identical in every pack version
 *  (they watch the platform, not the pricing). */
export const GUARDRAIL_BANDS: Record<GuardrailKey, { band: number; unit: GuardrailMetric["unit"] }> = {
  disputeRate: { band: 2_000, unit: "permyriad" }, // ≥ 20%
  lossRate: { band: 2_000, unit: "permyriad" }, // ≥ 20%
  coverage30d: { band: 0, unit: "fils" }, // projected position < floor
  reconBreaks: { band: 1, unit: "count" }, // any break
};

/** Pure telemetry read — deterministic, no writes. */
export async function evaluateGuardrailTelemetry(): Promise<GuardrailsEval> {
  // 1 + 2. Dispute and loss rates over the completed book.
  const [disputed, verified] = await Promise.all([
    db.invoice.count({ where: { tenantId: DEMO_TENANT, verificationState: "disputed" } }),
    db.invoice.count({ where: { tenantId: DEMO_TENANT, verificationState: "verified" } }),
  ]);
  const settledOutcomes = disputed + verified;
  const disputeRatePermyriad = settledOutcomes > 0 ? Math.round((disputed / settledOutcomes) * 10_000) : 0;

  const [failed, settledPayouts] = await Promise.all([
    db.payout.count({ where: { tenantId: DEMO_TENANT, state: "failed" } }),
    db.payout.count({ where: { tenantId: DEMO_TENANT, state: "settled" } }),
  ]);
  const payoutOutcomes = failed + settledPayouts;
  const lossRatePermyriad = payoutOutcomes > 0 ? Math.round((failed / payoutOutcomes) * 10_000) : 0;

  // 3. 30-day coverage vs the absolute floor: wallet + recallable sweeps
  //    minus the obligations that fall due inside 30 days.
  const policy = await db.treasuryPolicy.findUnique({ where: { tenantId: DEMO_TENANT } });
  const wallet = -(await accountBalance(DEMO_TENANT, LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT)));
  const swept = await db.sweep.findMany({
    where: { tenantId: DEMO_TENANT, direction: "out", state: "swept" },
    select: { amountFils: true },
  });
  const recallableFils = swept.reduce((acc, s) => acc + s.amountFils, 0);
  const horizon = new Date(Date.now() + 30 * DAY);
  const obligations = await db.obligation.findMany({
    where: { tenantId: DEMO_TENANT, active: true, dueDate: { lte: horizon } },
    select: { amountFils: true, cadence: true },
  });
  // Recurring obligations inside 30 days: monthly fires once, weekly up to 4×.
  const due30dFils = obligations.reduce((acc, o) => {
    if (o.cadence === "weekly") return acc + o.amountFils * 4;
    return acc + o.amountFils;
  }, 0);
  const floorFils = policy?.floorFils ?? 5_000_000;
  const projectedPositionFils = wallet + recallableFils - due30dFils;
  const coverageShortfallFils = projectedPositionFils - floorFils; // < 0 → breach

  // 4. Reconciliation breaks — the ledger must always sum to zero.
  const recon = await verifyLedgerIntegrity(DEMO_TENANT);

  const metrics: GuardrailMetric[] = [
    {
      key: "disputeRate",
      value: disputeRatePermyriad,
      band: GUARDRAIL_BANDS.disputeRate.band,
      unit: "permyriad",
      breached: disputeRatePermyriad >= GUARDRAIL_BANDS.disputeRate.band,
      detail: `Disputed ${disputed} of ${settledOutcomes} decided invoices.`,
    },
    {
      key: "lossRate",
      value: lossRatePermyriad,
      band: GUARDRAIL_BANDS.lossRate.band,
      unit: "permyriad",
      breached: lossRatePermyriad >= GUARDRAIL_BANDS.lossRate.band,
      detail: `Failed ${failed} of ${payoutOutcomes} completed payouts.`,
    },
    {
      key: "coverage30d",
      value: coverageShortfallFils,
      band: GUARDRAIL_BANDS.coverage30d.band,
      unit: "fils",
      breached: coverageShortfallFils < GUARDRAIL_BANDS.coverage30d.band,
      detail: `Wallet + recallable − 30-day obligations = AED ${(projectedPositionFils / 100).toFixed(2)} vs floor AED ${(floorFils / 100).toFixed(2)}.`,
    },
    {
      key: "reconBreaks",
      value: recon.breaks.length,
      band: GUARDRAIL_BANDS.reconBreaks.band,
      unit: "count",
      breached: recon.breaks.length >= GUARDRAIL_BANDS.reconBreaks.band,
      detail: `${recon.txns} ledger transactions checked.`,
    },
  ];

  const breachedKeys = metrics.filter((m) => m.breached).map((m) => m.key);
  return {
    metrics,
    breachedKeys,
    episodeKey: breachedKeys.length > 0 ? breachedKeys.sort().join("+") : null,
  };
}

export interface GuardrailEnforcementResult {
  evaluation: GuardrailsEval;
  /** True when THIS call auto-applied M1 (once per episode). */
  autoApplied: boolean;
  /** The auto-transition reason, for the ops panel and audit trail. */
  autoReason: string | null;
}

/** The automatic side of PRD Part 8: escalate M0 → M1 when a guardrail is
 *  breached, once per distinct breach episode. Never called inside another
 *  write transaction; failures are swallowed by the caller (the status
 *  endpoint must never fail). */
export async function enforceGuardrails(): Promise<GuardrailEnforcementResult> {
  const evaluation = await evaluateGuardrailTelemetry();

  if (evaluation.breachedKeys.length === 0) {
    // All clear: END the episode. A later re-crossing is a fresh breach and
    // automation re-escalates. (A revert DURING a continuing breach — below —
    // remains the operator's override for that episode.)
    try {
      await db.statusState.updateMany({
        where: { id: "singleton", guardrailEpisodeJson: { not: null } },
        data: { guardrailEpisodeJson: null },
      });
    } catch {
      // Bookkeeping only — never let it fail the status read.
    }
    return { evaluation, autoApplied: false, autoReason: null };
  }

  const st = await db.statusState.findUnique({ where: { id: "singleton" } });
  // Automation only escalates FROM M0. Any other mode (an operator's M2/M3/M4
  // or an existing M1) already reflects a human or prior escalation.
  if (!st || st.mode !== "M0") {
    return { evaluation, autoApplied: false, autoReason: null };
  }

  let lastEpisode: string | null = null;
  try {
    const parsed = st.guardrailEpisodeJson ? (JSON.parse(st.guardrailEpisodeJson) as { episodeKey?: string }) : null;
    lastEpisode = parsed?.episodeKey ?? null;
  } catch {
    lastEpisode = null;
  }
  if (lastEpisode === evaluation.episodeKey) {
    // Same episode already escalated; the operator's revert stands.
    return { evaluation, autoApplied: false, autoReason: null };
  }

  const reason =
    `automatic — guardrail warning band crossed: ${evaluation.breachedKeys.join(", ")}. ` +
    `Rule pack ${"2026.10.3"} → ${"2026.10.3-cautious.1"} (advance rates reduced, limits tightened; pricing unchanged).`;

  await db.$transaction(async (tx) => {
    await tx.statusState.update({
      where: { id: "singleton" },
      data: {
        mode: "M1",
        guardrailEpisodeJson: JSON.stringify({ episodeKey: evaluation.episodeKey, at: new Date().toISOString() }),
      },
    });
    // One event per breached metric — the plain-language evidence.
    for (const m of evaluation.metrics.filter((x) => x.breached)) {
      await tx.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "guardrail.triggered",
          subjectRef: `guardrail:${m.key}`,
          payloadJson: JSON.stringify({
            guardrail: m.key,
            value: m.value,
            band: m.band,
            unit: m.unit,
            detail: m.detail,
            automatic: true,
          }),
        },
      });
    }
    await tx.operatorAction.create({
      data: {
        actor: "system:guardrails",
        action: "guardrail_auto_m1",
        targetRef: "status",
        reason,
        detailJson: JSON.stringify({
          episodeKey: evaluation.episodeKey,
          breached: evaluation.metrics.filter((m) => m.breached).map((m) => ({ key: m.key, value: m.value, band: m.band, detail: m.detail })),
        }),
      },
    });
    await tx.appEvent.create({
      data: {
        tenantId: DEMO_TENANT,
        type: "status.changed",
        subjectRef: "status",
        payloadJson: JSON.stringify({
          mode: "M1",
          message: null,
          automatic: true,
          actor: "system:guardrails",
          reason,
        }),
      },
    });
  });

  return { evaluation, autoApplied: true, autoReason: reason };
}

/** The published view block (additive on /api/status). */
export interface GuardrailsView {
  evaluatedAt: string;
  metrics: { key: GuardrailKey; value: number; band: number; unit: GuardrailMetric["unit"]; breached: boolean; detail: string }[];
  autoTriggeredNow: boolean;
  /** The episode key that last auto-applied M1 (null if automation never fired). */
  lastAutoEpisode: string | null;
  autoReason: string | null;
}

export async function guardrailsView(evaluation: GuardrailsEval, autoApplied: boolean, autoReason: string | null): Promise<GuardrailsView> {
  let lastAutoEpisode: string | null = null;
  try {
    const st = await db.statusState.findUnique({ where: { id: "singleton" }, select: { guardrailEpisodeJson: true } });
    const parsed = st?.guardrailEpisodeJson ? (JSON.parse(st.guardrailEpisodeJson) as { episodeKey?: string }) : null;
    lastAutoEpisode = parsed?.episodeKey ?? null;
  } catch {
    lastAutoEpisode = null;
  }
  return {
    evaluatedAt: new Date().toISOString(),
    metrics: evaluation.metrics.map((m) => ({ key: m.key, value: m.value, band: m.band, unit: m.unit, breached: m.breached, detail: m.detail })),
    autoTriggeredNow: autoApplied,
    lastAutoEpisode,
    autoReason,
  };
}
