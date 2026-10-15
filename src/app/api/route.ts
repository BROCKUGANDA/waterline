// WATERLINE — GET /api  (service discovery & health).
// Replaces the scaffold "Hello, world!": an enterprise API root describes
// itself. Returns the route map (method, money-moving, guard semantics) and
// a live health probe (database reachable, seed present, ledger balanced).
// Read-only, never throws — health endpoints must answer even when the
// product is degraded; failures are reported in the body, not the status line.

import { db } from "@/lib/db";
import { DEMO_TENANT, ok } from "@/lib/api";
import { verifyLedgerIntegrity } from "@/lib/ledger";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

interface RouteDescriptor {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  purpose: string;
  moneyMoving: boolean;
}

const ROUTES: RouteDescriptor[] = [
  { path: "/api", method: "GET", purpose: "Service discovery and health", moneyMoving: false },
  { path: "/api/overview", method: "GET", purpose: "Cash view aggregate: balance, liquidity, counts, consents, status", moneyMoving: false },
  { path: "/api/invoices", method: "GET", purpose: "Invoice list (filter: all|ready|pending|disputed|settled)", moneyMoving: false },
  { path: "/api/invoices", method: "POST", purpose: "Submit an invoice for verification (consent-gated)", moneyMoving: false },
  { path: "/api/invoices/{id}", method: "GET", purpose: "Invoice detail with offers, latest decision, payout", moneyMoving: false },
  { path: "/api/invoices/{id}/quote", method: "GET", purpose: "Deterministic quote — append-only decision before any outcome", moneyMoving: false },
  { path: "/api/invoices/{id}/confirm", method: "POST", purpose: "Buyer-portal confirmation (deduped → verified)", moneyMoving: false },
  { path: "/api/invoices/{id}/dispute", method: "POST", purpose: "Dispute drill — flag or resolve; crosses the dispute-rate guardrail honestly", moneyMoving: false },
  { path: "/api/invoices/{id}/settle", method: "POST", purpose: "Simulate buyer settlement; releases reserve", moneyMoving: true },
  { path: "/api/offers/{id}/accept", method: "POST", purpose: "Accept an offer; funds the advance, creates payout", moneyMoving: true },
  { path: "/api/payouts/{id}", method: "GET", purpose: "4-stage payout pipeline (Accepted/Reserved/Sent/Settled)", moneyMoving: false },
  { path: "/api/escrow", method: "GET", purpose: "Milestone contracts with per-contract totals", moneyMoving: false },
  { path: "/api/escrow", method: "POST", purpose: "Award an escrow contract at the custodian", moneyMoving: true },
  { path: "/api/escrow/{id}/milestones/{mid}", method: "POST", purpose: "Milestone state machine (delivered/approve/dispute/resolve)", moneyMoving: true },
  { path: "/api/treasury", method: "GET", purpose: "Autopilot state: policy, obligations, projection, sweeps", moneyMoving: false },
  { path: "/api/treasury/projection", method: "GET", purpose: "90-day forward cash projection (advisory, deterministic)", moneyMoving: false },
  { path: "/api/treasury/policy", method: "PUT", purpose: "Update floor / horizon / safety margin / autopilot", moneyMoving: false },
  { path: "/api/treasury/sweep", method: "POST", purpose: "Sweep surplus to an instrument (rule-pack decided)", moneyMoving: true },
  { path: "/api/treasury/recall", method: "POST", purpose: "Recall a swept position with accrued yield", moneyMoving: true },
  { path: "/api/treasury/obligations", method: "POST", purpose: "Add a forward-looking obligation", moneyMoving: false },
  { path: "/api/decisions", method: "GET", purpose: "Append-only decision records (latest first)", moneyMoving: false },
  { path: "/api/decisions/{id}", method: "GET", purpose: "Full decision record with re-derived checks", moneyMoving: false },
  { path: "/api/decisions/{id}/replay", method: "POST", purpose: "Replay a decision against its stored snapshot", moneyMoving: false },
  { path: "/api/consents", method: "GET", purpose: "PDPL consent register with purpose registry", moneyMoving: false },
  { path: "/api/consents", method: "POST", purpose: "Grant a scoped consent (one purpose per toggle)", moneyMoving: false },
  { path: "/api/consents/{id}", method: "DELETE", purpose: "Revoke a consent", moneyMoving: false },
  { path: "/api/status", method: "GET", purpose: "Degrade mode M0–M4, kill switches, breakers — the UI never guesses", moneyMoving: false },
  { path: "/api/status", method: "POST", purpose: "Operator mode/switch changes (two-person, audited)", moneyMoving: false },
  { path: "/api/ops/e07-drill", method: "POST", purpose: "Portfolio-ceiling drill — stages the E07 scenario via the canonical routes; unwind settles the drill-funded book", moneyMoving: true },
  { path: "/api/activity", method: "GET", purpose: "Activity feed with server-rendered copy", moneyMoving: false },
  { path: "/api/audit", method: "GET", purpose: "Ledger integrity, recent entries, rounding account", moneyMoving: false },
];

export async function GET(): Promise<Response> {
  // Health probes run even when the seed is missing — the probe itself
  // reports that fact instead of failing.
  const health: {
    database: "up" | "down";
    seeded: boolean;
    ledger: { balanced: boolean; txns: number; breaks: number } | null;
  } = { database: "down", seeded: false, ledger: null };

  try {
    await db.$queryRaw`SELECT 1`;
    health.database = "up";
    const seeded = await ensureSeed();
    health.seeded = true;
    void seeded;
    const integrity = await verifyLedgerIntegrity(DEMO_TENANT);
    health.ledger = {
      balanced: integrity.balanced,
      txns: integrity.txns,
      breaks: integrity.breaks.length,
    };
  } catch {
    // Reported in the body; the endpoint still answers 200 with discovery data.
  }

  return ok({
    service: "WATERLINE",
    tagline: "Liquidity layer for UAE businesses — du SME Challenge, Theme 2",
    conventions: {
      envelope: "ok/data | problem/error — every response, no exceptions",
      money: "integer fils (1 AED = 100 fils); no floating point on money paths",
      moneyMoving: "POST routes above require an Idempotency-Key header (≥ 8 chars)",
      decisions: "append-only records written before any outcome is shown",
      status: "degrade modes M0–M4 published on /api/status drive the UI",
    },
    health,
    routes: ROUTES,
  });
}
