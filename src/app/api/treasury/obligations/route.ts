// WATERLINE — POST /api/treasury/obligations  (Task 2-b2; PRD 4.5).
// Add a manual obligation to the forward-looking calendar. Detected
// obligations (payroll, rent, VAT, supplier, du billing) come from the
// obligation-detection model; a manual one is certain by definition — it
// still shapes the sweepable amount and protects the floor like any other.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import type { Obligation } from "@prisma/client";

export const dynamic = "force-dynamic";

const KINDS = ["payroll", "rent", "vat", "supplier", "du_bill", "custom"] as const;
const CADENCES = ["once", "weekly", "monthly"] as const;

interface ObligationBody {
  label?: unknown;
  kind?: unknown;
  dueDate?: unknown;
  amountFils?: unknown;
  cadence?: unknown;
}

function serializeObligation(o: Obligation) {
  return {
    id: o.id,
    label: o.label,
    kind: o.kind,
    dueDate: o.dueDate.toISOString(),
    dueInDays: Math.ceil((o.dueDate.getTime() - Date.now()) / 86_400_000),
    amountFils: o.amountFils,
    cadence: o.cadence,
    confidencePermyriad: o.confidencePermyriad,
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    // M4 is read-only: all writes are rejected with degraded (contract rule 4).
    const st = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (st?.mode === "M4") return errors.degraded("M4");

    const body = await readJson<ObligationBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    const label = body.label;
    if (typeof label !== "string" || label.trim().length < 1 || label.trim().length > 120) {
      return errors.invalidRequest("label must be a non-empty string of at most 120 characters.");
    }
    const kind = body.kind ?? "custom";
    if (typeof kind !== "string" || !KINDS.includes(kind as (typeof KINDS)[number])) {
      return errors.invalidRequest(`kind must be one of ${KINDS.join(", ")} (manual additions default to custom).`);
    }
    const dueDateRaw = body.dueDate;
    if (typeof dueDateRaw !== "string") {
      return errors.invalidRequest("dueDate must be an ISO date string.");
    }
    const dueDate = new Date(dueDateRaw);
    if (Number.isNaN(dueDate.getTime())) {
      return errors.invalidRequest("dueDate must be a parseable ISO date.");
    }
    if (dueDate.getTime() <= Date.now()) {
      return errors.invalidRequest("dueDate must be in the future — the calendar is forward-looking.");
    }
    const amountFils = body.amountFils;
    if (typeof amountFils !== "number" || !Number.isInteger(amountFils) || amountFils <= 0) {
      return errors.invalidRequest("amountFils must be a positive integer in fils.");
    }
    const cadence = body.cadence ?? "once";
    if (typeof cadence !== "string" || !CADENCES.includes(cadence as (typeof CADENCES)[number])) {
      return errors.invalidRequest(`cadence must be one of ${CADENCES.join(", ")}.`);
    }

    const obligation = await db.$transaction(async (tx) => {
      const row = await tx.obligation.create({
        data: {
          tenantId: DEMO_TENANT,
          label: label.trim(),
          kind,
          dueDate,
          amountFils,
          cadence,
          confidencePermyriad: 10_000, // manually declared — certain by definition
          active: true,
        },
      });
      await tx.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "treasury.obligation_added",
          subjectRef: row.id,
          payloadJson: JSON.stringify({
            label: row.label,
            kind: row.kind,
            amountFils: row.amountFils,
            dueDate: row.dueDate.toISOString(),
            cadence: row.cadence,
          }),
        },
      });
      return row;
    });

    return ok({ obligation: serializeObligation(obligation) });
  } catch {
    return errors.internal();
  }
}
