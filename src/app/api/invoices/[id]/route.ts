// WATERLINE — GET /api/invoices/[id] (Task 2-a).
// Invoice + buyer + offers[] + latest decision + payout (if any) + eligibility
// hint. The hint lets the RULE PACK speak (never duplicated rule logic): if the
// invoice is not currently quotable we return the binding reason code with the
// pack's plain-language explanation.

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { advancePayoutPipeline, releaseQueuedPayouts } from "@/lib/payout-queue";
import { ensureSeed } from "@/lib/seed";
import { evaluateAdvance, type FeatureSnapshot } from "@/lib/ruleengine";
import { rulePack } from "@/lib/rulepack";
import type { BuyerLink, Entity, Invoice, Offer, Payout, Decision } from "@prisma/client";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();
    const { id } = await params;

    const invoice = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, id },
      include: { buyerLink: true, entity: true },
    });
    if (invoice === null) return errors.notFound(`Invoice ${id}`);

    const offers = await db.offer.findMany({
      where: { tenantId: DEMO_TENANT, invoiceId: id },
      orderBy: { createdAt: "desc" },
    });
    const latestDecision = await db.decision.findFirst({
      where: { tenantId: DEMO_TENANT, subjectRef: id },
      orderBy: { evaluatedAt: "desc" },
    });
    const payout = await db.payout.findFirst({
      where: { offer: { invoiceId: id } },
      orderBy: { acceptedAt: "desc" },
    });

    // Lazy queue release (PRD Part 8): viewing an invoice whose payout sits in
    // the M2 queue drains the queue the moment the rail is back — the detail
    // panel self-heals without waiting for the payout poller. The pipeline
    // also advances here (same shared logic as the payout route) so every
    // read shows the same honest stage.
    let payoutOut = payout;
    if (payout?.state === "queued") {
      await releaseQueuedPayouts();
      payoutOut = await db.payout.findUniqueOrThrow({ where: { id: payout.id } });
    }
    if (payoutOut && payoutOut.state !== "queued" && payoutOut.state !== "failed" && payoutOut.state !== "settled") {
      payoutOut = await advancePayoutPipeline(payoutOut);
    }

    return ok({
      invoice: serializeInvoiceCore(invoice, invoice.buyerLink),
      buyer: {
        id: invoice.buyerLink.id,
        buyerName: invoice.buyerLink.buyerName,
        buyerTaxId: invoice.buyerLink.buyerTaxId,
        buyerEmirate: invoice.buyerLink.buyerEmirate,
        tier: invoice.buyerLink.tier,
        relationshipAgeDays: invoice.buyerLink.relationshipAgeDays,
        confirmedInvoiceCount: invoice.buyerLink.confirmedInvoiceCount,
        avgDaysToPay: invoice.buyerLink.avgDaysToPay,
        disputeCount: invoice.buyerLink.disputeCount,
      },
      offers: offers.map(serializeOffer),
      latestDecision: latestDecision ? serializeDecisionSummary(latestDecision) : null,
      payout: payoutOut ? serializePayout(payoutOut) : null,
      eligibilityHint: await eligibilityHint(invoice, invoice.entity, invoice.buyerLink),
    });
  } catch (e) {
    console.error("[api/invoices/[id] GET]", e);
    return errors.internal();
  }
}

// ── serializers (ISO dates, integer fils) ───────────────────────────────────

function serializeInvoiceCore(inv: Invoice, buyer: BuyerLink) {
  return {
    id: inv.id,
    externalRef: inv.externalRef,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    currency: inv.currency,
    grossFils: inv.grossFils,
    taxFils: inv.taxFils,
    source: inv.source,
    verificationState: inv.verificationState,
    verifiedVia: inv.verifiedVia,
    verifiedAt: inv.verifiedAt ? inv.verifiedAt.toISOString() : null,
    fundingState: inv.fundingState,
    notes: inv.notes,
    dueInDays: Math.ceil((inv.dueDate.getTime() - Date.now()) / DAY),
    buyer: {
      id: buyer.id,
      buyerName: buyer.buyerName,
      buyerTaxId: buyer.buyerTaxId,
      tier: buyer.tier,
      avgDaysToPay: buyer.avgDaysToPay,
      confirmedInvoiceCount: buyer.confirmedInvoiceCount,
      disputeCount: buyer.disputeCount,
    },
  };
}

function serializeOffer(o: Offer) {
  return {
    id: o.id,
    state: o.state,
    grossFils: o.grossFils,
    advanceRatePermyriad: o.advanceRatePermyriad,
    principalFils: o.principalFils,
    rateMilliBps: o.rateMilliBps,
    expiresAt: o.expiresAt.toISOString(),
    daysEarly: o.daysEarly,
    feeFils: o.feeFils,
    netProceedsFils: o.netProceedsFils,
    settlementDate: o.settlementDate ? o.settlementDate.toISOString() : null,
    acceptedAt: o.acceptedAt ? o.acceptedAt.toISOString() : null,
    decisionId: o.decisionId,
    createdAt: o.createdAt.toISOString(),
  };
}

function serializeDecisionSummary(d: Decision) {
  return {
    id: d.id,
    outcome: d.outcome,
    limitFils: d.limitFils,
    advanceRatePermyriad: d.advanceRatePermyriad,
    priceMilliBpsPerDay: d.priceMilliBpsPerDay,
    reasonCode: d.reasonCode,
    reasonText: d.reasonText,
    bindingRule: d.bindingRule,
    rulepackVersion: d.rulepackVersion,
    evaluatedAt: d.evaluatedAt.toISOString(),
  };
}

function serializePayout(p: Payout) {
  return {
    id: p.id,
    offerId: p.offerId,
    state: p.state,
    rail: p.rail,
    destinationRef: p.destinationRef,
    amountFils: p.amountFils,
    providerRef: p.providerRef,
    attempts: p.attempts,
    acceptedAt: p.acceptedAt.toISOString(),
    reservedAt: p.reservedAt ? p.reservedAt.toISOString() : null,
    sentAt: p.sentAt ? p.sentAt.toISOString() : null,
    settledAt: p.settledAt ? p.settledAt.toISOString() : null,
    reconciledAt: p.reconciledAt ? p.reconciledAt.toISOString() : null,
    etaSeconds: p.etaSeconds,
  };
}

// ── eligibility hint: the pack decides, we only phrase funded/disputed states ─

async function eligibilityHint(
  inv: Invoice,
  entity: Entity,
  buyer: BuyerLink,
): Promise<{ reasonCode: string; reasonText: string } | null> {
  if (inv.fundingState === "accepted") {
    return {
      reasonCode: "ALREADY_FUNDED",
      reasonText:
        "This invoice is already funded. The reserve releases to your wallet when the buyer settles.",
    };
  }
  if (inv.fundingState === "settled") {
    return {
      reasonCode: "ALREADY_SETTLED",
      reasonText: "This invoice is settled — the buyer has paid and the reserve was released.",
    };
  }
  if (inv.verificationState === "disputed") {
    return {
      reasonCode: "E_DISPUTED",
      reasonText:
        "This invoice is disputed by the buyer. Early payment becomes available once it is resolved.",
    };
  }

  // Build the same snapshot the quote endpoint would build, and let the pure
  // rule engine state the binding rejection reason (PRD 3.1 explanations).
  const now = new Date();
  const acceptedOffers = await db.offer.findMany({
    where: { tenantId: DEMO_TENANT, state: "accepted" },
    select: { principalFils: true, invoice: { select: { fundingState: true } } },
  });
  const bookExposureFils = acceptedOffers
    .filter((o) => o.invoice.fundingState !== "settled") // outstanding funded advances
    .reduce((acc, o) => acc + o.principalFils, 0);

  const snapshot: FeatureSnapshot = {
    asOfDate: now.toISOString().slice(0, 10),
    decisionType: "advance_offer",
    entity: {
      kybState: entity.kybState,
      licenceDaysRemaining: Math.ceil((entity.licenceExpiry.getTime() - now.getTime()) / DAY),
      tenureMonths: entity.tenureMonths,
      sectorCode: entity.sectorCode,
      billingBand: entity.billingBand,
    },
    invoice: {
      currency: inv.currency,
      grossFils: inv.grossFils,
      dueInDays: Math.ceil((inv.dueDate.getTime() - now.getTime()) / DAY),
      verificationState: inv.verificationState,
      verifiedVia: inv.verifiedVia,
    },
    buyer: {
      tier: buyer.tier,
      confirmedInvoiceCount: buyer.confirmedInvoiceCount,
      avgDaysToPay: buyer.avgDaysToPay,
      disputeCount: buyer.disputeCount,
    },
    portfolio: { bookExposureFils },
    treasury: null,
  };
  const result = evaluateAdvance(snapshot, rulePack);
  if (result.outcome === "rejected") {
    return { reasonCode: result.reasonCode, reasonText: result.reasonText };
  }
  return null;
}
