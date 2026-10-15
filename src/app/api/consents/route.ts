// WATERLINE — /api/consents (Task 2-a).
//   GET  — list the tenant's scoped consents (PRD 4.1: one purpose per toggle,
//          each independently revocable).
//   POST — grant { purpose }: one row per purpose; re-grant after revocation
//          clears revokedAt (revocation history lives in the event log).
// Purpose registry (PRD 4.1): billing_history, bank_data, buyer_contact.

import { db } from "@/lib/db";
import { ok, errors, readJson, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { shortId } from "@/lib/canonical";
import type { ConsentGrant } from "@prisma/client";

export const dynamic = "force-dynamic";

const PURPOSE_REGISTRY: Record<string, { description: string; scope: string[] }> = {
  billing_history: {
    description:
      "du billing history — powers your indicative limit before any invoice is uploaded",
    scope: ["du_billing_history:12m"],
  },
  bank_data: {
    description: "Bank data via Open Finance — powers cash-view balances and sweepable amounts",
    scope: ["open_finance:accounts:read", "open_finance:balances:read"],
  },
  buyer_contact: {
    description: "Buyer confirmation contact — lets us confirm invoices with your buyers",
    scope: ["buyer_confirmation:send"],
  },
};

export async function GET() {
  try {
    await ensureSeed();
    const rows = await db.consentGrant.findMany({
      where: { tenantId: DEMO_TENANT },
      orderBy: [{ purpose: "asc" }, { grantedAt: "desc" }],
    });
    return ok({
      consents: rows.map(serialize),
      registry: Object.entries(PURPOSE_REGISTRY).map(([purpose, meta]) => ({
        purpose,
        description: meta.description,
        scope: meta.scope,
      })),
    });
  } catch (e) {
    console.error("[api/consents GET]", e);
    return errors.internal();
  }
}

export async function POST(req: Request) {
  try {
    await ensureSeed();

    // M4 (read-only) blocks all writes.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");

    const body = await readJson<Record<string, unknown>>(req);
    const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : "";
    if (!purpose || !(purpose in PURPOSE_REGISTRY)) {
      return errors.invalidRequest(
        `purpose must be one of: ${Object.keys(PURPOSE_REGISTRY).join(", ")}.`,
      );
    }

    const now = new Date();
    const existing = await db.consentGrant.findFirst({
      where: { tenantId: DEMO_TENANT, purpose },
      orderBy: { grantedAt: "desc" },
    });

    if (existing && existing.revokedAt === null) {
      // Already active — idempotent grant.
      return ok({ consent: serialize(existing), alreadyGranted: true });
    }

    // State change + event, atomically (transactional outbox).
    const grant = await db.$transaction(async (tx) => {
      let row: ConsentGrant;
      if (existing) {
        row = await tx.consentGrant.update({
          where: { id: existing.id },
          data: { revokedAt: null, grantedAt: now },
        });
      } else {
        const meta = PURPOSE_REGISTRY[purpose];
        row = await tx.consentGrant.create({
          data: {
            id: shortId("cg"),
            tenantId: DEMO_TENANT,
            purpose,
            scopeJson: JSON.stringify(meta.scope),
            grantedAt: now,
            provider: "du_business",
            providerConsentRef: `dub_${shortId("c")}`,
          },
        });
      }
      await tx.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "consent.granted",
          subjectRef: row.id,
          payloadJson: JSON.stringify({ purpose, regranted: existing !== null }),
        },
      });
      return row;
    });

    return ok({ consent: serialize(grant) }, existing ? 200 : 201);
  } catch (e) {
    console.error("[api/consents POST]", e);
    return errors.internal();
  }
}

function serialize(c: ConsentGrant) {
  let scope: string[] | null = null;
  try {
    const parsed: unknown = JSON.parse(c.scopeJson);
    if (Array.isArray(parsed)) scope = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    scope = null;
  }
  return {
    id: c.id,
    purpose: c.purpose,
    description: PURPOSE_REGISTRY[c.purpose]?.description ?? null,
    scope,
    grantedAt: c.grantedAt.toISOString(),
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
    provider: c.provider,
  };
}
