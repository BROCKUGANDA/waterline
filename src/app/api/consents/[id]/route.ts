// WATERLINE — DELETE /api/consents/[id] (Task 2-a).
// Revoke a scoped consent: set revokedAt, write AppEvent 'consent.revoked'.
// Dependent features disable immediately in the UI; funded positions continue
// to their contractual conclusion with that fact disclosed (PRD 4.1).
// Idempotent: revoking an already-revoked consent is a no-op.

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();

    // M4 (read-only) blocks all writes.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");

    const { id } = await params;
    const grant = await db.consentGrant.findFirst({
      where: { tenantId: DEMO_TENANT, id },
    });
    if (grant === null) return errors.notFound(`Consent ${id}`);

    if (grant.revokedAt !== null) {
      return ok({ consent: serialize(grant), alreadyRevoked: true });
    }

    const now = new Date();
    // Revocation + event, atomically (transactional outbox).
    const revoked = await db.$transaction(async (tx) => {
      const row = await tx.consentGrant.update({
        where: { id: grant.id },
        data: { revokedAt: now },
      });
      await tx.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "consent.revoked",
          subjectRef: row.id,
          payloadJson: JSON.stringify({
            purpose: row.purpose,
            note: "Dependent features disable immediately; derived features purge within 24h. Funded positions continue to contractual conclusion.",
          }),
        },
      });
      return row;
    });

    return ok({ consent: serialize(revoked) });
  } catch (e) {
    console.error("[api/consents/[id] DELETE]", e);
    return errors.internal();
  }
}

function serialize(c: {
  id: string;
  purpose: string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  provider: string;
}) {
  return {
    id: c.id,
    purpose: c.purpose,
    grantedAt: c.grantedAt.toISOString(),
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
    provider: c.provider,
  };
}
