// WATERLINE — POST /api/invoices/[id]/settle (Task 2-a).
// Demo buyer settlement: the buyer pays the gross at due date. Only for
// fundingState=accepted. Posts two balanced transactions via postTransaction:
//   1. collection  — BANK_COLLECTIONS debit gross / RECEIVABLE_CONTROL credit gross
//                    (sourceEventId `invoice.settled:{id}`)
//   2. reserve release — RESERVE_HELD debit reserve / SME_WALLET credit reserve
//                    (sourceEventId `reserve.release:{id}`)
// Invoice.fundingState → settled; the payout resolves to settled+reconciled.
// Money-moving POST: Idempotency-Key header REQUIRED (contract rule 1).
// Ledger-level idempotency: (tenant, sourceEventId) unique — a repeat settle is
// a no-op on the ledger.

import { db } from "@/lib/db";
import { ok, errors, requireIdempotencyKey, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { postTransaction, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { shortId } from "@/lib/canonical";
import type { BuyerLink, Invoice, Payout } from "@prisma/client";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSeed();

    // Money-moving endpoint → Idempotency-Key required (PRD 5.1 / contract rule 1).
    const idempotencyKey = requireIdempotencyKey(req);
    if (idempotencyKey === null) {
      return errors.invalidRequest(
        "Idempotency-Key header (≥8 chars) is required on money-moving endpoints.",
      );
    }

    // Status guards: M4 blocks ALL writes; the dynamicDiscounting kill switch
    // blocks the engine (settlement included). M3 suspends NEW funding —
    // settlement unwinds an existing position, so it proceeds.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");
    const killSwitches = JSON.parse(status?.killSwitchesJson ?? "{}") as Record<string, boolean>;
    if (killSwitches.global || killSwitches.dynamicDiscounting) {
      return errors.killSwitchActive(
        "Funding is suspended by an operator — settlement is paused until the switch is cleared.",
      );
    }

    const { id } = await params;
    const invoice = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, id },
      include: { buyerLink: true },
    });
    if (invoice === null) return errors.notFound(`Invoice ${id}`);

    // Idempotent replay: an already-settled invoice returns its current state;
    // the ledger would dedupe the source events anyway.
    if (invoice.fundingState === "settled") {
      const priorPayout = await db.payout.findFirst({
        where: { offer: { invoiceId: id } },
        orderBy: { acceptedAt: "desc" },
      });
      return ok({
        invoice: serializeInvoice(invoice),
        payout: priorPayout ? serializePayout(priorPayout) : null,
        alreadySettled: true,
      });
    }
    if (invoice.fundingState !== "accepted") {
      return errors.invalidRequest(
        `Only invoices with fundingState 'accepted' can settle (current: '${invoice.fundingState}').`,
      );
    }

    const offer = await db.offer.findFirst({
      where: { tenantId: DEMO_TENANT, invoiceId: id, state: "accepted" },
      orderBy: { acceptedAt: "desc" },
    });
    if (offer === null) {
      return errors.invalidRequest(
        "No accepted offer found for this invoice — cannot settle an unfunded invoice.",
      );
    }

    // Integer fils only. The reserve mirrors the funding transaction's
    // RESERVE_HELD credit exactly: gross − net − fee.
    const gross = invoice.grossFils;
    const fee = offer.feeFils ?? 0;
    const net = offer.netProceedsFils ?? offer.principalFils - fee;
    const reserve = gross - net - fee;
    const now = new Date();

    // 1) Buyer collection: money arrives from the buyer, the assigned claim clears.
    await postTransaction({
      tenantId: DEMO_TENANT,
      txnId: shortId("txn"),
      sourceEventId: `invoice.settled:${id}`,
      valueDate: now,
      entries: [
        {
          accountCode: LEDGER_ACCOUNTS.BANK_COLLECTIONS,
          direction: "debit",
          amountFils: gross,
          memo: `Buyer payment received — ${invoice.externalRef}`,
        },
        {
          accountCode: LEDGER_ACCOUNTS.RECEIVABLE_CONTROL,
          direction: "credit",
          amountFils: gross,
          memo: `Claim cleared — ${invoice.externalRef}`,
        },
      ],
      eventType: "invoice.settled",
      eventSubjectRef: id,
      eventPayload: { grossFils: gross, invoiceId: id, ref: invoice.externalRef },
    });

    // 2) Reserve release: the un-advanced remainder pays out to the SME wallet.
    let reserveReleased = false;
    if (reserve > 0) {
      await postTransaction({
        tenantId: DEMO_TENANT,
        txnId: shortId("txn"),
        sourceEventId: `reserve.release:${id}`,
        valueDate: now,
        entries: [
          {
            accountCode: LEDGER_ACCOUNTS.RESERVE_HELD,
            direction: "debit",
            amountFils: reserve,
            memo: `Reserve released — ${invoice.externalRef}`,
          },
          {
            accountCode: LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT),
            direction: "credit",
            amountFils: reserve,
            memo: `Reserve to du Pay wallet — ${invoice.externalRef}`,
          },
        ],
        eventType: "reserve.released",
        eventSubjectRef: id,
        eventPayload: { reserveFils: reserve, invoiceId: id, ref: invoice.externalRef },
      });
      reserveReleased = true;
    }

    // 3) State: invoice settled; payout resolves to settled + reconciled.
    const updatedInvoice = await db.invoice.update({
      where: { id: invoice.id },
      data: { fundingState: "settled" },
      include: { buyerLink: true },
    });
    const payoutRow = await db.payout.findFirst({ where: { offerId: offer.id } });
    let updatedPayout = payoutRow
      ? await db.payout.update({
          where: { id: payoutRow.id },
          data: {
            state: "settled",
            settledAt: payoutRow.settledAt ?? now,
            reconciledAt: payoutRow.reconciledAt ?? now,
          },
        })
      : null;

    return ok({
      invoice: serializeInvoice(updatedInvoice),
      payout: updatedPayout ? serializePayout(updatedPayout) : null,
      reserveReleased,
    });
  } catch (e) {
    console.error("[api/invoices/[id]/settle]", e);
    return errors.internal();
  }
}

// ── serializers (ISO dates, integer fils) ───────────────────────────────────

function serializeInvoice(inv: Invoice & { buyerLink: BuyerLink }) {
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
      id: inv.buyerLink.id,
      buyerName: inv.buyerLink.buyerName,
      tier: inv.buyerLink.tier,
    },
  };
}

function serializePayout(p: Payout) {
  return {
    id: p.id,
    offerId: p.offerId,
    state: p.state,
    rail: p.rail,
    destinationRef: p.destinationRef,
    amountFils: p.amountFils,
    providerRef: p.providerRef,
    acceptedAt: p.acceptedAt.toISOString(),
    settledAt: p.settledAt ? p.settledAt.toISOString() : null,
    reconciledAt: p.reconciledAt ? p.reconciledAt.toISOString() : null,
    etaSeconds: p.etaSeconds,
  };
}
