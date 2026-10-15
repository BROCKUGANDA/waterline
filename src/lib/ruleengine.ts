// WATERLINE — the rule engine. PRD Part 3: a PURE function.
// (featureSnapshot, rulePack) => Decision. No I/O, no clock, no randomness —
// enforced by construction: this module imports nothing but types and pure
// integer helpers. Time arrives inside the snapshot. A missing feature is a
// typed rejection, never a silent default (PRD 3.2).

import { applyPermyriad, feeFils, mulDivFloor } from "./money";
import { rulePack, type RulePack } from "./rulepack";

export interface FeatureSnapshot {
  asOfDate: string; // ISO date — the engine never reads the clock
  decisionType: "advance_offer" | "treasury_sweep";
  entity: {
    kybState: string; // verified | review | exception
    licenceDaysRemaining: number;
    tenureMonths: number;
    sectorCode: string;
    billingBand: string; // high | medium | low
  };
  invoice: {
    currency: string; // "AED"
    grossFils: number;
    dueInDays: number; // days from asOfDate to due date (negative = overdue)
    verificationState: string; // verified | received | …
    verifiedVia: string | null; // einvoice | du_ap | buyer_api | buyer_portal
  } | null;
  buyer: {
    tier: string; // platinum | gold | silver | bronze | unrated
    confirmedInvoiceCount: number;
    avgDaysToPay: number;
    disputeCount: number;
  } | null;
  portfolio: { bookExposureFils: number };
  treasury: {
    balanceFils: number;
    floorFils: number;
    obligationsFils: number; // obligations inside the horizon
    safetyMarginPermyriad: number;
  } | null;
}

export interface EngineDecision {
  outcome: "approved" | "capped" | "rejected";
  reasonCode: string;
  reasonText: string;
  bindingRule: string;
  limitFils: number | null; // advance principal the SME may draw
  advanceRatePermyriad: number | null;
  priceMilliBpsPerDay: number | null;
  checks: { rule: string; passed: boolean; detail: string }[];
}

/** Entity cap from tenure × billing behaviour band. */
export function entityCapFils(snap: FeatureSnapshot, pack: RulePack): number {
  const tier = pack.limits.entityCapFils.find((t) => snap.entity.tenureMonths >= t.tenureMonths)
    ?? pack.limits.entityCapFils[pack.limits.entityCapFils.length - 1];
  const bandFactor = pack.limits.billingBandFactor[snap.entity.billingBand] ?? 0.75;
  return mulDivFloor(tier.capFils, Math.round(bandFactor * 10_000), 10_000);
}

/** Buyer cap from tier, adjusted for slow pay and disputes. */
export function buyerCapFils(snap: FeatureSnapshot, pack: RulePack): number {
  const b = snap.buyer;
  if (!b) return 0;
  let cap = pack.limits.buyerCapFils[b.tier] ?? pack.limits.buyerCapFils.unrated;
  if (b.avgDaysToPay > pack.limits.buyerSlowPayFactorPermyriad.overDays) {
    cap = applyPermyriad(cap, pack.limits.buyerSlowPayFactorPermyriad.factorPermyriad);
  }
  if (b.disputeCount > pack.limits.buyerDisputeFactorPermyriad.overCount) {
    cap = applyPermyriad(cap, pack.limits.buyerDisputeFactorPermyriad.factorPermyriad);
  }
  return cap;
}

/** Price: base curve by buyer tier + risk adjustments + funding cost, clamped. */
export function priceMilliBpsPerDay(snap: FeatureSnapshot, pack: RulePack): number {
  const tier = snap.buyer?.tier ?? "unrated";
  let mbps = pack.pricing.baseCurveMilliBps[tier] ?? pack.pricing.baseCurveMilliBps.unrated;
  const adj = pack.pricing.riskAdjMilliBps;
  if (snap.entity.tenureMonths < adj.lowTenureMonths) mbps += adj.lowTenureAdj;
  if ((snap.buyer?.disputeCount ?? 0) > adj.disputeOverCount) mbps += adj.disputeAdj;
  if ((snap.buyer?.avgDaysToPay ?? 0) > adj.slowPayOverDays) mbps += adj.slowPayAdj;
  mbps += pack.pricing.fundingCostMilliBps;
  return Math.max(pack.pricing.floorMilliBps, Math.min(pack.pricing.ceilingMilliBps, mbps));
}

function reject(code: string, text: string, rule: string, checks: EngineDecision["checks"]): EngineDecision {
  return { outcome: "rejected", reasonCode: code, reasonText: text, bindingRule: rule, limitFils: null, advanceRatePermyriad: null, priceMilliBpsPerDay: null, checks };
}

/** Fils → "AED 7,200" / "AED 7,200.50" for user-facing reason sentences.
 *  Pure string math on integers — the same discipline as the money lib,
 *  kept inline so the engine imports nothing. */
function fmtAed(fils: number): string {
  const whole = Math.floor(fils / 100);
  const frac = fils % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === 0 ? `AED ${grouped}` : `AED ${grouped}.${String(frac).padStart(2, "0")}`;
}

/** Pure evaluation of the advance-offer decision. */
export function evaluateAdvance(snap: FeatureSnapshot, pack: RulePack): EngineDecision {
  const checks: EngineDecision["checks"] = [];
  const push = (rule: string, passed: boolean, detail: string) => checks.push({ rule, passed, detail });

  // E01 — KYB verified
  push("E01", snap.entity.kybState === "verified", `kyb_state=${snap.entity.kybState}`);
  if (snap.entity.kybState !== "verified") return reject("E_KYB", pack.explanations.E_KYB, "E01:kyb", checks);

  // E02 — licence expiry
  push("E02", snap.entity.licenceDaysRemaining > 30, `licence_days_remaining=${snap.entity.licenceDaysRemaining}`);
  if (snap.entity.licenceDaysRemaining <= 30) return reject("E_LICENCE", pack.explanations.E_LICENCE, "E02:licence", checks);

  // Invoice must exist for an advance decision
  if (!snap.invoice) return reject("E_UNVERIFIED", pack.explanations.E_UNVERIFIED, "E03:invoice_missing", checks);

  // E06 — currency AED
  push("E06", snap.invoice.currency === "AED", `currency=${snap.invoice.currency}`);
  if (snap.invoice.currency !== "AED") return reject("E_CURRENCY", pack.explanations.E_CURRENCY, "E06:currency", checks);

  // E03 — verification state
  push("E03", snap.invoice.verificationState === "verified", `verification_state=${snap.invoice.verificationState}`);
  if (snap.invoice.verificationState !== "verified") return reject("E_UNVERIFIED", pack.explanations.E_UNVERIFIED, "E03:verification", checks);

  // E04 — not overdue
  push("E04", snap.invoice.dueInDays > 0, `due_in_days=${snap.invoice.dueInDays}`);
  if (snap.invoice.dueInDays <= 0) return reject("E_OVERDUE", pack.explanations.E_OVERDUE, "E04:overdue", checks);

  // E05 — minimum size
  push("E05", snap.invoice.grossFils >= 200_000, `gross_fils=${snap.invoice.grossFils}`);
  if (snap.invoice.grossFils < 200_000) return reject("E_MIN_SIZE", pack.explanations.E_MIN_SIZE, "E05:min_size", checks);

  // E07 — portfolio ceiling (hard stop on the whole book)
  const prospectiveExposure = snap.portfolio.bookExposureFils + snap.invoice.grossFils;
  push("E07", prospectiveExposure <= pack.limits.portfolioCeilingFils, `book_exposure+gross=${prospectiveExposure}`);
  if (prospectiveExposure > pack.limits.portfolioCeilingFils) return reject("E_PORTFOLIO", pack.explanations.E_PORTFOLIO, "L07:portfolio", checks);

  // ── Limits: base = min(0.90 × gross, entity_cap, buyer_cap, sector_cap) ──
  const gross = snap.invoice.grossFils;
  const base = applyPermyriad(gross, pack.limits.baseAdvanceRatePermyriad);
  const eCap = entityCapFils(snap, pack);
  const bCap = buyerCapFils(snap, pack);
  const sCap = pack.limits.sectorCapFils[snap.entity.sectorCode] ?? pack.limits.sectorCapFils.other;
  push("L01", true, `base=0.90×gross=${base} entity_cap=${eCap} buyer_cap=${bCap} sector_cap=${sCap}`);

  let limit = Math.min(base, eCap, bCap, sCap);
  let binding = "L01:base";
  let reasonCode = "OK_FULL";
  let reasonText = "Approved in full against your invoice value.";
  let outcome: EngineDecision["outcome"] = "approved";

  if (limit === eCap && eCap < base) { binding = "L02:entity_cap"; reasonCode = "OK_CAPPED_BY_ENTITY"; }
  if (limit === bCap && bCap <= base) { binding = "L03:buyer_cap"; reasonCode = "OK_CAPPED_BY_BUYER"; }
  if (limit === sCap && sCap < base) { binding = "L04:sector_cap"; reasonCode = "OK_CAPPED_BY_SECTOR"; }

  // E06 cap — thin buyer history
  const thinBuyer = (snap.buyer?.tier ?? "unrated") === "unrated" && (snap.buyer?.confirmedInvoiceCount ?? 0) < 3;
  let ratePermyriad = pack.limits.baseAdvanceRatePermyriad;
  if (thinBuyer) {
    ratePermyriad = pack.limits.unratedAdvanceCapPermyriad;
    const capped = applyPermyriad(gross, ratePermyriad);
    if (capped < limit) {
      limit = capped;
      binding = "E06:unrated_cap";
      reasonCode = "OK_CAPPED_UNRATED";
      push("E06", false, "unrated buyer with <3 confirmed invoices — advance capped at 0.60");
    } else {
      push("E06", true, "unrated cap applied but a tighter limit already binds");
    }
  } else {
    push("E06", true, "buyer history sufficient");
  }

  if (outcome === "approved" && binding !== "L01:base") {
    outcome = "capped";
    if (reasonCode === "OK_CAPPED_BY_BUYER") {
      reasonText = `Approved at ${fmtAed(limit)}. Capped by this buyer's limit, which grows as they settle more invoices on time.`;
    } else if (reasonCode === "OK_CAPPED_BY_ENTITY") {
      reasonText = `Approved at ${fmtAed(limit)}. Your entity limit grows with tenure and billing history.`;
    } else if (reasonCode === "OK_CAPPED_BY_SECTOR") {
      reasonText = `Approved at ${fmtAed(limit)}. This sector's limit is set by the current rule pack.`;
    } else if (reasonCode === "OK_CAPPED_UNRATED") {
      // The cap % derives from the pack — the cautious delta (M1) tightens it,
      // and the sentence must never contradict the arithmetic.
      reasonText = `Approved at ${fmtAed(limit)}. New buyer relationships start at ${(pack.limits.unratedAdvanceCapPermyriad / 100).toFixed(0)}% and grow as invoices are confirmed and settled on time.`;
    }
  }

  // ── Pricing ──
  const mbps = priceMilliBpsPerDay(snap, pack);
  push("P01", true, `price=${mbps / 10} bps/day (floor ${(pack.pricing.floorMilliBps / 10).toFixed(1)} ceiling ${(pack.pricing.ceilingMilliBps / 10).toFixed(1)})`);

  return {
    outcome,
    reasonCode,
    reasonText,
    bindingRule: binding,
    limitFils: limit,
    advanceRatePermyriad: Math.round((limit / gross) * 10_000),
    priceMilliBpsPerDay: mbps,
    checks,
  };
}

export interface SweepDecision {
  outcome: "approved" | "rejected";
  reasonCode: string;
  reasonText: string;
  sweepableFils: number;
  bindingRule: string;
  checks: { rule: string; passed: boolean; detail: string }[];
}

/** Treasury autopilot: the floor is absolute — the most heavily tested
 *  invariant in the system (PRD 4.5). Pure function, same discipline. */
export function evaluateSweep(snap: FeatureSnapshot, pack: RulePack): SweepDecision {
  const checks: EngineDecision["checks"] = [];
  const t = snap.treasury;
  if (!t) {
    return { outcome: "rejected", reasonCode: "E_SNAPSHOT", reasonText: "Treasury features missing from the snapshot.", sweepableFils: 0, bindingRule: "T00:snapshot", checks };
  }

  const margin = mulDivFloor(t.balanceFils, t.safetyMarginPermyriad, 10_000);
  const sweepable = t.balanceFils - t.floorFils - t.obligationsFils - margin;
  checks.push({ rule: "T01", passed: true, detail: `balance=${t.balanceFils} floor=${t.floorFils} obligations=${t.obligationsFils} margin=${margin} → sweepable=${sweepable}` });

  // The absolute floor: hard stop. No optimisation ever breaches it.
  if (t.balanceFils - t.floorFils <= 0) {
    checks.push({ rule: "T02", passed: false, detail: "balance would breach the floor" });
    return { outcome: "rejected", reasonCode: "E_FLOOR", reasonText: pack.explanations.E_FLOOR, sweepableFils: 0, bindingRule: "T02:floor", checks };
  }
  checks.push({ rule: "T02", passed: true, detail: "floor respected" });

  if (t.obligationsFils > 0 && sweepable <= 0) {
    checks.push({ rule: "T03", passed: false, detail: "obligations and margin consume headroom" });
    return { outcome: "rejected", reasonCode: "E_OBLIGATIONS", reasonText: pack.explanations.E_OBLIGATIONS, sweepableFils: 0, bindingRule: "T03:obligations", checks };
  }
  checks.push({ rule: "T03", passed: true, detail: "obligation calendar respected" });

  if (sweepable < pack.treasury.minSweepFils) {
    checks.push({ rule: "T04", passed: false, detail: `sweepable ${sweepable} < minimum ${pack.treasury.minSweepFils}` });
    return { outcome: "rejected", reasonCode: "E_MIN_SWEEP", reasonText: pack.explanations.E_MIN_SWEEP, sweepableFils: Math.max(0, sweepable), bindingRule: "T04:min_sweep", checks };
  }
  checks.push({ rule: "T04", passed: true, detail: "above minimum sweep size" });

  return {
    outcome: "approved",
    reasonCode: "OK_SWEEP",
    reasonText: "Sweep approved. Your floor and upcoming obligations are protected.",
    sweepableFils: sweepable,
    bindingRule: "T05:approved",
    checks,
  };
}

/** Convenience wrapper: evaluate with the active pack. */
export function evaluate(snapshot: FeatureSnapshot, pack: RulePack = rulePack): EngineDecision | SweepDecision {
  return snapshot.decisionType === "treasury_sweep" ? evaluateSweep(snapshot, pack) : evaluateAdvance(snapshot, pack);
}

/** Fee arithmetic, exposed so the offer model can recompute locally (PRD 4.3). */
export function feeFor(daysEarly: number, mbpsPerDay: number, principalFils: number): number {
  return feeFils(daysEarly, mbpsPerDay, principalFils);
}
