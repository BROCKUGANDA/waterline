// WATERLINE — double-entry ledger service. Every movement is a balanced
// transaction; balances are DERIVED, never stored as truth (PRD 2.5).
// Invariants enforced here and asserted by property tests:
//   1. sum(direction × amount) === 0 for every txn
//   2. (tenant_id, source_event_id) unique on ledger_entry — DB constraint
//   3. Posting is idempotent: a repeated source event is a no-op

import { db } from "./db";

export const LEDGER_ACCOUNTS = {
  FUNDING_POOL: "funding.pool", // source of advances (funder capital)
  RECEIVABLE_CONTROL: "receivable.control", // assigned invoice claims held
  FEE_INCOME: "income.fees", // discount fee income
  RESERVE_HELD: "reserve.held", // un-advanced remainder held for the SME
  SME_WALLET: (tenantId: string) => `sme.wallet.${tenantId}`, // du Pay settlement destination
  BANK_COLLECTIONS: "bank.collections", // buyer payments received at settlement
  ESCROW_CUSTODIAN: "escrow.custodian", // funds at the licensed custodian bank
  BUYER_CONTRIBUTION: "buyer.contribution", // buyer funding of an escrow award
  INSTRUMENT_HOLDING: (ref: string) => `instrument.${ref}`, // treasury sweep holdings
  ROUNDING: "rounding.residual", // declared rounding account (PRD Part 7)
} as const;

export interface LedgerEntrySpec {
  accountCode: string;
  direction: "debit" | "credit";
  amountFils: number; // always positive
  memo?: string;
}

/**
 * Post a balanced transaction atomically. Writes the AppEvent outbox row in
 * the SAME transaction (transactional outbox — PRD 6.3).
 * Throws on unbalanced input — money never moves on a broken invariant.
 */
export async function postTransaction(opts: {
  tenantId: string;
  txnId: string;
  sourceEventId: string; // one logical event per txn — unique per tenant
  valueDate: Date;
  entries: LedgerEntrySpec[];
  eventType: string;
  eventSubjectRef?: string;
  eventPayload?: Record<string, unknown>;
  skipEvent?: boolean; // when the caller already writes its own event in-txn
}): Promise<{ txnId: string; alreadyPosted: boolean }> {
  const { tenantId, txnId, sourceEventId, valueDate, entries } = opts;

  // Invariant 1 — balanced before we touch the database.
  const sum = entries.reduce((acc, e) => acc + (e.direction === "debit" ? e.amountFils : -e.amountFils), 0);
  if (sum !== 0) {
    throw new Error(`LEDGER_UNBALANCED txn=${txnId} sum=${sum}`);
  }
  if (entries.some((e) => e.amountFils <= 0)) {
    throw new Error(`LEDGER_NON_POSITIVE txn=${txnId}`);
  }

  return db.$transaction(async (tx) => {
    // Invariant 2/3 — idempotency at the DB level. Rows store
    // `${sourceEventId}:${accountCode}`, so match by prefix.
    const existing = await tx.ledgerEntry.findFirst({
      where: { tenantId, sourceEventId: { startsWith: `${sourceEventId}:` } },
      select: { txnId: true },
    });
    if (existing) return { txnId: existing.txnId, alreadyPosted: true };

    await tx.ledgerEntry.createMany({
      data: entries.map((e) => ({
        tenantId,
        txnId,
        accountCode: e.accountCode,
        direction: e.direction,
        amountFils: e.amountFils,
        valueDate,
        sourceEventId: `${sourceEventId}:${e.accountCode}`,
        memo: e.memo ?? null,
      })),
    });

    if (!opts.skipEvent) {
      await tx.appEvent.create({
        data: {
          tenantId,
          type: opts.eventType,
          subjectRef: opts.eventSubjectRef ?? txnId,
          payloadJson: JSON.stringify({ txnId, ...opts.eventPayload }),
        },
      });
    }
    return { txnId, alreadyPosted: false };
  });
}

/** Derived balance for an account (or account prefix) — never stored. */
export async function accountBalance(tenantId: string, accountCode: string): Promise<number> {
  const rows = await db.ledgerEntry.findMany({
    where: { tenantId, accountCode },
    select: { direction: true, amountFils: true },
  });
  return rows.reduce((acc, r) => acc + (r.direction === "debit" ? r.amountFils : -r.amountFils), 0);
}

/** Assert every txn in the ledger sums to zero — used by the ops console. */
export async function verifyLedgerIntegrity(tenantId: string): Promise<{ balanced: boolean; txns: number; breaks: string[] }> {
  const rows = await db.ledgerEntry.findMany({ where: { tenantId }, select: { txnId: true, direction: true, amountFils: true } });
  const sums = new Map<string, number>();
  for (const r of rows) {
    const delta = r.direction === "debit" ? r.amountFils : -r.amountFils;
    sums.set(r.txnId, (sums.get(r.txnId) ?? 0) + delta);
  }
  const breaks = [...sums.entries()].filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`);
  return { balanced: breaks.length === 0, txns: sums.size, breaks };
}
