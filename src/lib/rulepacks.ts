// WATERLINE — the rule-pack REGISTRY (PRD 3.3 promotion lifecycle + Part 8 M1).
// One build, two pack versions:
//   2026.10.3            — the base pack (risk-committee signed)
//   2026.10.3-cautious.1 — the M1 cautious delta, active only while the
//                          platform mode is M1. The delta itself is versioned
//                          DATA with a rationale — never a model decision, and
//                          never applied silently: the active version is
//                          published on /api/status and recorded on every
//                          decision row, so replay is always exact (PRD 3.2:
//                          "Replaying the same hash against the same pack
//                          version must produce a byte-identical outcome").
//
// The delta implements the PRD M1 behaviour row: "Advance rates reduced by a
// rule-pack delta, new buyer relationships capped, limits harder, manual
// review threshold lowered." Pricing curves and ALL treasury parameters are
// deliberately UNCHANGED — M1 tightens limits, it does not reprice; treasury
// keeps working normally in every mode except M4.

import { rulePack, type RulePack } from "./rulepack";

export const BASE_PACK_VERSION = rulePack.version;
export const CAUTIOUS_PACK_VERSION = "2026.10.3-cautious.1";

/** The cautious pack — every changed field is listed here, with the reason.
 *  Anything not listed is byte-identical to the base pack. */
export const CAUTIOUS_PACK: RulePack = {
  ...rulePack,
  version: CAUTIOUS_PACK_VERSION,
  effectiveFrom: "2026-10-15T00:00:00Z",
  limits: {
    ...rulePack.limits,
    // Advance rates reduced: 0.90 → 0.75
    baseAdvanceRatePermyriad: 7500,
    // New buyer relationships capped harder: 0.60 → 0.50
    unratedAdvanceCapPermyriad: 5000,
    // Limits harder: every buyer-tier cap × 0.8
    buyerCapFils: {
      platinum: 9_600_000,
      gold: 6_400_000,
      silver: 4_000_000,
      bronze: 2_000_000,
      unrated: 1_200_000,
    },
    // Funding-book ceiling tightened for the demo book: AED 500,000 → 100,000.
    // This is what surfaces E_PORTFOLIO honestly in cautious mode: once the
    // outstanding funded advances reach the tightened ceiling, new quotes
    // pause with the plain-language note and resume as invoices settle.
    portfolioCeilingFils: 10_000_000,
  },
};

/** Human-readable delta lines — published on /api/status so the ops console
 *  states exactly what the cautious pack changes (never guessed). */
export const CAUTIOUS_DELTA_SUMMARY: { field: string; from: string; to: string; reason: string }[] = [
  { field: "Advance rate (base)", from: "90%", to: "75%", reason: "Advance rates reduced by the rule-pack delta" },
  { field: "New-buyer cap", from: "60%", to: "50%", reason: "New buyer relationships capped harder" },
  { field: "Buyer-tier limits", from: "×1.0", to: "×0.8", reason: "Limits harder across every tier" },
  { field: "Portfolio ceiling", from: "AED 500,000", to: "AED 100,000", reason: "Funding book tightened — E07 pauses new quotes at the ceiling" },
  { field: "Pricing curves", from: "unchanged", to: "unchanged", reason: "M1 tightens limits, never reprices" },
  { field: "Treasury parameters", from: "unchanged", to: "unchanged", reason: "The autopilot keeps working normally" },
  { field: "Manual review threshold", from: "standard", to: "lowered", reason: "Ops reviews more approvals during the cautious window" },
];

/** Version → pack. Unknown versions return null — callers must surface the
 *  drift honestly, never silently fall back to a different pack. */
export const PACK_REGISTRY: Record<string, RulePack> = {
  [BASE_PACK_VERSION]: rulePack,
  [CAUTIOUS_PACK_VERSION]: CAUTIOUS_PACK,
};

/** The pack that decides advance offers right now. Only M1 selects the
 *  cautious delta (PRD Part 8); every other mode — including M2/M3/M4, whose
 *  behaviours are about rails and integrity, not pricing — uses the base pack.
 *  Treasury sweeps always evaluate against the base pack: the M1 delta does
 *  not touch treasury parameters, and the sweep routes record the base
 *  version on their decisions, so replay stays exact. */
export function packForMode(mode: string | null | undefined): RulePack {
  return mode === "M1" ? CAUTIOUS_PACK : rulePack;
}

/** Replay lookup: the pack a decision was ACTUALLY made under (PRD 3.2). */
export function packForVersion(version: string): RulePack | null {
  return PACK_REGISTRY[version] ?? null;
}
