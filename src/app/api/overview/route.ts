// WATERLINE — GET /api/overview — the Cash-view aggregate (Task 2-a).
// Contract: WATERLINE-API-CONTRACT.md §GET /api/overview.
// All money is integer fils. Balances are DERIVED from the ledger, never stored.
// The wallet is a credit-normal account, so walletFils = -(derived debit-positive balance).

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { accountBalance, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { evaluateSweep, entityCapFils, type FeatureSnapshot } from "@/lib/ruleengine";
import { rulePack } from "@/lib/rulepack";

const DAY = 86_400_000;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeed();
    const t = DEMO_TENANT;
    const now = new Date();

    // ── Entity ─────────────────────────────────────────────────────────────
    const entity = await db.entity.findFirst({ where: { tenantId: t, role: "sme" } });
    if (entity === null) return errors.notFound("SME entity");

    // ── Derived balances (never stored as truth — PRD 2.5) ────────────────
    const walletLedgerBalance = await accountBalance(t, LEDGER_ACCOUNTS.SME_WALLET(t)); // debit-positive
    const walletFils = -walletLedgerBalance; // credit-normal: credits are money in

    const instrumentRows = await db.ledgerEntry.findMany({
      where: { tenantId: t, accountCode: { startsWith: "instrument." } },
      select: { direction: true, amountFils: true },
    });
    const investedFils = -instrumentRows.reduce(
      (acc, r) => acc + (r.direction === "debit" ? r.amountFils : -r.amountFils),
      0,
    );

    // ── Invoice pipeline ──────────────────────────────────────────────────
    const invoices = await db.invoice.findMany({
      where: { tenantId: t },
      select: { verificationState: true, fundingState: true, grossFils: true, dueDate: true },
    });
    let readyCount = 0;
    let readyFils = 0;
    let pendingCount = 0;
    let disputedCount = 0;
    let settledCount = 0;
    for (const inv of invoices) {
      const funded = inv.fundingState === "accepted" || inv.fundingState === "settled";
      // ready = verified, not yet funded, not overdue (quotable right now)
      if (
        inv.verificationState === "verified" &&
        !funded &&
        inv.dueDate.getTime() > now.getTime()
      ) {
        readyCount += 1;
        readyFils += inv.grossFils;
        continue;
      }
      if (inv.fundingState === "settled") {
        settledCount += 1;
        continue;
      }
      if (inv.verificationState === "disputed") {
        disputedCount += 1;
        continue;
      }
      if (inv.verificationState !== "verified") {
        pendingCount += 1; // awaiting verification (received/parsed/deduped/unverifiable/…)
      }
    }

    // ── Treasury: sweepable via the pure rule engine (the floor is absolute) ─
    const policy = await db.treasuryPolicy.findFirst({ where: { tenantId: t } });
    const floorFils = policy?.floorFils ?? 5_000_000;
    const horizonDays = policy?.horizonDays ?? 14;
    const safetyMarginPermyriad = policy?.safetyMarginPermyriad ?? 1500;
    const obligations = await db.obligation.findMany({
      where: {
        tenantId: t,
        active: true,
        dueDate: { lte: new Date(now.getTime() + horizonDays * DAY) },
      },
      select: { amountFils: true },
    });
    const obligationsFils = obligations.reduce((acc, o) => acc + o.amountFils, 0);
    const treasurySnapshot: FeatureSnapshot = {
      asOfDate: now.toISOString().slice(0, 10),
      decisionType: "treasury_sweep",
      entity: {
        kybState: entity.kybState,
        licenceDaysRemaining: Math.ceil((entity.licenceExpiry.getTime() - now.getTime()) / DAY),
        tenureMonths: entity.tenureMonths,
        sectorCode: entity.sectorCode,
        billingBand: entity.billingBand,
      },
      invoice: null,
      buyer: null,
      portfolio: { bookExposureFils: 0 },
      treasury: { balanceFils: walletFils, floorFils, obligationsFils, safetyMarginPermyriad },
    };
    const sweep = evaluateSweep(treasurySnapshot, rulePack);

    // ── Buyers, consents, status ───────────────────────────────────────────
    const buyers = await db.buyerLink.findMany({
      where: { tenantId: t },
      orderBy: { confirmedInvoiceCount: "desc" },
    });
    const consents = await db.consentGrant.findMany({
      where: { tenantId: t },
      orderBy: { purpose: "asc" },
    });
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    const killSwitches = JSON.parse(status?.killSwitchesJson ?? "{}") as Record<string, boolean>;
    const breakers = JSON.parse(status?.breakersJson ?? "{}") as Record<string, string>;

    return ok({
      entity: {
        id: entity.id,
        legalName: entity.legalName,
        tradeLicence: entity.tradeLicence,
        licenceExpiry: entity.licenceExpiry.toISOString(),
        emirate: entity.emirate,
        sectorCode: entity.sectorCode,
        kybState: entity.kybState,
        tenureMonths: entity.tenureMonths,
        billingBand: entity.billingBand,
        duPaySuffix: entity.duPaySuffix,
        licenceDaysRemaining: Math.ceil(
          (entity.licenceExpiry.getTime() - now.getTime()) / DAY,
        ),
      },
      // The activation moment (PRD 4.1-04): before any invoice is uploaded,
      // the SME sees its indicative limit derived from du billing history
      // alone — tenure and billing band through the same deterministic rule
      // pack that prices every advance. No model, no guess.
      indicativeLimitFils: entityCapFils(treasurySnapshot, rulePack),
      balance: { walletFils, asOf: now.toISOString() },
      liquidity: {
        availableFils: walletFils + investedFils,
        totalApprovedFils: readyFils, // verified, not-yet-funded, not-overdue gross
        floorFils,
        sweepableFils: sweep.sweepableFils,
        investedFils,
      },
      invoices: { readyCount, readyFils, pendingCount, disputedCount, settledCount },
      buyers: buyers.map((b) => ({
        id: b.id,
        buyerName: b.buyerName,
        tier: b.tier,
        avgDaysToPay: b.avgDaysToPay,
        confirmedInvoiceCount: b.confirmedInvoiceCount,
      })),
      consents: consents.map((c) => ({
        id: c.id,
        purpose: c.purpose,
        grantedAt: c.grantedAt.toISOString(),
        revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
      })),
      status: {
        mode: status?.mode ?? "M0",
        killSwitches,
        breakers,
        message: status?.message ?? null,
      },
    });
  } catch (e) {
    console.error("[api/overview]", e);
    return errors.internal();
  }
}
