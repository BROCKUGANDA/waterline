// WATERLINE — /api/invoices (Task 2-a).
//   GET  — list with filter=all|ready|pending|disputed|settled, joined buyer info,
//          computed dueInDays, latest offer state, latest decision outcome.
//          Order: ready first (dueInDays asc), then pending, then rest.
//   POST — submit an invoice for verification (PRD 4.2 state machine):
//          received → parsed → deduped → verified via the strongest available route.
//          Per-tenant duplicate hash → 409 duplicate_invoice (original surfaced).
//          Cross-tenant duplicate hash → both frozen + fraud review event (PRD 4.2).
// Consent: submission requires an active `billing_history` consent → 403 consent_required.

import { db } from "@/lib/db";
import { ok, problem, errors, readJson, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { hashSnapshot, shortId } from "@/lib/canonical";
import { applyPermyriad } from "@/lib/money";
import type { BuyerLink, Decision, Invoice, Offer } from "@prisma/client";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

const FILTERS = ["all", "ready", "pending", "disputed", "settled"] as const;
const SOURCES = ["einvoice", "buyer_api", "upload", "du_ap"] as const;

interface InvoiceListItem {
  id: string;
  externalRef: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  grossFils: number;
  taxFils: number;
  source: string;
  verificationState: string;
  verifiedVia: string | null;
  verifiedAt: string | null;
  fundingState: string;
  dueInDays: number;
  buyer: {
    id: string;
    buyerName: string;
    buyerTaxId: string;
    tier: string;
    avgDaysToPay: number;
    confirmedInvoiceCount: number;
    disputeCount: number;
  };
  latestOffer: {
    id: string;
    state: string;
    principalFils: number;
    rateMilliBps: number;
    advanceRatePermyriad: number;
    expiresAt: string;
    daysEarly: number | null;
    feeFils: number | null;
    netProceedsFils: number | null;
  } | null;
  latestDecision: {
    id: string;
    outcome: string;
    reasonCode: string;
    reasonText: string;
    limitFils: number | null;
    evaluatedAt: string;
  } | null;
}

function serializeInvoice(
  inv: Invoice,
  buyer: BuyerLink,
  latestOffer: Offer | null,
  latestDecision: Decision | null,
): InvoiceListItem {
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
    latestOffer: latestOffer
      ? {
          id: latestOffer.id,
          state: latestOffer.state,
          principalFils: latestOffer.principalFils,
          rateMilliBps: latestOffer.rateMilliBps,
          advanceRatePermyriad: latestOffer.advanceRatePermyriad,
          expiresAt: latestOffer.expiresAt.toISOString(),
          daysEarly: latestOffer.daysEarly,
          feeFils: latestOffer.feeFils,
          netProceedsFils: latestOffer.netProceedsFils,
        }
      : null,
    latestDecision: latestDecision
      ? {
          id: latestDecision.id,
          outcome: latestDecision.outcome,
          reasonCode: latestDecision.reasonCode,
          reasonText: latestDecision.reasonText,
          limitFils: latestDecision.limitFils,
          evaluatedAt: latestDecision.evaluatedAt.toISOString(),
        }
      : null,
  };
}

/** ready = verified, not yet funded, not overdue (quotable right now). */
function isReady(inv: Invoice, now: number): boolean {
  return (
    inv.verificationState === "verified" &&
    (inv.fundingState === "none" || inv.fundingState === "quoted") &&
    inv.dueDate.getTime() > now
  );
}

/** pending = awaiting verification (received/parsed/deduped/unverifiable/…). */
function isPending(inv: Invoice): boolean {
  return inv.verificationState !== "verified" && inv.verificationState !== "disputed";
}

function categoryRank(inv: Invoice, now: number): number {
  if (isReady(inv, now)) return 0; // ready
  if (isPending(inv)) return 1; // pending
  return 2; // rest: disputed, settled, overdue-verified, funded
}

export async function GET(req: Request) {
  try {
    await ensureSeed();
    const filter = new URL(req.url).searchParams.get("filter") ?? "all";
    if (!(FILTERS as readonly string[]).includes(filter)) {
      return errors.invalidRequest(
        `Unknown filter '${filter}'. Use all|ready|pending|disputed|settled.`,
      );
    }

    const now = Date.now();
    const rows = await db.invoice.findMany({
      where: { tenantId: DEMO_TENANT },
      include: { buyerLink: true },
    });
    const invoiceIds = rows.map((r) => r.id);
    const offers = invoiceIds.length
      ? await db.offer.findMany({
          where: { tenantId: DEMO_TENANT, invoiceId: { in: invoiceIds } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const decisions = invoiceIds.length
      ? await db.decision.findMany({
          where: { tenantId: DEMO_TENANT, subjectRef: { in: invoiceIds } },
          orderBy: { evaluatedAt: "desc" },
        })
      : [];

    const latestOfferByInvoice = new Map<string, Offer>();
    for (const o of offers) {
      if (!latestOfferByInvoice.has(o.invoiceId)) latestOfferByInvoice.set(o.invoiceId, o);
    }
    const latestDecisionByInvoice = new Map<string, Decision>();
    for (const d of decisions) {
      if (!latestDecisionByInvoice.has(d.subjectRef)) latestDecisionByInvoice.set(d.subjectRef, d);
    }

    const filtered = rows.filter((inv) => {
      switch (filter) {
        case "ready":
          return isReady(inv, now);
        case "pending":
          return isPending(inv);
        case "disputed":
          return inv.verificationState === "disputed";
        case "settled":
          return inv.fundingState === "settled";
        default:
          return true; // all
      }
    });

    // ready first (dueInDays asc), then pending, then rest
    const items = filtered
      .map((inv) => ({
        inv,
        item: serializeInvoice(
          inv,
          inv.buyerLink,
          latestOfferByInvoice.get(inv.id) ?? null,
          latestDecisionByInvoice.get(inv.id) ?? null,
        ),
      }))
      .sort((a, b) => {
        const ra = categoryRank(a.inv, now);
        const rb = categoryRank(b.inv, now);
        return ra !== rb ? ra - rb : a.item.dueInDays - b.item.dueInDays;
      })
      .map((x) => x.item);

    return ok({ invoices: items });
  } catch (e) {
    console.error("[api/invoices GET]", e);
    return errors.internal();
  }
}

export async function POST(req: Request) {
  try {
    await ensureSeed();

    // M4 (read-only) blocks all writes.
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") return errors.degraded("M4");

    // ── Validate the request body (typed discipline — no unvalidated input) ──
    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errors.invalidRequest("Body must be a JSON object.");
    }
    const buyerLinkId = typeof body.buyerLinkId === "string" ? body.buyerLinkId.trim() : "";
    const externalRef = typeof body.externalRef === "string" ? body.externalRef.trim() : "";
    const grossFils = body.grossFils;
    if (!buyerLinkId) return errors.invalidRequest("buyerLinkId is required.");
    if (!externalRef) return errors.invalidRequest("externalRef is required.");
    if (typeof grossFils !== "number" || !Number.isSafeInteger(grossFils) || grossFils <= 0) {
      return errors.invalidRequest("grossFils must be a positive integer number of fils.");
    }
    if (typeof body.dueDate !== "string" || Number.isNaN(new Date(body.dueDate).getTime())) {
      return errors.invalidRequest("dueDate must be a valid ISO date string.");
    }
    const dueDate = new Date(body.dueDate as string);
    let issueDate = new Date();
    if (body.issueDate !== undefined) {
      if (typeof body.issueDate !== "string" || Number.isNaN(new Date(body.issueDate).getTime())) {
        return errors.invalidRequest("issueDate must be a valid ISO date string when provided.");
      }
      issueDate = new Date(body.issueDate as string);
    }
    if (dueDate.getTime() <= issueDate.getTime()) {
      return errors.invalidRequest("dueDate must be after issueDate.");
    }
    const source = body.source === undefined ? "upload" : (body.source as string);
    if (!(SOURCES as readonly string[]).includes(source)) {
      return errors.invalidRequest("source must be one of einvoice|buyer_api|upload|du_ap.");
    }

    // ── Consent gate (contract rule 5): billing_history must be active ──────
    const consent = await db.consentGrant.findFirst({
      where: {
        tenantId: DEMO_TENANT,
        purpose: "billing_history",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (consent === null) return errors.consentRequired();

    // ── Buyer must exist inside the tenant scope ───────────────────────────
    const link = await db.buyerLink.findFirst({
      where: { tenantId: DEMO_TENANT, id: buyerLinkId },
    });
    if (link === null) return errors.notFound("Buyer link");

    // ── Normalise → canonical hash (PRD 4.2: buyer tax id, invoice number,
    //    gross amount, issue date — resistant to reformatting, sensitive to
    //    any material change) ────────────────────────────────────────────────
    const invoiceHash = hashSnapshot({
      buyerTaxId: link.buyerTaxId.trim().toUpperCase(),
      ref: externalRef,
      gross: grossFils,
      issueDate: issueDate.toISOString().slice(0, 10),
    });

    // ── Dedupe: per-tenant → 409; cross-tenant → freeze both + fraud review ─
    const sameHash = await db.invoice.findMany({ where: { invoiceHash } });
    const sameTenant = sameHash.find((i) => i.tenantId === DEMO_TENANT);
    if (sameTenant) {
      return problem(
        409,
        "duplicate_invoice",
        `This invoice hash is already present — original ${sameTenant.externalRef} (${sameTenant.id}). Surfacing the original.`,
      );
    }
    const crossTenant = sameHash.find((i) => i.tenantId !== DEMO_TENANT);
    if (crossTenant) {
      // Freeze both copies and route to review — never auto-rejected (PRD 4.2).
      const frozen = await db.invoice.create({
        data: {
          tenantId: DEMO_TENANT,
          entityId: link.entityId,
          buyerLinkId: link.id,
          externalRef,
          issueDate,
          dueDate,
          currency: "AED",
          grossFils,
          taxFils: applyPermyriad(grossFils, 500),
          invoiceHash,
          source,
          verificationState: "duplicate",
          notes: `FROZEN — cross-tenant hash collision with ${crossTenant.id} (tenant ${crossTenant.tenantId}); routed to fraud review`,
        },
      });
      await db.invoice.update({
        where: { id: crossTenant.id },
        data: {
          notes: `FROZEN — cross-tenant duplicate of ${frozen.id} (tenant ${DEMO_TENANT}); routed to fraud review`,
        },
      });
      await db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "fraud.review",
          subjectRef: frozen.id,
          payloadJson: JSON.stringify({
            attemptedInvoiceId: frozen.id,
            originalInvoiceId: crossTenant.id,
            originalTenantId: crossTenant.tenantId,
            invoiceHash,
            externalRef,
            grossFils,
          }),
        },
      });
      return problem(
        409,
        "duplicate_invoice",
        "Cross-tenant duplicate detected — both copies are frozen and the collision is routed to fraud review. Never auto-rejected.",
      );
    }
    // Secondary per-tenant document guard (same buyer + number + amount):
    // catches duplicates of seeded rows whose hashes used the seed formula.
    const sameDocument = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, buyerLinkId: link.id, externalRef, grossFils },
    });
    if (sameDocument) {
      return problem(
        409,
        "duplicate_invoice",
        `This invoice is already present — original ${sameDocument.externalRef} (${sameDocument.id}). Surfacing the original.`,
      );
    }

    // ── State machine (PRD 4.2): received → parsed → deduped → verified ─────
    const invoiceId = shortId("inv");
    await db.invoice.create({
      data: {
        id: invoiceId,
        tenantId: DEMO_TENANT,
        entityId: link.entityId,
        buyerLinkId: link.id,
        externalRef,
        issueDate,
        dueDate,
        currency: "AED",
        grossFils,
        taxFils: applyPermyriad(grossFils, 500),
        invoiceHash,
        source,
        verificationState: "received",
      },
    });
    // normalisation done → parsed
    await db.invoice.update({
      where: { id: invoiceId },
      data: { verificationState: "parsed" },
    });
    // hash computed, no duplicates → deduped
    let invoice = await db.invoice.update({
      where: { id: invoiceId },
      data: { verificationState: "deduped" },
      include: { buyerLink: true },
    });

    // ── Verification priority (PRD 4.2): e-invoice registry → du AP file →
    //    buyer API callback → buyer portal (single-click, awaits confirmation).
    //    Demo simulation: einvoice/du_ap sources verify instantly for trusted
    //    buyers (silver+ with ≥3 confirmed invoices); platinum/gold buyers
    //    expose a buyer API that verifies immediately; anything else stays
    //    `deduped` awaiting buyer confirmation via the confirm endpoint. ──────
    const trustedBuyer =
      ["platinum", "gold", "silver"].includes(link.tier) && link.confirmedInvoiceCount >= 3;
    let verifiedVia: string | null = null;
    if (source === "einvoice" && trustedBuyer) verifiedVia = "einvoice";
    else if (source === "du_ap" && trustedBuyer) verifiedVia = "du_ap";
    else if (link.tier === "platinum" || link.tier === "gold") verifiedVia = "buyer_api";

    if (verifiedVia) {
      invoice = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          verificationState: "verified",
          verifiedVia,
          verifiedAt: new Date(),
        },
        include: { buyerLink: true },
      });
    }

    // ── Events (transactional-outbox spirit: written with the state change) ─
    await db.appEvent.create({
      data: {
        tenantId: DEMO_TENANT,
        type: "invoice.submitted",
        subjectRef: invoiceId,
        payloadJson: JSON.stringify({
          ref: externalRef,
          buyerId: link.id,
          buyerName: link.buyerName,
          grossFils,
        }),
      },
    });
    if (verifiedVia) {
      await db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "invoice.verified",
          subjectRef: invoiceId,
          payloadJson: JSON.stringify({ via: verifiedVia, ref: externalRef }),
        },
      });
    }

    return ok(
      { invoice: serializeInvoice(invoice, invoice.buyerLink, null, null) },
      201,
    );
  } catch (e) {
    // Race on the (tenant, hash) unique index → typed duplicate problem.
    if ((e as { code?: string }).code === "P2002") {
      return problem(
        409,
        "duplicate_invoice",
        "This invoice hash is already present — surfacing the original.",
      );
    }
    console.error("[api/invoices POST]", e);
    return errors.internal();
  }
}
