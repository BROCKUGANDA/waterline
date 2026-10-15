// WATERLINE — GET /api/invoices/[id]/quote (Task 2-a).
// THE deterministic decision flow (PRD 4.3-01, Part 3):
//   1. Build the FeatureSnapshot — time and all features passed in explicitly;
//      the engine never reads the clock (PRD 3.2).
//   2. evaluateAdvance with the active rule pack (pure function).
//   3. Write the append-only Decision row (inputHash = hashSnapshot,
//      featureSnapshot = canonicalJson) BEFORE any outcome is returned —
//      the audit record is a precondition of the decision, not a side effect.
//   4. Approved/capped → exactly one live Offer: prior offered offers expire,
//      the new offer is state=offered, expiresAt = now + 120s,
//      principalFils = limit, rateMilliBps = price. Invoice.fundingState → quoted.
//   5. AppEvent 'decision.recorded'. Rejections are HTTP 200 with offer: null —
//      the UI renders a neutral outcome card, never an error.
// FundingState=accepted → 409 "already funded" (settled → 409 already_settled).

import { db } from "@/lib/db";
import { ok, problem, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { canonicalJson, hashSnapshot, shortId } from "@/lib/canonical";
import { evaluateAdvance, type FeatureSnapshot, type EngineDecision } from "@/lib/ruleengine";
import { packForMode, CANDIDATE_PACK, BASE_PACK_VERSION } from "@/lib/rulepacks";
import { canaryState, routesToCanary } from "@/lib/canary";
import type { Offer } from "@prisma/client";

const DAY = 86_400_000;
const OFFER_TTL_MS = 120_000; // 120 seconds

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();

    // Status guards: quote writes (decision + offer), so M4 read-only blocks it;
    // the dynamicDiscounting / global kill switches block the engine. M2
    // (quote_only) and M3 (funding suspended) still serve quotes — M3 blocks
    // acceptance, not pricing.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");
    const killSwitches = JSON.parse(status?.killSwitchesJson ?? "{}") as Record<string, boolean>;
    if (killSwitches.global || killSwitches.dynamicDiscounting) {
      return errors.killSwitchActive(
        "Dynamic discounting is suspended by an operator — quotes are paused. Poll /api/status.",
      );
    }

    const { id } = await params;
    const invoice = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, id },
      include: { buyerLink: true, entity: true },
    });
    if (invoice === null) return errors.notFound(`Invoice ${id}`);
    if (invoice.fundingState === "accepted") {
      return problem(409, "already_funded", "This invoice is already funded.");
    }
    if (invoice.fundingState === "settled") {
      return problem(409, "already_settled", "This invoice has already been settled.");
    }

    const now = new Date();

    // Portfolio book exposure = outstanding funded advances: accepted offers
    // on invoices that have not settled (contract: "accepted offers'
    // principalFils + nothing else", outstanding).
    const acceptedOffers = await db.offer.findMany({
      where: { tenantId: DEMO_TENANT, state: "accepted" },
      select: { principalFils: true, invoice: { select: { fundingState: true } } },
    });
    const bookExposureFils = acceptedOffers
      .filter((o) => o.invoice.fundingState !== "settled")
      .reduce((acc, o) => acc + o.principalFils, 0);

    // ── 1. The feature snapshot (everything the engine may look at) ─────────
    const snapshot: FeatureSnapshot = {
      asOfDate: now.toISOString().slice(0, 10),
      decisionType: "advance_offer",
      entity: {
        kybState: invoice.entity.kybState,
        licenceDaysRemaining: Math.ceil(
          (invoice.entity.licenceExpiry.getTime() - now.getTime()) / DAY,
        ),
        tenureMonths: invoice.entity.tenureMonths,
        sectorCode: invoice.entity.sectorCode,
        billingBand: invoice.entity.billingBand,
      },
      invoice: {
        currency: invoice.currency,
        grossFils: invoice.grossFils,
        dueInDays: Math.ceil((invoice.dueDate.getTime() - now.getTime()) / DAY),
        verificationState: invoice.verificationState,
        verifiedVia: invoice.verifiedVia,
      },
      buyer: {
        tier: invoice.buyerLink.tier,
        confirmedInvoiceCount: invoice.buyerLink.confirmedInvoiceCount,
        avgDaysToPay: invoice.buyerLink.avgDaysToPay,
        disputeCount: invoice.buyerLink.disputeCount,
      },
      portfolio: { bookExposureFils },
      treasury: null,
    };

    // ── 2. Pure evaluation — no I/O, no clock, no randomness ────────────────
    // The pack is selected by the DECLARED mode (M1 → the cautious delta, PRD
    // Part 8) — data decides, and the version used is recorded on the decision
    // so replay is always exact against this same pack. The CANARY phase of
    // PRD 3.3 adds one deterministic carve-out: while M0 holds and the canary
    // is promoted, a fixed 5% bucket of quote traffic (derived from the input
    // hash — same hash, same bucket, forever) is served by the CANDIDATE pack.
    // The decision row records whichever pack actually decided.
    const canary = await canaryState();
    const inputHash = hashSnapshot(snapshot);
    const canaryRouted = routesToCanary(inputHash, status?.mode, canary);
    const pack = canaryRouted ? CANDIDATE_PACK : packForMode(status?.mode);
    const result = evaluateAdvance(snapshot, pack);

    // ── 3. Append-only decision record BEFORE the outcome is returned ──────
    const decision = await db.decision.create({
      data: {
        id: shortId("dec"),
        tenantId: DEMO_TENANT,
        subjectRef: invoice.id,
        subjectType: "invoice",
        decisionType: "advance_offer",
        inputHash,
        rulepackVersion: pack.version,
        featureSnapshot: canonicalJson(snapshot),
        outcome: result.outcome,
        limitFils: result.limitFils,
        advanceRatePermyriad: result.advanceRatePermyriad,
        priceMilliBpsPerDay: result.priceMilliBpsPerDay,
        bindingRule: result.bindingRule,
        reasonCode: result.reasonCode,
        reasonText: result.reasonText,
        evaluatedAt: now,
        actor: "system",
        shadow: false,
        canary: canaryRouted,
      },
    });

    // ── 3b. PARALLEL SCORING (PRD 3.3 promotion lifecycle): whichever pack
    //        did NOT decide this request scores the SAME feature snapshot in
    //        parallel and records what it WOULD have decided — a shadow row
    //        decides nothing and never touches the offer. Best-effort by
    //        design: a shadow failure never blocks the live decision (the
    //        live record is the precondition, the shadow is telemetry).
    //          base pack live  → candidate shadow (the Shadow phase);
    //          canary-routed   → BASE shadow (the canary's counterfactual),
    //        so every quote produces a base↔candidate pair for the diff.
    //        Only while the BASE pack is the non-canary live pack — under M1
    //        the cautious delta is the active experiment; conflating the two
    //        would be dishonest.
    const shadowPack = canaryRouted ? packForMode("M0") : CANDIDATE_PACK;
    if (canaryRouted || pack.version === BASE_PACK_VERSION) {
      try {
        const shadowResult = evaluateAdvance(snapshot, shadowPack);
        await db.decision.create({
          data: {
            id: shortId("dec"),
            tenantId: DEMO_TENANT,
            subjectRef: invoice.id,
            subjectType: "invoice",
            decisionType: "advance_offer",
            inputHash: decision.inputHash,
            rulepackVersion: shadowPack.version,
            featureSnapshot: canonicalJson(snapshot),
            outcome: shadowResult.outcome,
            limitFils: shadowResult.limitFils,
            advanceRatePermyriad: shadowResult.advanceRatePermyriad,
            priceMilliBpsPerDay: shadowResult.priceMilliBpsPerDay,
            bindingRule: shadowResult.bindingRule,
            reasonCode: shadowResult.reasonCode,
            reasonText: shadowResult.reasonText,
            evaluatedAt: now,
            actor: "system:shadow",
            shadow: true,
            canary: false,
          },
        });
      } catch (e) {
        console.error("[api/invoices/[id]/quote] shadow evaluation", e);
      }
    }

    // ── 4. Offer (approved/capped only): expire prior offered offers, then
    //       create the fresh one + mark the invoice quoted + record the event,
    //       atomically. If this write fails the offer is never shown — the
    //       decision record stands alone (PRD 3.4). ──────────────────────────
    let offer: Offer | null = null;
    if (result.outcome === "approved" || result.outcome === "capped") {
      if (
        result.limitFils === null ||
        result.advanceRatePermyriad === null ||
        result.priceMilliBpsPerDay === null
      ) {
        // Impossible by engine construction — fail loudly, never silently.
        return errors.internal();
      }
      offer = await db.$transaction(async (tx) => {
        await tx.offer.updateMany({
          where: { tenantId: DEMO_TENANT, invoiceId: invoice.id, state: "offered" },
          data: { state: "expired" },
        });
        const created = await tx.offer.create({
          data: {
            id: shortId("off"),
            tenantId: DEMO_TENANT,
            invoiceId: invoice.id,
            decisionId: decision.id,
            grossFils: invoice.grossFils,
            advanceRatePermyriad: result.advanceRatePermyriad as number,
            principalFils: result.limitFils as number,
            rateMilliBps: result.priceMilliBpsPerDay as number,
            expiresAt: new Date(now.getTime() + OFFER_TTL_MS),
            state: "offered",
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { fundingState: "quoted" },
        });
        await tx.appEvent.create({
          data: {
            tenantId: DEMO_TENANT,
            type: "decision.recorded",
            subjectRef: decision.id,
            payloadJson: JSON.stringify({
              decisionId: decision.id,
              invoiceId: invoice.id,
              ref: invoice.externalRef,
              outcome: result.outcome,
              reasonCode: result.reasonCode,
              limitFils: result.limitFils,
              offerId: created.id,
            }),
          },
        });
        return created;
      });
    } else {
      await db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "decision.recorded",
          subjectRef: decision.id,
          payloadJson: JSON.stringify({
            decisionId: decision.id,
            invoiceId: invoice.id,
            ref: invoice.externalRef,
            outcome: result.outcome,
            reasonCode: result.reasonCode,
          }),
        },
      });
    }

    // ── 5. Response (contract shape) ────────────────────────────────────────
    return ok({
      decision: {
        id: decision.id,
        outcome: decision.outcome,
        limitFils: decision.limitFils,
        advanceRatePermyriad: decision.advanceRatePermyriad,
        priceMilliBpsPerDay: decision.priceMilliBpsPerDay,
        reasonCode: decision.reasonCode,
        reasonText: decision.reasonText,
        bindingRule: decision.bindingRule,
        checks: serializeChecks(result),
        rulepackVersion: decision.rulepackVersion,
        inputHash: decision.inputHash,
        evaluatedAt: decision.evaluatedAt.toISOString(),
      },
      offer: offer
        ? {
            id: offer.id,
            grossFils: offer.grossFils,
            principalFils: offer.principalFils,
            rateMilliBps: offer.rateMilliBps,
            expiresAt: offer.expiresAt.toISOString(),
            state: offer.state,
          }
        : null,
      rateCurve: { mbpsPerDay: result.priceMilliBpsPerDay }, // null when rejected
    });
  } catch (e) {
    console.error("[api/invoices/[id]/quote]", e);
    return errors.internal();
  }
}

function serializeChecks(result: EngineDecision) {
  return result.checks.map((c) => ({ rule: c.rule, passed: c.passed, detail: c.detail }));
}
