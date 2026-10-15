// WATERLINE — POST /api/invoices/[id]/dispute (Round 8; PRD Part 8 drill).
// The dispute drill: an operator (or a buyer) flags an invoice as disputed,
// and resolves it once the buyer re-confirms. This is the honest path that
// crosses the dispute-rate guardrail — the next /api/status heartbeat then
// auto-applies M1 exactly as PRD Part 8 specifies ("automatic on guardrail
// breach"), tightening limits through the cautious rule-pack delta while
// pricing stays unchanged.
//
//   body { reason, resolve?: boolean }
//   Idempotency-Key required (operator audit action — same store, PRD 8.2).
//
//   Flag    → verificationState "disputed", buyer disputeCount +1 (the
//             relationship carries its history), invoice.disputed event.
//   Resolve → verificationState "verified" via buyer_portal (the buyer
//             re-confirmed after resolution), invoice.dispute_resolved event.
//
// Settled/funded invoices cannot be disputed — money has already moved.

import { db } from "@/lib/db";
import { ok, errors, readJson, requireIdempotencyKey, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

interface DisputeBody {
  reason?: unknown;
  resolve?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const body = await readJson<DisputeBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) {
      return errors.invalidRequest("reason is mandatory — every drill action is audited with who, when and why.");
    }
    const resolve = body.resolve === true;

    // M4 (read-only) blocks all writes.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");

    const { id } = await params;
    const invoice = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, id },
      include: { buyerLink: true },
    });
    if (invoice === null) return errors.notFound(`Invoice ${id}`);

    if (resolve) {
      if (invoice.verificationState !== "disputed") {
        return errors.invalidRequest(
          `Invoice is '${invoice.verificationState}' — only disputed invoices can be resolved.`,
        );
      }
      const now = new Date();
      const [updated] = await db.$transaction([
        db.invoice.update({
          where: { id: invoice.id },
          data: {
            verificationState: "verified",
            verifiedVia: "buyer_portal",
            verifiedAt: now,
          },
        }),
        db.appEvent.create({
          data: {
            tenantId: DEMO_TENANT,
            type: "invoice.dispute_resolved",
            subjectRef: invoice.id,
            payloadJson: JSON.stringify({
              ref: invoice.externalRef,
              buyerId: invoice.buyerLinkId,
              via: "buyer_portal",
              reason,
              actor: "operator@du",
            }),
          },
        }),
        db.operatorAction.create({
          data: {
            actor: "operator@du",
            action: "dispute_resolve",
            targetRef: invoice.id,
            reason,
            detailJson: JSON.stringify({ idempotencyKey: idemKey, ref: invoice.externalRef }),
          },
        }),
      ]);
      return ok({
        invoice: invoiceView(updated, invoice.buyerLink),
        resolved: true,
      });
    }

    // ── Flag as disputed ──
    if (invoice.verificationState === "disputed") {
      return errors.invalidRequest("Invoice is already disputed.");
    }
    if (invoice.fundingState === "settled") {
      return errors.invalidRequest("Invoice is settled — money has already moved; a settled invoice cannot be disputed.");
    }

    const [updated, buyer] = await db.$transaction([
      db.invoice.update({
        where: { id: invoice.id },
        data: { verificationState: "disputed" },
      }),
      db.buyerLink.update({
        where: { id: invoice.buyerLinkId },
        data: { disputeCount: { increment: 1 } },
      }),
      db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "invoice.disputed",
          subjectRef: invoice.id,
          payloadJson: JSON.stringify({
            ref: invoice.externalRef,
            buyerId: invoice.buyerLinkId,
            reason,
            actor: "operator@du",
          }),
        },
      }),
      db.operatorAction.create({
        data: {
          actor: "operator@du",
          action: "dispute_flag",
          targetRef: invoice.id,
          reason,
          detailJson: JSON.stringify({ idempotencyKey: idemKey, ref: invoice.externalRef }),
        },
      }),
    ]);

    return ok({
      invoice: invoiceView(updated, buyer),
      resolved: false,
    });
  } catch (e) {
    console.error("[api/invoices/[id]/dispute]", e);
    return errors.internal();
  }
}

function invoiceView(
  inv: { id: string; externalRef: string; issueDate: Date; dueDate: Date; currency: string; grossFils: number; taxFils: number; source: string; verificationState: string; verifiedVia: string | null; verifiedAt: Date | null; fundingState: string },
  buyer: { id: string; buyerName: string; buyerTaxId: string; tier: string; avgDaysToPay: number; confirmedInvoiceCount: number; disputeCount: number },
) {
  return {
    id: inv.id,
    externalRef: inv.externalRef,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    currency: inv.currency,
    grossFils: inv.grossFils,
    taxFils: inv.taxFils,
    source: inv.source,
    verificationState: inv.verificationState,
    verifiedVia: inv.verifiedVia,
    verifiedAt: inv.verifiedAt ? inv.verifiedAt.toISOString() : null,
    fundingState: inv.fundingState,
    dueInDays: Math.ceil((inv.dueDate.getTime() - Date.now()) / DAY),
    buyer: {
      id: buyer.id,
      buyerName: buyer.buyerName,
      buyerTaxId: buyer.buyerTaxId,
      tier: buyer.tier,
      avgDaysToPay: buyer.avgDaysToPay,
      confirmedInvoiceCount: buyer.confirmedInvoiceCount,
      disputeCount: buyer.disputeCount,
    },
  };
}
