// WATERLINE — POST /api/invoices/[id]/confirm (Task 2-a).
// Buyer-portal confirmation simulation (PRD 4.2): deduped → verified via
// `buyer_portal`, the weakest verification route — the single-click confirmation
// from the buyer's portal. Bumps buyerLink.confirmedInvoiceCount and writes the
// invoice.verified event.

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();

    // M4 (read-only) blocks all writes.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");

    const { id } = await params;
    const invoice = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, id },
      include: { buyerLink: true },
    });
    if (invoice === null) return errors.notFound(`Invoice ${id}`);

    if (invoice.verificationState !== "deduped") {
      return errors.invalidRequest(
        `Invoice is '${invoice.verificationState}' — buyer confirmation applies only to invoices awaiting it (deduped).`,
      );
    }

    const now = new Date();
    // Transition + counter bump + event, atomically (transactional outbox).
    const [updated, buyer] = await db.$transaction([
      db.invoice.update({
        where: { id: invoice.id },
        data: {
          verificationState: "verified",
          verifiedVia: "buyer_portal",
          verifiedAt: now,
        },
      }),
      db.buyerLink.update({
        where: { id: invoice.buyerLinkId },
        data: { confirmedInvoiceCount: { increment: 1 } },
      }),
      db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "invoice.verified",
          subjectRef: invoice.id,
          payloadJson: JSON.stringify({
            via: "buyer_portal",
            ref: invoice.externalRef,
            buyerId: invoice.buyerLinkId,
          }),
        },
      }),
    ]);

    return ok({
      invoice: {
        id: updated.id,
        externalRef: updated.externalRef,
        issueDate: updated.issueDate.toISOString(),
        dueDate: updated.dueDate.toISOString(),
        currency: updated.currency,
        grossFils: updated.grossFils,
        taxFils: updated.taxFils,
        source: updated.source,
        verificationState: updated.verificationState,
        verifiedVia: updated.verifiedVia,
        verifiedAt: updated.verifiedAt ? updated.verifiedAt.toISOString() : null,
        fundingState: updated.fundingState,
        dueInDays: Math.ceil((updated.dueDate.getTime() - Date.now()) / DAY),
        buyer: {
          id: buyer.id,
          buyerName: buyer.buyerName,
          buyerTaxId: buyer.buyerTaxId,
          tier: buyer.tier,
          avgDaysToPay: buyer.avgDaysToPay,
          confirmedInvoiceCount: buyer.confirmedInvoiceCount,
          disputeCount: buyer.disputeCount,
        },
      },
    });
  } catch (e) {
    console.error("[api/invoices/[id]/confirm]", e);
    return errors.internal();
  }
}
