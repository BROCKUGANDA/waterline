// One-off: reset the demo DB to the pristine seed state (run with bun).
// Deletes all rows in FK order, then re-runs the idempotent seed in this
// fresh process. The dev server derives everything from the DB per request,
// so no restart is needed.
import { db } from "../src/lib/db";
import { ensureSeed } from "../src/lib/seed";

async function main() {
  // Children first (FK order)
  await db.ledgerEntry.deleteMany();
  await db.appEvent.deleteMany();
  await db.operatorAction.deleteMany();
  await db.payout.deleteMany();
  await db.offer.deleteMany();
  await db.decision.deleteMany();
  await db.invoice.deleteMany();
  await db.milestone.deleteMany();
  await db.escrowContract.deleteMany();
  await db.sweep.deleteMany();
  await db.obligation.deleteMany();
  await db.treasuryPolicy.deleteMany();
  await db.consentGrant.deleteMany();
  await db.buyerLink.deleteMany();
  await db.statusState.deleteMany();
  await db.entity.deleteMany();

  await ensureSeed();

  const [entity, invoices, txns, entries, contracts] = await Promise.all([
    db.entity.count(),
    db.invoice.count(),
    db.ledgerEntry.groupBy({ by: ["txnId"], _count: true }),
    db.ledgerEntry.count(),
    db.escrowContract.count(),
  ]);
  console.log(
    JSON.stringify({ entity, invoices, txns: txns.length, entries, contracts }, null, 1)
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
