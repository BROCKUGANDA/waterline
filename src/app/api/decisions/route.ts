// WATERLINE — GET /api/decisions (Task 2-a).
// Latest decisions (default 25, ?limit=1..100), ordered evaluatedAt desc,
// with subject refs resolved to human labels (invoice number / sweep instrument).
// Additive: shadowDiff — the PRD 3.3 promotion-lifecycle report. The candidate
// pack's shadow rows are joined to their live twins by inputHash (same feature
// snapshot) and the outcome deltas are counted: approvals gained/lost, limit
// moves, price moves — exactly what the risk committee reviews before signing.

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { CANDIDATE_PACK_VERSION, CANDIDATE_DELTA_SUMMARY } from "@/lib/rulepacks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeed();

    const limitRaw = new URL(req.url).searchParams.get("limit");
    let limit = 25;
    if (limitRaw !== null) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return errors.invalidRequest("limit must be an integer between 1 and 100.");
      }
      limit = n;
    }

    const rows = await db.decision.findMany({
      where: { tenantId: DEMO_TENANT },
      orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    // Resolve subject labels for the refs (invoice numbers, sweep instruments).
    const invoiceRefs = rows
      .filter((r) => r.subjectType === "invoice")
      .map((r) => r.subjectRef);
    const invoices = invoiceRefs.length
      ? await db.invoice.findMany({
          where: { id: { in: invoiceRefs } },
          select: { id: true, externalRef: true, buyerLinkId: true },
        })
      : [];
    const sweepRefs = rows.filter((r) => r.subjectType === "sweep").map((r) => r.subjectRef);
    const sweeps = sweepRefs.length
      ? await db.sweep.findMany({
          where: { id: { in: sweepRefs } },
          select: { id: true, instrumentRef: true },
        })
      : [];
    const buyerIds = invoices.map((i) => i.buyerLinkId);
    const buyers = buyerIds.length
      ? await db.buyerLink.findMany({
          where: { id: { in: buyerIds } },
          select: { id: true, buyerName: true },
        })
      : [];

    const invoiceLabel = new Map(
      invoices.map((i) => {
        const buyerName = buyers.find((b) => b.id === i.buyerLinkId)?.buyerName ?? null;
        return [i.id, buyerName ? `${i.externalRef} — ${buyerName}` : i.externalRef];
      }),
    );
    const sweepLabel = new Map(sweeps.map((s) => [s.id, s.instrumentRef]));
    const labelFor = (subjectType: string, subjectRef: string): string =>
      subjectType === "invoice"
        ? (invoiceLabel.get(subjectRef) ?? subjectRef)
        : subjectType === "sweep"
          ? (sweepLabel.get(subjectRef) ?? subjectRef)
          : subjectRef;

    // ── Shadow diff (PRD 3.3): join the candidate pack's shadow rows to their
    //    live twins by inputHash, latest per hash, and count the deltas. The
    //    report is advisory — a shadow row decides nothing.
    const allAdvance = await db.decision.findMany({
      where: { tenantId: DEMO_TENANT, decisionType: "advance_offer" },
      orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
      select: {
        inputHash: true, shadow: true, rulepackVersion: true, outcome: true,
        limitFils: true, priceMilliBpsPerDay: true, subjectRef: true, evaluatedAt: true,
      },
    });
    const latestByHash = new Map<string, { live?: (typeof allAdvance)[number]; shadow?: (typeof allAdvance)[number] }>();
    for (const d of allAdvance) {
      const entry = latestByHash.get(d.inputHash) ?? {};
      if (d.shadow && d.rulepackVersion === CANDIDATE_PACK_VERSION && !entry.shadow) entry.shadow = d;
      if (!d.shadow && !entry.live) entry.live = d;
      latestByHash.set(d.inputHash, entry);
    }
    let shadowPairs = 0, approvalsGained = 0, approvalsLost = 0, limitMoves = 0, priceMoves = 0;
    const examples: { label: string; liveOutcome: string; liveLimitFils: number | null; shadowOutcome: string; shadowLimitFils: number | null }[] = [];
    const subjectLabels = new Map(rows.map((r) => [r.subjectRef, labelFor(r.subjectType, r.subjectRef)]));
    for (const [, pair] of latestByHash) {
      if (!pair.live || !pair.shadow) continue;
      shadowPairs += 1;
      const liveApproved = pair.live.outcome !== "rejected";
      const shadowApproved = pair.shadow.outcome !== "rejected";
      if (shadowApproved && !liveApproved) approvalsGained += 1;
      if (liveApproved && !shadowApproved) approvalsLost += 1;
      if (pair.live.limitFils !== pair.shadow.limitFils && liveApproved && shadowApproved) limitMoves += 1;
      if (pair.live.priceMilliBpsPerDay !== pair.shadow.priceMilliBpsPerDay && liveApproved && shadowApproved) priceMoves += 1;
      const differs =
        pair.live.outcome !== pair.shadow.outcome ||
        pair.live.limitFils !== pair.shadow.limitFils ||
        pair.live.priceMilliBpsPerDay !== pair.shadow.priceMilliBpsPerDay;
      if (differs && examples.length < 3) {
        examples.push({
          label: subjectLabels.get(pair.live.subjectRef) ?? pair.live.subjectRef,
          liveOutcome: pair.live.outcome,
          liveLimitFils: pair.live.limitFils,
          shadowOutcome: pair.shadow.outcome,
          shadowLimitFils: pair.shadow.limitFils,
        });
      }
    }

    return ok({
      decisions: rows.map((d) => ({
        id: d.id,
        subjectRef: d.subjectRef,
        subjectType: d.subjectType,
        subjectLabel: labelFor(d.subjectType, d.subjectRef),
        decisionType: d.decisionType,
        outcome: d.outcome,
        limitFils: d.limitFils,
        advanceRatePermyriad: d.advanceRatePermyriad,
        priceMilliBpsPerDay: d.priceMilliBpsPerDay,
        reasonCode: d.reasonCode,
        reasonText: d.reasonText,
        bindingRule: d.bindingRule,
        rulepackVersion: d.rulepackVersion,
        inputHash: d.inputHash,
        actor: d.actor,
        shadow: d.shadow,
        evaluatedAt: d.evaluatedAt.toISOString(),
      })),
      shadowDiff: {
        candidateVersion: CANDIDATE_PACK_VERSION,
        delta: CANDIDATE_DELTA_SUMMARY.map((d) => ({ ...d })),
        shadowPairs,
        approvalsGained,
        approvalsLost,
        limitMoves,
        priceMoves,
        examples,
        note: "Shadow rows decide nothing — they record what the candidate pack WOULD have decided on the same snapshot. Promotion is a risk-committee decision.",
      },
    });
  } catch (e) {
    console.error("[api/decisions GET]", e);
    return errors.internal();
  }
}
