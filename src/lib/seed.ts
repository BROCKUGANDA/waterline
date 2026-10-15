// WATERLINE — idempotent demo world seed. Called by API routes on first hit.
// All money in fils. Dates relative to now so the story is always alive.
// Narrative: Al Marwan Technical Services LLC — a Dubai SME with a healthy
// receivables book, real obligations, and one active escrow contract.

import { db } from "./db";
import { LEDGER_ACCOUNTS, postTransaction } from "./ledger";
import { DEMO_TENANT } from "./api";
import { hashSnapshot, shortId, payoutIdempotencyKey } from "./canonical";
import { evaluateAdvance, feeFor, type FeatureSnapshot } from "./ruleengine";
import { rulePack } from "./rulepack";
import { applyPermyriad } from "./money";

const DAY = 86_400_000;
const days = (n: number) => new Date(Date.now() + n * DAY);
const daysAgo = (n: number) => days(-n);

let seedPromise: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedPromise) seedPromise = runSeed().catch((e) => { seedPromise = null; throw e; });
  return seedPromise;
}

async function runSeed(): Promise<void> {
  const existing = await db.entity.count({ where: { tenantId: DEMO_TENANT, role: "sme" } });
  if (existing > 0) return;

  const t = DEMO_TENANT;

  // ── Entity ────────────────────────────────────────────────────────────────
  const entity = await db.entity.create({
    data: {
      id: "ent_almarwan",
      tenantId: t,
      role: "sme",
      legalName: "Al Marwan Technical Services LLC",
      tradeLicence: "DED-7482910",
      licenceExpiry: days(210),
      emirate: "Dubai",
      sectorCode: "services",
      kybState: "verified",
      tenureMonths: 48,
      billingBand: "high",
      duPaySuffix: "•••• 4471",
    },
  });

  // ── Buyers ────────────────────────────────────────────────────────────────
  const mkBuyer = (data: Parameters<typeof db.buyerLink.create>[0]["data"]) => db.buyerLink.create({ data });
  const steel = await mkBuyer({ id: "bl_steel", tenantId: t, entityId: entity.id, buyerName: "Emirates Steel Structures", buyerTaxId: "TRN100234567800003", buyerEmirate: "Dubai", tier: "platinum", relationshipAgeDays: 1240, confirmedInvoiceCount: 28, avgDaysToPay: 32, disputeCount: 0 });
  const emaar = await mkBuyer({ id: "bl_emaar", tenantId: t, entityId: entity.id, buyerName: "Emaar Facilities Group", buyerTaxId: "TRN100445218900003", buyerEmirate: "Dubai", tier: "gold", relationshipAgeDays: 910, confirmedInvoiceCount: 22, avgDaysToPay: 41, disputeCount: 1 });
  const maf = await mkBuyer({ id: "bl_maf", tenantId: t, entityId: entity.id, buyerName: "Majid Al Futtaim Retail", buyerTaxId: "TRN100781234500003", buyerEmirate: "Dubai", tier: "silver", relationshipAgeDays: 420, confirmedInvoiceCount: 9, avgDaysToPay: 55, disputeCount: 0 });
  const noor = await mkBuyer({ id: "bl_noor", tenantId: t, entityId: entity.id, buyerName: "Noor Trading FZE", buyerTaxId: "TRN100998877600003", buyerEmirate: "Sharjah", tier: "unrated", relationshipAgeDays: 61, confirmedInvoiceCount: 1, avgDaysToPay: 70, disputeCount: 0 });

  // ── Consents (PRD 4.1) ────────────────────────────────────────────────────
  const purposes = [
    { purpose: "billing_history", scope: ["du_billing_history:12m"] },
    { purpose: "bank_data", scope: ["open_finance:accounts:read", "open_finance:balances:read"] },
    { purpose: "buyer_contact", scope: ["buyer_confirmation:send"] },
  ];
  for (const p of purposes) {
    await db.consentGrant.create({
      data: { id: `cg_${p.purpose}`, tenantId: t, purpose: p.purpose, scopeJson: JSON.stringify(p.scope), grantedAt: daysAgo(40), provider: "du_business", providerConsentRef: `dub_${shortId("c")}` },
    });
  }

  // ── Treasury policy + obligations (PRD 4.5) ───────────────────────────────
  await db.treasuryPolicy.create({
    data: { id: "singleton", tenantId: t, floorFils: 2_500_000, horizonDays: 14, safetyMarginPermyriad: 1500, autoPilotEnabled: true, updatedAt: new Date() },
  });
  const obligations = [
    { label: "du telecom bill", kind: "du_bill", dueDate: days(3), amountFils: 230_000, cadence: "monthly", confidencePermyriad: 9800 },
    { label: "Payroll — 14 staff", kind: "payroll", dueDate: days(6), amountFils: 1_800_000, cadence: "monthly", confidencePermyriad: 9500 },
    { label: "Supplier — HVAC parts", kind: "supplier", dueDate: days(8), amountFils: 550_000, cadence: "once", confidencePermyriad: 9000 },
    { label: "Warehouse rent", kind: "rent", dueDate: days(11), amountFils: 1_500_000, cadence: "monthly", confidencePermyriad: 9700 },
    { label: "VAT — Q3 filing", kind: "vat", dueDate: days(19), amountFils: 840_000, cadence: "once", confidencePermyriad: 9200 },
  ];
  for (const o of obligations) {
    await db.obligation.create({ data: { tenantId: t, ...o } });
  }

  // ── Opening ledger: funder capital + du Pay wallet float ──────────────────
  await postTransaction({
    tenantId: t, txnId: "txn_open_funder", sourceEventId: "seed:funder_capital", valueDate: daysAgo(40),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.BANK_COLLECTIONS, direction: "debit", amountFils: 50_000_000, memo: "Funder capital injection (demo book)" },
      { accountCode: LEDGER_ACCOUNTS.FUNDING_POOL, direction: "credit", amountFils: 50_000_000, memo: "Funder capital injection (demo book)" },
    ],
    eventType: "ledger.opened", skipEvent: true,
  });
  await postTransaction({
    tenantId: t, txnId: "txn_open_wallet", sourceEventId: "seed:wallet_float", valueDate: daysAgo(40),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.FUNDING_POOL, direction: "debit", amountFils: 6_840_000, memo: "Opening du Pay wallet float" },
      { accountCode: LEDGER_ACCOUNTS.SME_WALLET(t), direction: "credit", amountFils: 6_840_000, memo: "Opening du Pay wallet float" },
    ],
    eventType: "ledger.opened", skipEvent: true,
  });

  // ── Invoices ──────────────────────────────────────────────────────────────
  interface InvSpec {
    id: string; buyerId: string; ref: string; gross: number; due: number; issuedAgo: number;
    state: string; via?: string | null; source: string; funding?: string;
  }
  const specs: InvSpec[] = [
    { id: "inv_steel_a", buyerId: steel.id, ref: "ESS-INV-2214", gross: 4_850_000, due: 21, issuedAgo: 9, state: "verified", via: "einvoice", source: "einvoice", funding: "none" },
    { id: "inv_emaar_a", buyerId: emaar.id, ref: "EFG-PO-88231", gross: 2_375_000, due: 14, issuedAgo: 17, state: "verified", via: "buyer_api", source: "buyer_api", funding: "none" },
    { id: "inv_maf_a", buyerId: maf.id, ref: "MAF-33112", gross: 3_600_000, due: 32, issuedAgo: 4, state: "verified", via: "du_ap", source: "du_ap", funding: "none" },
    { id: "inv_steel_small", buyerId: steel.id, ref: "ESS-INV-2199", gross: 120_000, due: 12, issuedAgo: 3, state: "verified", via: "einvoice", source: "einvoice", funding: "none" },
    { id: "inv_emaar_b", buyerId: emaar.id, ref: "EFG-PO-88410", gross: 5_120_000, due: 27, issuedAgo: 1, state: "deduped", source: "upload", funding: "none" },
    { id: "inv_noor_a", buyerId: noor.id, ref: "NTZ-0092", gross: 980_000, due: 40, issuedAgo: 2, state: "deduped", source: "upload", funding: "none" },
    { id: "inv_maf_b", buyerId: maf.id, ref: "MAF-32901", gross: 1_780_000, due: 5, issuedAgo: 33, state: "disputed", source: "buyer_api", funding: "none" },
    { id: "inv_steel_old", buyerId: steel.id, ref: "ESS-INV-2180", gross: 3_100_000, due: -4, issuedAgo: 49, state: "verified", via: "einvoice", source: "einvoice", funding: "none" },
  ];

  for (const s of specs) {
    await db.invoice.create({
      data: {
        id: s.id, tenantId: t, entityId: entity.id, buyerLinkId: s.buyerId,
        externalRef: s.ref, issueDate: daysAgo(s.issuedAgo), dueDate: days(s.due),
        currency: "AED", grossFils: s.gross, taxFils: applyPermyriad(s.gross, 500),
        invoiceHash: hashSnapshot({ buyer: s.buyerId, ref: s.ref, gross: s.gross, issued: s.issuedAgo }),
        source: s.source, verificationState: s.state, verifiedVia: s.via ?? null,
        verifiedAt: s.via ? daysAgo(s.issuedAgo) : null, fundingState: s.funding ?? "none",
      },
    });
    await db.appEvent.create({
      data: { tenantId: t, type: "invoice.submitted", subjectRef: s.id, payloadJson: JSON.stringify({ ref: s.ref, buyerId: s.buyerId }), occurredAt: daysAgo(s.issuedAgo), sequence: 0 },
    });
    if (s.via) {
      await db.appEvent.create({
        data: { tenantId: t, type: "invoice.verified", subjectRef: s.id, payloadJson: JSON.stringify({ via: s.via }), occurredAt: daysAgo(s.issuedAgo - 0.2), sequence: 0 },
      });
    }
  }

  // ── A settled history: inv_steel_settled (the full happy path, 12 days ago) ─
  const settled = await db.invoice.create({
    data: {
      id: "inv_steel_settled", tenantId: t, entityId: entity.id, buyerLinkId: steel.id,
      externalRef: "ESS-INV-2201", issueDate: daysAgo(46), dueDate: daysAgo(4),
      currency: "AED", grossFils: 4_200_000, taxFils: 210_000,
      invoiceHash: hashSnapshot({ buyer: steel.id, ref: "ESS-INV-2201", gross: 4_200_000, issued: 46 }),
      source: "einvoice", verificationState: "verified", verifiedVia: "einvoice", verifiedAt: daysAgo(44),
      fundingState: "settled",
    },
  });
  await db.appEvent.create({ data: { tenantId: t, type: "invoice.submitted", subjectRef: settled.id, payloadJson: "{}", occurredAt: daysAgo(46), sequence: 0 } });
  await db.appEvent.create({ data: { tenantId: t, type: "invoice.verified", subjectRef: settled.id, payloadJson: JSON.stringify({ via: "einvoice" }), occurredAt: daysAgo(44), sequence: 0 } });

  // Its decision, offer, payout — the replayable trail (PRD 3.4)
  const settledSnap: FeatureSnapshot = {
    asOfDate: daysAgo(12).toISOString().slice(0, 10),
    decisionType: "advance_offer",
    entity: { kybState: "verified", licenceDaysRemaining: 198, tenureMonths: 48, sectorCode: "services", billingBand: "high" },
    invoice: { currency: "AED", grossFils: 4_200_000, dueInDays: 8, verificationState: "verified", verifiedVia: "einvoice" },
    buyer: { tier: "platinum", confirmedInvoiceCount: 27, avgDaysToPay: 32, disputeCount: 0 },
    portfolio: { bookExposureFils: 6_840_000 },
    treasury: null,
  };
  const settledEval = evaluateAdvance(settledSnap, rulePack);
  const settledDecision = await db.decision.create({
    data: {
      id: "dec_settled", tenantId: t, subjectRef: settled.id, subjectType: "invoice", decisionType: "advance_offer",
      inputHash: hashSnapshot(settledSnap), rulepackVersion: rulePack.version, featureSnapshot: JSON.stringify(settledSnap),
      outcome: settledEval.outcome, limitFils: settledEval.limitFils, advanceRatePermyriad: settledEval.advanceRatePermyriad,
      priceMilliBpsPerDay: settledEval.priceMilliBpsPerDay, bindingRule: settledEval.bindingRule,
      reasonCode: settledEval.reasonCode, reasonText: settledEval.reasonText, evaluatedAt: daysAgo(12), actor: "system", shadow: false,
    },
  });
  const daysEarly = 8;
  const principal = settledEval.limitFils!;
  const fee = feeFor(daysEarly, settledEval.priceMilliBpsPerDay!, principal);
  const net = principal - fee;
  const settledOffer = await db.offer.create({
    data: {
      id: "off_settled", tenantId: t, invoiceId: settled.id, decisionId: settledDecision.id,
      grossFils: 4_200_000, advanceRatePermyriad: settledEval.advanceRatePermyriad!, principalFils: principal,
      rateMilliBps: settledEval.priceMilliBpsPerDay!, expiresAt: daysAgo(11), state: "accepted",
      settlementDate: daysAgo(4), daysEarly, feeFils: fee, netProceedsFils: net, acceptedAt: daysAgo(12),
    },
  });
  await db.payout.create({
    data: {
      id: "pay_settled", tenantId: t, offerId: settledOffer.id, idempotencyKey: payoutIdempotencyKey(settledOffer.id),
      rail: "dupay", destinationRef: "du Pay •••• 4471", amountFils: net, state: "settled",
      providerRef: "dpay_77812", acceptedAt: daysAgo(12), reservedAt: daysAgo(12), sentAt: daysAgo(12),
      settledAt: daysAgo(12), reconciledAt: daysAgo(11), etaSeconds: 14,
    },
  });
  // Funding txn: control the claim, pay the net, earn the fee, hold the reserve.
  await postTransaction({
    tenantId: t, txnId: "txn_settled_fund", sourceEventId: `offer.accept:${settledOffer.id}`, valueDate: daysAgo(12),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.RECEIVABLE_CONTROL, direction: "debit", amountFils: 4_200_000, memo: "Assignment recorded — ESS-INV-2201" },
      { accountCode: LEDGER_ACCOUNTS.FUNDING_POOL, direction: "credit", amountFils: net, memo: "Advance to du Pay •••• 4471" },
      { accountCode: LEDGER_ACCOUNTS.FEE_INCOME, direction: "credit", amountFils: fee, memo: "Discount fee — 8 days early" },
      { accountCode: LEDGER_ACCOUNTS.RESERVE_HELD, direction: "credit", amountFils: 4_200_000 - net - fee, memo: "Reserve held for SME" },
    ],
    eventType: "offer.accepted", eventSubjectRef: settledOffer.id, skipEvent: true,
  });
  // Buyer settled the gross at due date; reserve released to the SME.
  await postTransaction({
    tenantId: t, txnId: "txn_settled_collect", sourceEventId: `invoice.settled:${settled.id}`, valueDate: daysAgo(4),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.BANK_COLLECTIONS, direction: "debit", amountFils: 4_200_000, memo: "Buyer payment received — ESS-INV-2201" },
      { accountCode: LEDGER_ACCOUNTS.RECEIVABLE_CONTROL, direction: "credit", amountFils: 4_200_000, memo: "Claim cleared" },
    ],
    eventType: "invoice.settled", eventSubjectRef: settled.id, skipEvent: true,
  });
  await postTransaction({
    tenantId: t, txnId: "txn_settled_reserve", sourceEventId: `reserve.release:${settled.id}`, valueDate: daysAgo(4),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.RESERVE_HELD, direction: "debit", amountFils: 4_200_000 - net - fee, memo: "Reserve released to SME" },
      { accountCode: LEDGER_ACCOUNTS.SME_WALLET(t), direction: "credit", amountFils: 4_200_000 - net - fee, memo: "Reserve released to du Pay •••• 4471" },
    ],
    eventType: "reserve.released", eventSubjectRef: settled.id, skipEvent: true,
  });
  await db.appEvent.create({ data: { tenantId: t, type: "payout.settled", subjectRef: "pay_settled", payloadJson: JSON.stringify({ amountFils: net }), occurredAt: daysAgo(12), sequence: 0 } });
  await db.appEvent.create({ data: { tenantId: t, type: "invoice.settled", subjectRef: settled.id, payloadJson: JSON.stringify({ grossFils: 4_200_000 }), occurredAt: daysAgo(4), sequence: 0 } });

  // ── Treasury sweep history ────────────────────────────────────────────────
  await db.sweep.create({
    data: { id: "sweep_1", tenantId: t, direction: "out", amountFils: 1_200_000, instrumentRef: "EMRD-SD", floorAtDecisionFils: 2_500_000, state: "swept", yieldFils: 1_540, createdAt: daysAgo(6) },
  });
  await postTransaction({
    tenantId: t, txnId: "txn_sweep1", sourceEventId: "treasury.sweep:sweep_1", valueDate: daysAgo(6),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.SME_WALLET(t), direction: "debit", amountFils: 1_200_000, memo: "Sweep to Emirates Short Duration MMF" },
      { accountCode: LEDGER_ACCOUNTS.INSTRUMENT_HOLDING("EMRD-SD"), direction: "credit", amountFils: 1_200_000, memo: "Instrument holding" },
    ],
    eventType: "sweep.executed", eventSubjectRef: "sweep_1", skipEvent: true,
  });

  // ── Escrow contract: Emaar fit-out award, funded at the custodian ────────
  const contract = await db.escrowContract.create({
    data: {
      id: "ctr_emaar_fitout", tenantId: t, supplierEntityId: entity.id, buyerName: "Emaar Facilities Group",
      buyerEntityName: "Emaar Facilities Group", custodianRef: "ADCB-ESC-88213", description: "Chiller retrofit — Dubai Marina facility",
      totalFils: 8_500_000, state: "active", createdAt: daysAgo(22),
    },
  });
  const milestones = [
    { id: "mil_site", sequence: 1, description: "Site preparation & safety sign-off", amountFils: 2_500_000, conditionType: "buyer_approval", state: "released", approvedBy: "EFG-AP (H. Kamali)", approvedAt: daysAgo(18), metAt: daysAgo(19), releasedAt: daysAgo(18), reviewWindowDays: 3 },
    { id: "mil_materials", sequence: 2, description: "Chiller units delivered on site", amountFils: 2_800_000, conditionType: "document_review", state: "in_review", reviewWindowDays: 3, metAt: daysAgo(1), evidenceRef: "POD-2026-114" },
    { id: "mil_install", sequence: 3, description: "Installation & commissioning", amountFils: 2_200_000, conditionType: "buyer_approval", state: "pending", reviewWindowDays: 3 },
    { id: "mil_handover", sequence: 4, description: "Handover & 30-day defect window", amountFils: 1_000_000, conditionType: "time_release", state: "pending", reviewWindowDays: 5 },
  ];
  for (const m of milestones) {
    await db.milestone.create({ data: { contractId: contract.id, ...m } });
  }
  // Buyer funded the contract at the custodian (WATERLINE never holds client money).
  await postTransaction({
    tenantId: t, txnId: "txn_escrow_award", sourceEventId: `escrow.awarded:${contract.id}`, valueDate: daysAgo(22),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.BUYER_CONTRIBUTION, direction: "debit", amountFils: 8_500_000, memo: "Emaar funds the milestone contract" },
      { accountCode: LEDGER_ACCOUNTS.ESCROW_CUSTODIAN, direction: "credit", amountFils: 8_500_000, memo: "Held at ADCB under programmable mandate" },
    ],
    eventType: "escrow.awarded", eventSubjectRef: contract.id, skipEvent: true,
  });
  // Milestone 1 released to the SME.
  await postTransaction({
    tenantId: t, txnId: "txn_escrow_m1", sourceEventId: `escrow.release:mil_site`, valueDate: daysAgo(18),
    entries: [
      { accountCode: LEDGER_ACCOUNTS.ESCROW_CUSTODIAN, direction: "debit", amountFils: 2_500_000, memo: "Milestone 1 release instructed" },
      { accountCode: LEDGER_ACCOUNTS.SME_WALLET(t), direction: "credit", amountFils: 2_500_000, memo: "Milestone 1 — site preparation" },
    ],
    eventType: "escrow.released", eventSubjectRef: "mil_site", skipEvent: true,
  });
  await db.appEvent.create({ data: { tenantId: t, type: "escrow.awarded", subjectRef: contract.id, payloadJson: JSON.stringify({ totalFils: 8_500_000 }), occurredAt: daysAgo(22), sequence: 0 } });
  await db.appEvent.create({ data: { tenantId: t, type: "escrow.released", subjectRef: "mil_site", payloadJson: JSON.stringify({ amountFils: 2_500_000, milestone: "Site preparation & safety sign-off" }), occurredAt: daysAgo(18), sequence: 0 } });
  await db.appEvent.create({ data: { tenantId: t, type: "escrow.condition_met", subjectRef: "mil_materials", payloadJson: JSON.stringify({ evidence: "POD-2026-114", windowDays: 3 }), occurredAt: daysAgo(1), sequence: 0 } });

  // ── System status ─────────────────────────────────────────────────────────
  await db.statusState.create({
    data: { id: "singleton", mode: "M0", message: null },
  });

  await db.appEvent.create({
    data: { tenantId: t, type: "onboarding.completed", subjectRef: entity.id, payloadJson: JSON.stringify({ indicativeLimit: "derived from du billing history" }), occurredAt: daysAgo(40), sequence: 0 },
  });
}
