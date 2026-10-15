// WATERLINE — GET /api/audit  (Task 2-b2; PRD Parts 6–7).
// The ops-console audit tab: full ledger integrity verification (every
// transaction must sum to zero), the last 25 ledger entries with memo and
// source event, decision/payout/offer counts, and the declared rounding
// account balance — any residual fil is visible, never absorbed silently.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok } from "@/lib/api";
import { accountBalance, LEDGER_ACCOUNTS, verifyLedgerIntegrity } from "@/lib/ledger";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await ensureSeed();

    const [integrity, entries, decisions, payoutsSettled, offersAccepted, roundingBalanceFils] =
      await Promise.all([
        verifyLedgerIntegrity(DEMO_TENANT),
        db.ledgerEntry.findMany({
          where: { tenantId: DEMO_TENANT },
          orderBy: [{ postedAt: "desc" }, { id: "desc" }],
          take: 25,
        }),
        db.decision.count({ where: { tenantId: DEMO_TENANT } }),
        db.payout.count({ where: { tenantId: DEMO_TENANT, state: "settled" } }),
        db.offer.count({ where: { tenantId: DEMO_TENANT, state: "accepted" } }),
        accountBalance(DEMO_TENANT, LEDGER_ACCOUNTS.ROUNDING),
      ]);

    return ok({
      integrity,
      entries: entries.map((e) => ({
        id: e.id,
        txnId: e.txnId,
        accountCode: e.accountCode,
        direction: e.direction,
        amountFils: e.amountFils,
        memo: e.memo,
        postedAt: e.postedAt.toISOString(),
        sourceEventId: e.sourceEventId,
      })),
      counts: {
        decisions,
        payoutsSettled,
        offersAccepted,
      },
      roundingBalanceFils,
    });
  } catch {
    return errors.internal();
  }
}
