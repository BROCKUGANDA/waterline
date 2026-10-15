// WATERLINE — PUT /api/treasury/policy  (Task 2-b2; PRD 4.5).
// The SME sets one number — the minimum balance it will never drop below —
// plus the horizon and the safety margin. All validated (integer fils, sane
// bands) and written with an audit event whose payload is exactly the fields
// that changed. The floor is enforced as an absolute hard stop by the rule
// engine, not by this endpoint.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import type { TreasuryPolicy } from "@prisma/client";

export const dynamic = "force-dynamic";

interface PolicyBody {
  floorFils?: unknown;
  horizonDays?: unknown;
  safetyMarginPermyriad?: unknown;
  autoPilotEnabled?: unknown;
}

type PolicyUpdate = Pick<
  TreasuryPolicy,
  "floorFils" | "horizonDays" | "safetyMarginPermyriad" | "autoPilotEnabled"
>;

function serializePolicy(p: TreasuryPolicy) {
  return {
    floorFils: p.floorFils,
    horizonDays: p.horizonDays,
    safetyMarginPermyriad: p.safetyMarginPermyriad,
    autoPilotEnabled: p.autoPilotEnabled,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function PUT(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    // M4 is read-only: all writes are rejected with degraded (contract rule 4).
    // A kill switch pauses an engine, not the SME's own guardrail settings —
    // raising the floor mid-incident must stay possible.
    const st = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (st?.mode === "M4") return errors.degraded("M4");

    const body = await readJson<PolicyBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    const changed: Partial<PolicyUpdate> = {};

    if (body.floorFils !== undefined) {
      if (typeof body.floorFils !== "number" || !Number.isInteger(body.floorFils) || body.floorFils < 0) {
        return errors.invalidRequest("floorFils must be an integer ≥ 0 (fils).");
      }
      changed.floorFils = body.floorFils;
    }
    if (body.horizonDays !== undefined) {
      if (typeof body.horizonDays !== "number" || !Number.isInteger(body.horizonDays) || body.horizonDays < 3 || body.horizonDays > 90) {
        return errors.invalidRequest("horizonDays must be an integer between 3 and 90 days.");
      }
      changed.horizonDays = body.horizonDays;
    }
    if (body.safetyMarginPermyriad !== undefined) {
      if (typeof body.safetyMarginPermyriad !== "number" || !Number.isInteger(body.safetyMarginPermyriad) || body.safetyMarginPermyriad < 0 || body.safetyMarginPermyriad > 5000) {
        return errors.invalidRequest("safetyMarginPermyriad must be an integer between 0 and 5000 (0%–50%).");
      }
      changed.safetyMarginPermyriad = body.safetyMarginPermyriad;
    }
    if (body.autoPilotEnabled !== undefined) {
      if (typeof body.autoPilotEnabled !== "boolean") {
        return errors.invalidRequest("autoPilotEnabled must be a boolean.");
      }
      changed.autoPilotEnabled = body.autoPilotEnabled;
    }
    if (Object.keys(changed).length === 0) {
      return errors.invalidRequest("Provide at least one of floorFils, horizonDays, safetyMarginPermyriad, autoPilotEnabled.");
    }

    // Upsert on tenantId: the policy is a singleton per tenant, but the row is
    // never assumed to pre-exist.
    const policy = await db.$transaction(async (tx) => {
      const row = await tx.treasuryPolicy.upsert({
        where: { tenantId: DEMO_TENANT },
        create: { tenantId: DEMO_TENANT, ...changed },
        update: changed,
      });
      // Audit event — payload carries exactly the fields that changed.
      await tx.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "treasury.policy_updated",
          subjectRef: "singleton",
          payloadJson: JSON.stringify(changed),
        },
      });
      return row;
    });

    return ok({ policy: serializePolicy(policy) });
  } catch {
    return errors.internal();
  }
}
