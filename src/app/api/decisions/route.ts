// WATERLINE — GET /api/decisions (Task 2-a).
// Latest decisions (default 25, ?limit=1..100), ordered evaluatedAt desc,
// with subject refs resolved to human labels (invoice number / sweep instrument).

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";

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
    });
  } catch (e) {
    console.error("[api/decisions GET]", e);
    return errors.internal();
  }
}
