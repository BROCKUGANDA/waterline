// WATERLINE — POST /api/ops/e07-drill (Round 9).
// One-click portfolio-ceiling drill (E07): stages the honest demo scenario
// the PRD intends for M1 — fund the book under the cautious pack until the
// outstanding advances approach the tightened ceiling, then a fresh buyer-
// confirmed invoice crosses it and the next quote pauses with E_PORTFOLIO.
//
// The drill ORCHESTRATES the real product paths via internal calls to the
// canonical routes — nothing is staged outside the money paths:
//   1. POST /api/status   — apply M1 (the cautious pack, ceiling AED 100,000)
//                           with the operator's two-person reason;
//   2. GET  /quote + POST /accept — fund every ready verified invoice at the
//                           REAL quoted price (idempotency keys prefixed
//                           `e07drill:` so unwind can find exactly these);
//   3. POST /api/invoices — submit a fresh buyer_api-confirmed invoice sized
//                           to cross the remaining headroom;
//   4. unwind: POST /settle on exactly the drill-funded invoices — the book
//                           drains, headroom returns, and the drill invoice
//                           quotes clean again (the recovery arc).
//
// Invariants honoured: integer fils everywhere, decisions before outcomes
// (the quotes are real decisions), idempotency keys on every money move,
// append-only operator audit (the drill itself is audited), the ceiling is
// read from the ACTIVE pack (never guessed), and if the arithmetic cannot
// cross the ceiling the response says so honestly.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { CAUTIOUS_PACK } from "@/lib/rulepacks";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const DRILL_REF = "EFG-DRILL-99001";
const DRILL_BUYER = "bl_emaar"; // Emaar Facilities Group — gold tier, confirmed history
const DRILL_KEY_PREFIX = "e07drill:";

interface DrillBody {
  action?: unknown;
  reason?: unknown;
}

/** Internal call into the canonical routes — same server, same guarantees.
 *  Origin falls back to the loopback binding when the request came through
 *  a proxy that rewrote the host. */
async function call(
  origin: string,
  method: "GET" | "POST",
  path: string,
  idemKey: string | null,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

/** Outstanding funded advances — the same formula the quote route uses
 *  (accepted offers' principalFils on invoices that have not settled). */
async function bookExposureFils(): Promise<number> {
  const accepted = await db.offer.findMany({
    where: { tenantId: DEMO_TENANT, state: "accepted" },
    select: { principalFils: true, invoice: { select: { fundingState: true } } },
  });
  return accepted
    .filter((o) => o.invoice.fundingState !== "settled")
    .reduce((acc, o) => acc + o.principalFils, 0);
}

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header (≥8 chars) is required on this request.");
    }

    const body = await readJson<DrillBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");
    const action = body.action === "unwind" ? "unwind" : "stage";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) {
      return errors.invalidRequest("reason is mandatory — the drill is an operator action, audited with why.");
    }

    // M4 blocks all writes — the drill included.
    const st = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (st?.mode === "M4") return errors.degraded("M4");

    const origin = (() => {
      try {
        const o = new URL(req.url).origin;
        return /localhost|127\.0\.0\.1/.test(o) ? o : "http://127.0.0.1:3000";
      } catch {
        return "http://127.0.0.1:3000";
      }
    })();

    // The drill is itself an audited operator action.
    await db.operatorAction.create({
      data: {
        actor: "operator@du",
        action: action === "unwind" ? "e07_drill_unwind" : "e07_drill_stage",
        targetRef: "portfolio",
        reason,
        detailJson: JSON.stringify({ idempotencyKey: idemKey }),
      },
    });

    // ── UNWIND: settle exactly the drill-funded invoices ────────────────────
    if (action === "unwind") {
      const drillOffers = await db.offer.findMany({
        where: { tenantId: DEMO_TENANT, state: "accepted", acceptedIdempotencyKey: { startsWith: DRILL_KEY_PREFIX } },
        select: { invoiceId: true, invoice: { select: { fundingState: true } } },
      });
      let settled = 0;
      const stillFunded = drillOffers.filter((o) => o.invoice.fundingState !== "settled");
      for (const o of stillFunded) {
        const r = await call(origin, "POST", `/api/invoices/${o.invoiceId}/settle`, `${DRILL_KEY_PREFIX}settle:${o.invoiceId}:${idemKey}`, {});
        if (r.status === 200) settled += 1;
      }
      const exposure = await bookExposureFils();
      return ok({
        action,
        settledCount: settled,
        remainingFundedCount: stillFunded.length - settled,
        exposureFils: exposure,
        ceilingFils: CAUTIOUS_PACK.limits.portfolioCeilingFils,
      });
    }

    // ── STAGE ────────────────────────────────────────────────────────────────
    // Idempotent staging: if the drill invoice already exists and drill-funded
    // offers exist, report the current state instead of re-staging.
    const existingDrillInvoice = await db.invoice.findFirst({
      where: { tenantId: DEMO_TENANT, externalRef: DRILL_REF },
    });
    const alreadyDrillFunded = await db.offer.count({
      where: { tenantId: DEMO_TENANT, state: "accepted", acceptedIdempotencyKey: { startsWith: DRILL_KEY_PREFIX } },
    });
    if (existingDrillInvoice && alreadyDrillFunded > 0) {
      const exposure = await bookExposureFils();
      const stNow = await db.statusState.findUnique({ where: { id: "singleton" } });
      return ok({
        action,
        staged: true,
        alreadyStaged: true,
        mode: stNow?.mode ?? "M0",
        exposureFils: exposure,
        ceilingFils: CAUTIOUS_PACK.limits.portfolioCeilingFils,
        crossed: exposure + existingDrillInvoice.grossFils > CAUTIOUS_PACK.limits.portfolioCeilingFils,
        acceptedCount: alreadyDrillFunded,
        drillInvoice: { id: existingDrillInvoice.id, ref: existingDrillInvoice.externalRef, grossFils: existingDrillInvoice.grossFils },
        note: "Already staged — quote the drill invoice to see E07, or unwind to settle the drill-funded book.",
      });
    }

    // 1. Apply M1 if the platform is not already cautious. (If the operator is
    //    in M2/M3 we do NOT fight them — the drill reports it honestly.)
    let mode = st?.mode ?? "M0";
    if (mode === "M0") {
      const r = await call(origin, "POST", "/api/status", `${DRILL_KEY_PREFIX}m1:${idemKey}`, {
        mode: "M1",
        reason: `${reason} — E07 portfolio drill applies the cautious pack`,
        confirm: true,
      });
      if (r.status !== 200) {
        return errors.invalidRequest(`Could not apply M1 for the drill — the status route replied ${r.status}.`);
      }
      mode = "M1";
    }
    if (mode !== "M1") {
      return errors.invalidRequest(`The drill stages the ceiling under M1, but the platform is in ${mode}. Recover to M0 first — never fight the operator's mode.`);
    }

    // 2. Fund every ready verified invoice at the REAL quoted price.
    //    (fundingState none | quoted — quoted just means an open offer
    //    exists; the drill's fresh quote supersedes it before accepting.)
    const invoices = await db.invoice.findMany({
      where: {
        tenantId: DEMO_TENANT,
        verificationState: "verified",
        fundingState: { in: ["none", "quoted"] },
      },
      select: { id: true, dueDate: true },
    });
    let acceptedCount = 0;
    const acceptedIds: string[] = [];
    for (const inv of invoices) {
      const dueInDays = Math.max(1, Math.ceil((inv.dueDate.getTime() - Date.now()) / DAY));
      const daysEarly = Math.max(1, Math.min(30, Math.floor(dueInDays * 0.8)));
      const q = await call(origin, "GET", `/api/invoices/${inv.id}/quote`, null);
      if (q.status !== 200) continue;
      const data = (q.json.data ?? {}) as { offer?: { id?: string } };
      const offerId = data.offer?.id;
      if (!offerId) continue;
      const a = await call(origin, "POST", `/api/offers/${offerId}/accept`, `${DRILL_KEY_PREFIX}accept:${inv.id}:${idemKey}`, { daysEarly });
      if (a.status === 200) {
        acceptedCount += 1;
        acceptedIds.push(inv.id);
      }
    }

    // 3. Size and submit the drill invoice to cross the remaining headroom.
    const exposure = await bookExposureFils();
    const ceiling = CAUTIOUS_PACK.limits.portfolioCeilingFils;
    // Gross = headroom + AED 25,000, clamped to [AED 25,000, AED 63,000]
    // (above the E05 minimum, under the gold-tier advance cap so the invoice
    // is a plausible book entry — E07 sees the GROSS against the ceiling).
    const headroom = ceiling - exposure;
    const gross = Math.min(6_300_000, Math.max(2_500_000, headroom + 2_500_000));

    let drillInvoice = existingDrillInvoice;
    if (!drillInvoice) {
      const dueDate = new Date(Date.now() + 30 * DAY);
      const r = await call(origin, "POST", "/api/invoices", `${DRILL_KEY_PREFIX}submit:${idemKey}`, {
        buyerLinkId: DRILL_BUYER,
        externalRef: DRILL_REF,
        grossFils: gross,
        dueDate: dueDate.toISOString(),
        source: "buyer_api",
      });
      if (r.status !== 200 && r.status !== 201 && r.status !== 409) {
        return errors.invalidRequest(`Could not submit the drill invoice — the invoices route replied ${r.status}.`);
      }
      drillInvoice = await db.invoice.findFirst({ where: { tenantId: DEMO_TENANT, externalRef: DRILL_REF } });
    }
    if (!drillInvoice) {
      return errors.internal();
    }

    const crossed = exposure + drillInvoice.grossFils > ceiling;
    return ok({
      action,
      staged: true,
      alreadyStaged: false,
      mode,
      exposureFils: exposure,
      ceilingFils: ceiling,
      crossed,
      acceptedCount,
      drillInvoice: { id: drillInvoice.id, ref: drillInvoice.externalRef, grossFils: drillInvoice.grossFils },
      note: crossed
        ? "Book staged against the cautious ceiling — quote the drill invoice to see E07 pause it honestly."
        : "The staged book does not cross the ceiling yet — fund more invoices or settle less; the arithmetic is shown, never forced.",
    });
  } catch (e) {
    console.error("[api/ops/e07-drill]", e);
    return errors.internal();
  }
}
