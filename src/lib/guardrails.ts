// WATERLINE — automatic guardrails (PRD Part 8).
// "Transitions are automatic on guardrail breach and manual by operator
//  command." The telemetry below is DETERMINISTIC — every value is derived
//  from the append-only stores with fixed arithmetic, evaluated on the
//  status heartbeat. Automation escalates FROM M0 for every breach class,
//  and additionally FROM M1 for an M3-class breach (the honest cascade: the
//  cautious delta tightens the portfolio ceiling below the live funded book,
//  so the platform suspends new funding entirely). The target mode follows
//  the published mode catalog (never a guess):
//   - M1 (cautious — limits tighten, nothing reprices) for the loss/dispute/
//     forecast guardrails;
//   - M2 (quote-only — quotes honoured at the locked price, acceptances
//     queue, no money moves) for the payout-rail breaker and reconciliation
//     breaks, exactly the two conditions the M2 catalog entry declares;
//   - M3 (funding suspended — no new funding; existing money keeps working)
//     for a portfolio-ceiling breach (the funded book crosses the ACTIVE
//     pack's ceiling) and for decision-replay integrity failures, exactly
//     the internal conditions the M3 catalog entry declares ("integrity
//     breach, portfolio ceiling breach"). Regulatory instructions remain
//     operator-applied by nature — they arrive from outside the platform.
//  Recovery is a human decision, and a human revert within the same breach
//  episode is a deliberate override that stands.
//
//  Metrics (warning bands are fixed, published data — never model output):
//   1. disputeRate   — disputed ÷ (verified + disputed) invoices, permyriad.
//                      Band: ≥ 20% (2000‱) → M1.
//   2. lossRate      — failed ÷ (failed + settled) payouts, permyriad.
//                      Band: ≥ 20% (2000‱) → M1.
//   3. coverage30d   — (wallet + recallable sweeps) − obligations due in the
//                      next 30 days vs the ABSOLUTE floor. Warning when the
//                      projected 30-day position would sit below the floor → M1.
//   4. reconBreaks   — ledger transactions that do not sum to zero. Band: ≥ 1 → M2.
//   5. railBreaker   — the du Pay payout-rail breaker state. Band: open → M2.
//   6. portfolioCeiling — headroom = ACTIVE pack ceiling − funded-book
//                      exposure (accepted offers on unsettled invoices).
//                      Band: headroom < 0 → M3. The ceiling is versioned pack
//                      data (the M1 delta tightens it) — the detail string
//                      always names both figures and the deciding pack.
//   7. replayIntegrity — the most recent decisions replayed byte-identically
//                      against their recorded pack versions (PRD 3.2). Any
//                      mismatch is an integrity breach → M3. Band: ≥ 1 → M3.
//
//  Episode semantics: the episode key is the sorted set of breached guardrail
//  keys. Auto-escalation fires once per distinct episode; the operator's revert
//  within the episode is final until the breach set changes.

import { db } from "@/lib/db";
import { DEMO_TENANT } from "@/lib/api";
import { accountBalance, verifyLedgerIntegrity, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { packForMode, packForVersion } from "@/lib/rulepacks";
import { evaluateAdvance, evaluateSweep, type FeatureSnapshot } from "@/lib/ruleengine";
import { autoRollbackCanary } from "@/lib/canary";

const DAY = 86_400_000;

/** How many recent live decisions the integrity metric replays each
 * heartbeat. Replays are pure in-memory evaluations — the constant bounds the
 * work, not the honesty (the most recent book is what a tamperer targets). */
const REPLAY_INTEGRITY_WINDOW = 20;

export type GuardrailKey =
  | "disputeRate"
  | "lossRate"
  | "coverage30d"
  | "reconBreaks"
  | "railBreaker"
  | "portfolioCeiling"
  | "replayIntegrity";

/** Which escalate-mode each metric drives, per the published mode catalog.
 * An integrity-class breach always wins over a rail-class breach, which wins
 * over a cautious-class crossing: if the book is over the ceiling no new
 * funding may happen at all (M3), regardless of the rail; if payouts cannot
 * dispatch safely the platform quotes only (M2), regardless of limits. */
export const M1_GUARDRAIL_KEYS: readonly GuardrailKey[] = ["disputeRate", "lossRate", "coverage30d"];
export const M2_GUARDRAIL_KEYS: readonly GuardrailKey[] = ["reconBreaks", "railBreaker"];
export const M3_GUARDRAIL_KEYS: readonly GuardrailKey[] = ["portfolioCeiling", "replayIntegrity"];

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
 * (they watch the platform, not the pricing). The portfolioCeiling entry is
 * the fixed BREACH SEMANTIC (headroom < 0); the live ceiling figure itself is
 * versioned pack data, carried on the metric's detail string and published
 * via /api/status rulePacks. */
export const GUARDRAIL_BANDS: Record<GuardrailKey, { band: number; unit: GuardrailMetric["unit"] }> = {
  disputeRate: { band: 2_000, unit: "permyriad" }, // ≥ 20% → M1
  lossRate: { band: 2_000, unit: "permyriad" }, // ≥ 20% → M1
  coverage30d: { band: 0, unit: "fils" }, // projected position < floor → M1
  reconBreaks: { band: 1, unit: "count" }, // any break → M2
  railBreaker: { band: 1, unit: "count" }, // du Pay breaker open → M2
  portfolioCeiling: { band: 0, unit: "fils" }, // headroom < 0 → M3
  replayIntegrity: { band: 1, unit: "count" }, // any replay mismatch → M3
};

function fmtAed(fils: number): string {
  const neg = fils < 0;
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}AED ${grouped}${frac === 0 ? "" : `.${String(frac).padStart(2, "0")}`}`;
}

/** Byte-identical replay of one stored decision (the PRD 3.2 regression,
 * used here as an integrity tripwire). Returns null when the row cannot be
 * replayed honestly (unknown pack version / unreadable snapshot) — surfaced
 * as a mismatch, never silently passed. */
function replayDecisionMatches(d: { decisionType: string; featureSnapshot: string; rulepackVersion: string; outcome: string; limitFils: number | null; advanceRatePermyriad: number | null; priceMilliBpsPerDay: number | null; reasonCode: string; bindingRule: string }): boolean {
  const pack = packForVersion(d.rulepackVersion);
  if (pack === null) return false;
  let snap: FeatureSnapshot;
  try {
    snap = JSON.parse(d.featureSnapshot) as FeatureSnapshot;
  } catch {
    return false;
  }
  if (!snap || typeof snap !== "object" || !snap.decisionType || !snap.entity || !snap.portfolio) return false;
  if (d.decisionType === "treasury_sweep") {
    const r = evaluateSweep(snap, pack);
    return r.outcome === d.outcome && r.reasonCode === d.reasonCode && r.bindingRule === d.bindingRule;
  }
  const r = evaluateAdvance(snap, pack);
  return (
    r.outcome === d.outcome &&
    r.limitFils === d.limitFils &&
    r.advanceRatePermyriad === d.advanceRatePermyriad &&
    r.priceMilliBpsPerDay === d.priceMilliBpsPerDay &&
    r.reasonCode === d.reasonCode &&
    r.bindingRule === d.bindingRule
  );
}

/** Pure telemetry read — deterministic, no writes. The mode selects the
 * ACTIVE pack, whose portfolio ceiling is the one the funded book must
 * respect (the M1 cautious delta tightens it — that tightening is what makes
 * an existing book cross, the honest M3 cascade). */
export async function evaluateGuardrailTelemetry(mode: string | null): Promise<GuardrailsEval> {
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

  // 5. Payout-rail breaker — the du Pay breaker open means payouts cannot
  //    dispatch: exactly the M2 catalog condition ("payout rail unavailable").
  //    Read from the published breaker state, never guessed.
  const stBreakers = await db.statusState.findUnique({
    where: { id: "singleton" },
    select: { breakersJson: true },
  });
  let dupayOpen = false;
  try {
    const parsed = stBreakers?.breakersJson ? (JSON.parse(stBreakers.breakersJson) as Record<string, string>) : null;
    dupayOpen = parsed?.dupay === "open";
  } catch {
    dupayOpen = false;
  }

  // 6. Portfolio ceiling (E07): funded-book exposure vs the ACTIVE pack's
  //    ceiling. Exposure = accepted offers' principal on invoices that have
  //    not settled — the same contract the quote route evaluates. Headroom
  //    < 0 means the live book already crosses the ceiling that is supposed
  //    to bound it: the M3 catalog condition ("portfolio ceiling breach —
  //    no new funding; existing money keeps working").
  const activePack = packForMode(mode);
  const acceptedOffers = await db.offer.findMany({
    where: { tenantId: DEMO_TENANT, state: "accepted" },
    select: { principalFils: true, invoice: { select: { fundingState: true } } },
  });
  const bookExposureFils = acceptedOffers
    .filter((o) => o.invoice.fundingState !== "settled")
    .reduce((acc, o) => acc + o.principalFils, 0);
  const ceilingHeadroomFils = activePack.limits.portfolioCeilingFils - bookExposureFils; // < 0 → breach

  // 7. Replay integrity — the append-only decision store must still replay
  //    byte-identically (PRD 3.2). A row that no longer reproduces its own
  //    recorded outcome is an integrity breach, whatever wrote it.
  const recentDecisions = await db.decision.findMany({
    where: { tenantId: DEMO_TENANT, shadow: false },
    orderBy: { evaluatedAt: "desc" },
    take: REPLAY_INTEGRITY_WINDOW,
    select: {
      decisionType: true, featureSnapshot: true, rulepackVersion: true, outcome: true,
      limitFils: true, advanceRatePermyriad: true, priceMilliBpsPerDay: true,
      reasonCode: true, bindingRule: true,
    },
  });
  const replayMismatches = recentDecisions.reduce((acc, d) => acc + (replayDecisionMatches(d) ? 0 : 1), 0);

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
      detail: `Wallet + recallable − 30-day obligations = ${fmtAed(projectedPositionFils)} vs floor ${fmtAed(floorFils)}.`,
    },
    {
      key: "reconBreaks",
      value: recon.breaks.length,
      band: GUARDRAIL_BANDS.reconBreaks.band,
      unit: "count",
      breached: recon.breaks.length >= GUARDRAIL_BANDS.reconBreaks.band,
      detail: `${recon.txns} ledger transactions checked.`,
    },
    {
      key: "railBreaker",
      value: dupayOpen ? 1 : 0,
      band: GUARDRAIL_BANDS.railBreaker.band,
      unit: "count",
      breached: dupayOpen,
      detail: dupayOpen
        ? "du Pay payout rail breaker is open — payouts cannot dispatch."
        : "du Pay payout rail breaker is closed.",
    },
    {
      key: "portfolioCeiling",
      value: ceilingHeadroomFils,
      band: GUARDRAIL_BANDS.portfolioCeiling.band,
      unit: "fils",
      breached: ceilingHeadroomFils < GUARDRAIL_BANDS.portfolioCeiling.band,
      detail: `Funded book ${fmtAed(bookExposureFils)} vs active ceiling ${fmtAed(activePack.limits.portfolioCeilingFils)} (pack ${activePack.version}).`,
    },
    {
      key: "replayIntegrity",
      value: replayMismatches,
      band: GUARDRAIL_BANDS.replayIntegrity.band,
      unit: "count",
      breached: replayMismatches >= GUARDRAIL_BANDS.replayIntegrity.band,
      detail: recentDecisions.length === 0
        ? "No live decisions recorded yet — nothing to replay."
        : replayMismatches === 0
          ? `${recentDecisions.length} most-recent decisions replayed byte-identically against their recorded packs.`
          : `${replayMismatches} of ${recentDecisions.length} most-recent decisions FAILED byte-identical replay.`,
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
  /** True when THIS call auto-applied the escalation (once per episode). */
  autoApplied: boolean;
  /** The auto-transition reason, for the ops panel and audit trail. */
  autoReason: string | null;
  /** The mode this escalation applied ("M1" | "M2" | "M3" | null). */
  autoMode: "M1" | "M2" | "M3" | null;
}

/** The automatic side of PRD Part 8: escalate when a guardrail warning band
 * is crossed — to M1 (cautious pack) for loss/dispute/forecast guardrails,
 * to M2 (quote-only) when the payout rail breaker is open or a
 * reconciliation break is unresolved, to M3 (funding suspended) when the
 * funded book crosses the active portfolio ceiling or the decision store
 * fails a replay-integrity check — exactly the catalog conditions for each
 * mode. Escalation fires from M0, and additionally from M1 for an M3-class
 * breach (the cautious delta tightening the ceiling under an existing book
 * is the platform's own doing — the suspension is the honest consequence).
 * Once per distinct breach episode; never called inside another write
 * transaction; failures are swallowed by the caller (the status endpoint
 * must never fail). */
export async function enforceGuardrails(): Promise<GuardrailEnforcementResult> {
  const st = await db.statusState.findUnique({ where: { id: "singleton" } });
  const evaluation = await evaluateGuardrailTelemetry(st?.mode ?? "M0");

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
    return { evaluation, autoApplied: false, autoReason: null, autoMode: null };
  }

  // Automation escalates FROM M0 (any class), and FROM M1 only for an
  // M3-class breach — the honest cascade below an operator's cautious mode.
  // Any other mode (an operator's M2/M3/M4, or M1 crossed only by M1-class
  // bands) already reflects a human or prior escalation.
  const m3Class = evaluation.breachedKeys.some((k) => M3_GUARDRAIL_KEYS.includes(k));
  if (!st || (st.mode !== "M0" && !(st.mode === "M1" && m3Class))) {
    return { evaluation, autoApplied: false, autoReason: null, autoMode: null };
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
    return { evaluation, autoApplied: false, autoReason: null, autoMode: null };
  }

  // Target mode per the published catalog — the strictest crossed class wins:
  // integrity (M3) > rail (M2) > cautious (M1).
  const targetMode: "M1" | "M2" | "M3" = m3Class
    ? "M3"
    : evaluation.breachedKeys.some((k) => M2_GUARDRAIL_KEYS.includes(k))
      ? "M2"
      : "M1";
  const reason =
    targetMode === "M3"
      ? `automatic — guardrail warning band crossed: ${evaluation.breachedKeys.join(", ")}. ` +
        `Mode M3 (funding suspended): no new funding of any kind; positions, collections, escrow releases and recalls continue. The guardrail that fired is named on the event — recovery stays a human decision.`
      : targetMode === "M2"
        ? `automatic — guardrail warning band crossed: ${evaluation.breachedKeys.join(", ")}. ` +
          `Mode M2 (quote-only): quotes continue and are honoured at the quoted price, acceptances queue, no money moves until the rail is back.`
        : `automatic — guardrail warning band crossed: ${evaluation.breachedKeys.join(", ")}. ` +
          `Rule pack 2026.10.3 → 2026.10.3-cautious.1 (advance rates reduced, limits tightened; pricing unchanged).`;

  await db.$transaction(async (tx) => {
    await tx.statusState.update({
      where: { id: "singleton" },
      data: {
        mode: targetMode,
        // The episode record carries the reason so the ops banner can keep
        // narrating the escalation on every later read — not just the exact
        // heartbeat that fired it.
        guardrailEpisodeJson: JSON.stringify({ episodeKey: evaluation.episodeKey, mode: targetMode, reason, at: new Date().toISOString() }),
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
            mode: targetMode,
          }),
        },
      });
    }
    await tx.operatorAction.create({
      data: {
        actor: "system:guardrails",
        action: targetMode === "M3" ? "guardrail_auto_m3" : targetMode === "M2" ? "guardrail_auto_m2" : "guardrail_auto_m1",
        targetRef: "status",
        reason,
        detailJson: JSON.stringify({
          episodeKey: evaluation.episodeKey,
          appliedMode: targetMode,
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
          mode: targetMode,
          message: null,
          automatic: true,
          actor: "system:guardrails",
          reason,
        }),
      },
    });
  });

  // PRD 3.3 canary auto-rollback: a guardrail escalation invalidates the
  // experiment — the base pack serves all traffic again. Best-effort by
  // design (a rollback failure must never fail the escalation itself).
  try {
    const rolledBack = await autoRollbackCanary(reason, targetMode);
    if (rolledBack) {
      await db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "canary.rolled_back",
          subjectRef: "rulepack:candidate",
          payloadJson: JSON.stringify({
            automatic: true,
            escalatedTo: targetMode,
            reason: `Guardrail escalation to ${targetMode} withdrew the canary — the base pack serves all traffic again. Offers quoted under the candidate re-quote at the base price.`,
          }),
        },
      });
    }
  } catch (e) {
    console.error("[guardrails] canary auto-rollback", e);
  }

  return { evaluation, autoApplied: true, autoReason: reason, autoMode: targetMode };
}

/** The published view block (additive on /api/status). */
export interface GuardrailsView {
  evaluatedAt: string;
  metrics: { key: GuardrailKey; value: number; band: number; unit: GuardrailMetric["unit"]; breached: boolean; detail: string }[];
  autoTriggeredNow: boolean;
  /** The episode key that last auto-applied an escalation (null if automation never fired). */
  lastAutoEpisode: string | null;
  /** The mode the last auto-escalation applied ("M1" | "M2" | "M3" | null). */
  lastAutoMode: "M1" | "M2" | "M3" | null;
  autoReason: string | null;
}

export async function guardrailsView(evaluation: GuardrailsEval, autoApplied: boolean, autoReason: string | null): Promise<GuardrailsView> {
  let lastAutoEpisode: string | null = null;
  let lastAutoMode: "M1" | "M2" | "M3" | null = null;
  let lastAutoReason: string | null = null;
  try {
    const st = await db.statusState.findUnique({ where: { id: "singleton" }, select: { guardrailEpisodeJson: true } });
    const parsed = st?.guardrailEpisodeJson ? (JSON.parse(st.guardrailEpisodeJson) as { episodeKey?: string; mode?: string; reason?: string }) : null;
    lastAutoEpisode = parsed?.episodeKey ?? null;
    lastAutoMode = parsed?.mode === "M3" ? "M3" : parsed?.mode === "M2" ? "M2" : parsed?.mode === "M1" ? "M1" : null;
    lastAutoReason = typeof parsed?.reason === "string" ? parsed.reason : null;
  } catch {
    lastAutoEpisode = null;
    lastAutoMode = null;
    lastAutoReason = null;
  }
  return {
    evaluatedAt: new Date().toISOString(),
    metrics: evaluation.metrics.map((m) => ({ key: m.key, value: m.value, band: m.band, unit: m.unit, breached: m.breached, detail: m.detail })),
    autoTriggeredNow: autoApplied,
    lastAutoEpisode,
    lastAutoMode,
    // Prefer the live reason from THIS heartbeat; otherwise the recorded
    // episode reason — the escalation stays narrated on every read.
    autoReason: autoReason ?? lastAutoReason,
  };
}
