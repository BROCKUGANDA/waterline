// WATERLINE — POST /api/decisions/[id]/replay (Task 2-a).
// Re-evaluate the stored feature snapshot against the rule-pack version
// recorded on the decision, and compare the outcome fields byte-identically
// (PRD 3.2: "Replaying the same hash against the same pack version must
// produce a byte-identical outcome" — the replay regression, PRD 9.3).
// The original decision is NEVER modified (append-only). Writes an AppEvent
// 'decision.replayed'.
//
// Comparison fields:
//   advance_offer  → outcome, limitFils, advanceRatePermyriad,
//                    priceMilliBpsPerDay, reasonCode, bindingRule
//   treasury_sweep → outcome, reasonCode, bindingRule (the fields persisted
//                    on the Decision row for sweep decisions)

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import {
  evaluateAdvance,
  evaluateSweep,
  type FeatureSnapshot,
  type EngineDecision,
  type SweepDecision,
} from "@/lib/ruleengine";
import { rulePack, RULEPACK_VERSION } from "@/lib/rulepack";

export const dynamic = "force-dynamic";

interface OutcomeFields {
  outcome: string;
  limitFils: number | null;
  advanceRatePermyriad: number | null;
  priceMilliBpsPerDay: number | null;
  reasonCode: string;
  bindingRule: string;
  reasonText: string;
  sweepableFils: number | null;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();

    // M4 (read-only) blocks all writes — the replay writes an AppEvent.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");

    const { id } = await params;
    const d = await db.decision.findFirst({ where: { tenantId: DEMO_TENANT, id } });
    if (d === null) return errors.notFound(`Decision ${id}`);

    // Parse and sanity-check the stored snapshot.
    let snap: FeatureSnapshot;
    try {
      snap = JSON.parse(d.featureSnapshot) as FeatureSnapshot;
    } catch {
      return errors.invalidRequest("Stored feature snapshot is not valid JSON — cannot replay.");
    }
    if (
      !snap ||
      typeof snap !== "object" ||
      !snap.decisionType ||
      !snap.entity ||
      !snap.portfolio
    ) {
      return errors.invalidRequest(
        "Stored feature snapshot is not a valid FeatureSnapshot — cannot replay.",
      );
    }

    // Re-evaluate the SAME snapshot. Only one pack version exists in this
    // build; if the recorded version ever differs from the active one we still
    // evaluate and surface the drift explicitly (never silently).
    let original: OutcomeFields;
    let replay: OutcomeFields;
    let matchesOriginal: boolean;

    if (d.decisionType === "treasury_sweep") {
      const r: SweepDecision = evaluateSweep(snap, rulePack);
      original = {
        outcome: d.outcome,
        limitFils: d.limitFils,
        advanceRatePermyriad: d.advanceRatePermyriad,
        priceMilliBpsPerDay: d.priceMilliBpsPerDay,
        reasonCode: d.reasonCode,
        bindingRule: d.bindingRule,
        reasonText: d.reasonText,
        sweepableFils: null,
      };
      replay = {
        outcome: r.outcome,
        limitFils: null,
        advanceRatePermyriad: null,
        priceMilliBpsPerDay: null,
        reasonCode: r.reasonCode,
        bindingRule: r.bindingRule,
        reasonText: r.reasonText,
        sweepableFils: r.sweepableFils,
      };
      matchesOriginal =
        original.outcome === replay.outcome &&
        original.reasonCode === replay.reasonCode &&
        original.bindingRule === replay.bindingRule;
    } else {
      const r: EngineDecision = evaluateAdvance(snap, rulePack);
      original = {
        outcome: d.outcome,
        limitFils: d.limitFils,
        advanceRatePermyriad: d.advanceRatePermyriad,
        priceMilliBpsPerDay: d.priceMilliBpsPerDay,
        reasonCode: d.reasonCode,
        bindingRule: d.bindingRule,
        reasonText: d.reasonText,
        sweepableFils: null,
      };
      replay = {
        outcome: r.outcome,
        limitFils: r.limitFils,
        advanceRatePermyriad: r.advanceRatePermyriad,
        priceMilliBpsPerDay: r.priceMilliBpsPerDay,
        reasonCode: r.reasonCode,
        bindingRule: r.bindingRule,
        reasonText: r.reasonText,
        sweepableFils: null,
      };
      matchesOriginal =
        original.outcome === replay.outcome &&
        original.limitFils === replay.limitFils &&
        original.advanceRatePermyriad === replay.advanceRatePermyriad &&
        original.priceMilliBpsPerDay === replay.priceMilliBpsPerDay &&
        original.reasonCode === replay.reasonCode &&
        original.bindingRule === replay.bindingRule;
    }

    await db.appEvent.create({
      data: {
        tenantId: DEMO_TENANT,
        type: "decision.replayed",
        subjectRef: d.id,
        payloadJson: JSON.stringify({
          decisionId: d.id,
          matchesOriginal,
          rulepackVersion: d.rulepackVersion,
          inputHash: d.inputHash,
        }),
      },
    });

    return ok({
      matchesOriginal,
      original,
      replay,
      rulepackVersion: d.rulepackVersion,
      activeRulepackVersion: RULEPACK_VERSION,
      versionDrift: d.rulepackVersion !== RULEPACK_VERSION,
      evaluatedAt: d.evaluatedAt.toISOString(),
    });
  } catch (e) {
    console.error("[api/decisions/[id]/replay]", e);
    return errors.internal();
  }
}
