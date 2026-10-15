// WATERLINE — the rule pack. PRD Part 3: eligibility, limits and prices are
// decided here, in DATA, not code. Versioned, signed, replayable, promotable
// independently of any deployment. Integer fixed-point throughout:
//   permyriad = ×10,000 (9000 = 0.90 advance rate)
//   milliBps  = bps × 10 (34 = 3.4 bps/day)

export interface EligibilityRule {
  id: string;
  description: string;
  reasonCode: string;
  explanation: string; // plain language, shown to the SME
}

export interface RulePack {
  version: string;
  signedBy: string;
  effectiveFrom: string;
  eligibility: EligibilityRule[];
  limits: {
    baseAdvanceRatePermyriad: number;
    entityCapFils: { tenureMonths: number; capFils: number }[];
    billingBandFactor: Record<string, number>; // permyriad fraction of cap
    buyerCapFils: Record<string, number>;
    buyerSlowPayFactorPermyriad: { overDays: number; factorPermyriad: number };
    buyerDisputeFactorPermyriad: { overCount: number; factorPermyriad: number };
    sectorCapFils: Record<string, number>;
    unratedAdvanceCapPermyriad: number; // E06
    portfolioCeilingFils: number;
  };
  pricing: {
    baseCurveMilliBps: Record<string, number>;
    riskAdjMilliBps: {
      lowTenureMonths: number;
      lowTenureAdj: number;
      disputeOverCount: number;
      disputeAdj: number;
      slowPayOverDays: number;
      slowPayAdj: number;
    };
    fundingCostMilliBps: number;
    floorMilliBps: number; // 1.2 bps
    ceilingMilliBps: number; // 9.0 bps
  };
  treasury: {
    minSweepFils: number;
    instrumentMaxMaturityDays: number;
    instruments: { ref: string; name: string; yieldMbsdPermyriad: number; maturityDays: number; liquidityDays: number }[];
  };
  explanations: Record<string, string>;
}

export const RULEPACK_VERSION = "2026.10.3";

export const rulePack: RulePack = {
  version: "2026.10.3",
  signedBy: "risk-committee",
  effectiveFrom: "2026-10-15T00:00:00Z",

  eligibility: [
    { id: "E01", description: "KYB must be verified", reasonCode: "E_KYB", explanation: "We need your trade licence verified before we can price this." },
    { id: "E02", description: "Trade licence must have more than 30 days to run", reasonCode: "E_LICENCE", explanation: "Your trade licence expires within 30 days. Renew to continue." },
    { id: "E03", description: "Invoice must be buyer-verified", reasonCode: "E_UNVERIFIED", explanation: "Your buyer hasn't confirmed this invoice yet." },
    { id: "E04", description: "Invoice must not be overdue", reasonCode: "E_OVERDUE", explanation: "This invoice is already past due, so it moves to collections support instead of early payment." },
    { id: "E05", description: "Invoice gross at least AED 2,000", reasonCode: "E_MIN_SIZE", explanation: "Early payment starts at AED 2,000 per invoice." },
    { id: "E06", description: "Currency must be AED", reasonCode: "E_CURRENCY", explanation: "Phase 1 prices AED invoices only. Foreign-currency invoices are out of scope." },
    { id: "E07", description: "Portfolio exposure below the ceiling", reasonCode: "E_PORTFOLIO", explanation: "Our funding book is at its portfolio ceiling right now. New early payments resume as invoices settle." },
  ],

  limits: {
    baseAdvanceRatePermyriad: 9000, // 0.90
    entityCapFils: [
      { tenureMonths: 36, capFils: 15_000_000 },
      { tenureMonths: 24, capFils: 10_000_000 },
      { tenureMonths: 12, capFils: 6_000_000 },
      { tenureMonths: 0, capFils: 3_000_000 },
    ],
    billingBandFactor: { high: 1.0, medium: 0.75, low: 0.5 },
    buyerCapFils: { platinum: 12_000_000, gold: 8_000_000, silver: 5_000_000, bronze: 2_500_000, unrated: 1_500_000 },
    buyerSlowPayFactorPermyriad: { overDays: 60, factorPermyriad: 8000 },
    buyerDisputeFactorPermyriad: { overCount: 2, factorPermyriad: 7000 },
    sectorCapFils: { services: 10_000_000, manufacturing: 9_000_000, retail: 8_000_000, trading: 7_000_000, construction: 6_000_000, other: 5_000_000 },
    unratedAdvanceCapPermyriad: 6000, // 0.60 — E06 cap for thin buyer history
    portfolioCeilingFils: 50_000_000, // AED 500,000 demo book ceiling
  },

  pricing: {
    baseCurveMilliBps: { platinum: 26, gold: 30, silver: 36, bronze: 42, unrated: 48 },
    riskAdjMilliBps: {
      lowTenureMonths: 12,
      lowTenureAdj: 4,
      disputeOverCount: 2,
      disputeAdj: 6,
      slowPayOverDays: 60,
      slowPayAdj: 4,
    },
    fundingCostMilliBps: 12,
    floorMilliBps: 12, // 1.2 bps/day
    ceilingMilliBps: 90, // 9.0 bps/day
  },

  treasury: {
    minSweepFils: 500_000, // AED 5,000
    instrumentMaxMaturityDays: 7,
    instruments: [
      { ref: "EMRD-SD", name: "Emirates Short Duration MMF", yieldMbsdPermyriad: 45, maturityDays: 7, liquidityDays: 0 },
      { ref: "ADIB-OPN", name: "Bank Open Notice Deposit", yieldMbsdPermyriad: 32, maturityDays: 1, liquidityDays: 0 },
      { ref: "FAB-COLL", name: "Collateralised Lending Facility", yieldMbsdPermyriad: 58, maturityDays: 7, liquidityDays: 1 },
    ],
  },

  explanations: {
    E_KYB: "We need your trade licence verified before we can price this.",
    E_LICENCE: "Your trade licence expires within 30 days. Renew to continue.",
    E_UNVERIFIED: "Your buyer hasn't confirmed this invoice yet.",
    E_OVERDUE: "This invoice is already past due, so early payment isn't available.",
    E_MIN_SIZE: "Early payment starts at AED 2,000 per invoice.",
    E_CURRENCY: "Phase 1 prices AED invoices only.",
    E_PORTFOLIO: "Our funding book is at its portfolio ceiling. New early payments resume as invoices settle.",
    E_FLOOR: "Your minimum balance is protected — nothing is swept below the floor you set.",
    E_OBLIGATIONS: "Upcoming obligations keep this cash working for payroll and rent.",
    E_MIN_SWEEP: "The sweepable amount is below the AED 5,000 minimum for treasury moves.",
  },
};
