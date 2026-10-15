// WATERLINE — GET /api/decisions/[id] (Task 2-a).
// Full decision record including the parsed featureSnapshot JSON — the exact
// inputs the engine saw (PRD 3.4: written append-only at decision time, never
// reconstructed). Also re-derives the rule checks from the stored snapshot so
// the record explains itself.

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { evaluate, type FeatureSnapshot } from "@/lib/ruleengine";
import { rulePack } from "@/lib/rulepack";
import type { EngineDecision } from "@/lib/ruleengine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();
    const { id } = await params;

    const d = await db.decision.findFirst({ where: { tenantId: DEMO_TENANT, id } });
    if (d === null) return errors.notFound(`Decision ${id}`);

    // Parsed feature snapshot (the hashed inputs — replayable forever).
    let featureSnapshot: unknown = null;
    try {
      featureSnapshot = JSON.parse(d.featureSnapshot);
    } catch {
      featureSnapshot = null;
    }

    // Subject label for context.
    let subjectLabel = d.subjectRef;
    if (d.subjectType === "invoice") {
      const inv = await db.invoice.findFirst({
        where: { id: d.subjectRef },
        include: { buyerLink: true },
      });
      if (inv) subjectLabel = inv.buyerLink ? `${inv.externalRef} — ${inv.buyerLink.buyerName}` : inv.externalRef;
    } else if (d.subjectType === "sweep") {
      const sweep = await db.sweep.findFirst({ where: { id: d.subjectRef } });
      if (sweep) subjectLabel = sweep.instrumentRef;
    }

    // Re-derive checks by re-evaluating the stored snapshot (pure function).
    let checks: EngineDecision["checks"] = [];
    try {
      const snap = JSON.parse(d.featureSnapshot) as FeatureSnapshot;
      const replayed = evaluate(snap, rulePack);
      if ("checks" in replayed) checks = replayed.checks;
    } catch {
      checks = [];
    }

    return ok({
      decision: {
        id: d.id,
        subjectRef: d.subjectRef,
        subjectType: d.subjectType,
        subjectLabel,
        decisionType: d.decisionType,
        inputHash: d.inputHash,
        rulepackVersion: d.rulepackVersion,
        featureSnapshot,
        outcome: d.outcome,
        limitFils: d.limitFils,
        advanceRatePermyriad: d.advanceRatePermyriad,
        priceMilliBpsPerDay: d.priceMilliBpsPerDay,
        bindingRule: d.bindingRule,
        reasonCode: d.reasonCode,
        reasonText: d.reasonText,
        checks,
        evaluatedAt: d.evaluatedAt.toISOString(),
        actor: d.actor,
        shadow: d.shadow,
      },
    });
  } catch (e) {
    console.error("[api/decisions/[id] GET]", e);
    return errors.internal();
  }
}
