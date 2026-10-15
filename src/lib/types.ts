// WATERLINE — shared DTO types matching the API contract exactly.
// Money is always integer fils. Dates are ISO strings.

export type VerificationState =
  | "received" | "parsed" | "deduped" | "verified"
  | "unverifiable" | "disputed" | "superseded" | "duplicate";

export type FundingState = "none" | "quoted" | "accepted" | "settled";

export interface BuyerInfo {
  id: string;
  buyerName: string;
  tier: "platinum" | "gold" | "silver" | "bronze" | "unrated";
  avgDaysToPay: number;
  confirmedInvoiceCount: number;
  relationshipAgeDays?: number;
  disputeCount?: number;
  buyerEmirate?: string;
}

export interface InvoiceDto {
  id: string;
  externalRef: string;
  buyerLinkId: string;
  buyer?: { id: string; buyerName: string; tier: string; avgDaysToPay?: number };
  grossFils: number;
  taxFils: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  dueInDays: number;
  source: string;
  verificationState: VerificationState;
  verifiedVia: string | null;
  verifiedAt: string | null;
  fundingState: FundingState;
  invoiceHash?: string;
  /** Payout pipeline state when funded — "queued" = accepted while the rail was down, money has NOT moved. */
  payoutState?: string | null;
  latestOffer?: { id: string; state: string; principalFils: number; rateMilliBps: number; expiresAt: string; netProceedsFils?: number | null } | null;
  latestDecision?: { outcome: string; reasonCode: string; reasonText: string; reasonCodeText?: string } | null;
}

export interface DecisionCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface DecisionDto {
  id: string;
  subjectRef: string;
  subjectType: string;
  decisionType: string;
  inputHash: string;
  rulepackVersion: string;
  outcome: "approved" | "capped" | "rejected";
  limitFils: number | null;
  advanceRatePermyriad: number | null;
  priceMilliBpsPerDay: number | null;
  bindingRule: string;
  reasonCode: string;
  reasonText: string;
  evaluatedAt: string;
  actor: string;
  shadow: boolean;
  featureSnapshot?: unknown;
  checks?: DecisionCheck[];
  subjectLabel?: string;
}

export interface QuoteResponse {
  decision: DecisionDto;
  offer: {
    id: string;
    grossFils: number;
    principalFils: number;
    rateMilliBps: number;
    expiresAt: string;
    state: string;
  } | null;
  rateCurve?: { mbpsPerDay: number | null };
}

export interface OfferDto {
  id: string;
  invoiceId: string;
  grossFils: number;
  advanceRatePermyriad: number;
  principalFils: number;
  rateMilliBps: number;
  expiresAt: string;
  state: "offered" | "accepted" | "expired";
  settlementDate: string | null;
  daysEarly: number | null;
  feeFils: number | null;
  netProceedsFils: number | null;
  acceptedAt: string | null;
}

export interface PayoutStage {
  key: "accepted" | "reserved" | "sent" | "settled";
  label: string;
  at: string | null;
}

export interface PayoutDto {
  id: string;
  offerId: string;
  rail: "dupay" | "aani";
  destinationRef: string;
  amountFils: number;
  state: string;
  providerRef: string | null;
  acceptedAt: string;
  etaSeconds: number;
  stage: string;
  stageIndex: number;
  stages: PayoutStage[];
  elapsedMs: number;
}

export interface MilestoneDto {
  id: string;
  contractId: string;
  sequence: number;
  description: string;
  amountFils: number;
  conditionType: "buyer_approval" | "document_review" | "time_release";
  reviewWindowDays: number;
  evidenceRef: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  metAt: string | null;
  releasedAt: string | null;
  state: "pending" | "in_review" | "met" | "released" | "disputed";
}

export interface EscrowContractDto {
  id: string;
  buyerName: string;
  buyerEntityName?: string;
  custodianRef: string;
  description: string;
  totalFils: number;
  state: "funded" | "active" | "completed" | "terminated";
  createdAt: string;
  completedAt: string | null;
  milestones: MilestoneDto[];
  releasedFils?: number;
  pendingFils?: number;
}

export interface TreasuryPolicyDto {
  floorFils: number;
  horizonDays: number;
  safetyMarginPermyriad: number;
  autoPilotEnabled: boolean;
}

export interface ObligationDto {
  id: string;
  label: string;
  kind: "payroll" | "rent" | "vat" | "supplier" | "du_bill" | "custom";
  dueDate: string;
  amountFils: number;
  cadence: string;
  confidencePermyriad: number;
  dueInDays?: number;
}

export interface InstrumentDto {
  ref: string;
  name: string;
  yieldMbsdPermyriad: number;
  maturityDays: number;
  liquidityDays: number;
}

export interface SweepDto {
  id: string;
  direction: "out" | "in";
  amountFils: number;
  instrumentRef: string;
  floorAtDecisionFils: number;
  state: "swept" | "recalled" | "rejected";
  yieldFils: number;
  accruedYieldFils?: number;
  createdAt: string;
  recalledAt: string | null;
  instrumentName?: string;
}

export interface TreasuryDto {
  policy: TreasuryPolicyDto;
  obligations: ObligationDto[];
  projection: {
    walletFils: number;
    floorFils: number;
    obligationsInHorizonFils: number;
    safetyMarginFils: number;
    sweepableFils: number;
    asOf?: string;
  };
  instruments: InstrumentDto[];
  sweeps: SweepDto[];
  investedFils: number;
  earnedYieldFils: number;
}

export interface StatusDto {
  mode: "M0" | "M1" | "M2" | "M3" | "M4";
  message: string | null;
  killSwitches: Record<string, boolean>;
  breakers: Record<string, string>;
  updatedAt: string;
  modeCatalog: ModeInfo[];
}

export interface ModeInfo {
  mode: string;
  label: string;
  description: string;
  smeSees: string;
}

export interface ConsentDto {
  id: string;
  purpose: string;
  scope: string[];
  grantedAt: string;
  revokedAt: string | null;
}

export interface OverviewDto {
  entity: {
    id: string;
    legalName: string;
    emirate: string;
    sectorCode: string;
    kybState: string;
    licenceExpiry: string;
    licenceDaysRemaining: number;
    tenureMonths: number;
    duPaySuffix: string;
  };
  /** Activation moment (PRD 4.1-04): limit derived from du billing history
   *  alone via the rule pack — shown before any invoice is uploaded. */
  indicativeLimitFils?: number;
  balance: { walletFils: number; asOf: string };
  liquidity: {
    availableFils: number;
    totalApprovedFils: number;
    floorFils: number;
    sweepableFils: number;
    investedFils: number;
  };
  invoices: {
    readyCount: number;
    readyFils: number;
    pendingCount: number;
    disputedCount: number;
    settledCount: number;
  };
  buyers: BuyerInfo[];
  consents: ConsentDto[];
  status: { mode: string; killSwitches: Record<string, boolean>; breakers: Record<string, string>; message: string | null };
}

export interface ActivityEventDto {
  id: string;
  type: string;
  title: string;
  detail: string;
  subjectRef: string | null;
  occurredAt: string;
  /** Structured facts for client-side localization; server title/detail stay canonical (EN). */
  params?: {
    ref: string | null;
    milestone: string | null;
    description: string | null;
    payload: Record<string, unknown>;
  };
}

export interface LedgerEntryDto {
  id: string;
  txnId: string;
  accountCode: string;
  direction: "debit" | "credit";
  amountFils: number;
  memo: string | null;
  postedAt: string;
  sourceEventId: string;
}

export interface AuditDto {
  integrity: { balanced: boolean; txns: number; breaks: string[] };
  entries: LedgerEntryDto[];
  counts: { decisions: number; payoutsSettled: number; offersAccepted: number };
  roundingBalanceFils: number;
}

export interface InvoiceDetailDto {
  invoice: InvoiceDto;
  buyer?: BuyerInfo;
  offers: OfferDto[];
  decision?: DecisionDto | null;
  payout?: PayoutDto | null;
  eligibility?: { quotable: boolean; reasonCode?: string; reasonText?: string } | null;
}
