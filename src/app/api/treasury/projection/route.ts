// WATERLINE — GET /api/treasury/projection  (PRD 5.2: "Forward cash
// projection with obligations"). A 90-day, day-by-day forward projection of
// the SME's du Pay wallet — deterministic, advisory only (PRD 9.4: the
// forecast "produces features, never decisions"; here it informs, the rule
// pack decides).
//
// Every figure is derived from the ledger and the obligation calendar at
// request time — nothing is stored as truth. All money is integer fils.
// Event sources, each labelled with its honesty level:
//   - obligation        OUT  contractual/detected calendar rows; recurring
//                        cadences (weekly/monthly) are projected forward
//                        within the horizon, flagged recurring.
//   - buyer_payment     IN   ESTIMATE — unfunded invoices expected to be
//                        paid by the buyer directly, arriving
//                        issueDate + buyer.avgDaysToPay (history-derived).
//   - reserve_release   IN   CONTRACTUAL — funded invoices release the held
//                        reserve (gross − net − fee) to the wallet at
//                        settlement on the due date. Exact stored amounts.
//   - escrow_release    IN   ON CONDITION — milestones in review release at
//                        metAt + reviewWindowDays (the declared window).
//   - autopilot_recall  IN   MODELLED — when a day would breach the floor,
//                        the autopilot recalls invested sweeps (FIFO, whole
//                        sweeps, with accrued yield) ahead of the shortfall.
//                        Only modelled when the autopilot is enabled; if
//                        funds are insufficient the projection shows the
//                        honest dip and a warning — never a fabricated save.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok } from "@/lib/api";
import { accountBalance, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { applyPermyriad, mulDivFloor } from "@/lib/money";
import { rulePack } from "@/lib/rulepack";
import { ensureSeed } from "@/lib/seed";
import type { Obligation, Sweep } from "@prisma/client";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const HORIZON_DAYS = 90;

interface Flow {
  label: string;
  amountFils: number;
  kind: "obligation" | "buyer_payment" | "reserve_release" | "escrow_release" | "autopilot_recall";
  /** estimate = history-derived arrival; onCondition = declared window; recurring = cadence projection */
  estimate?: boolean;
  onCondition?: boolean;
  recurring?: boolean;
  confidencePermyriad?: number;
  sourceRef: string;
}

interface DayProjection {
  date: string; // YYYY-MM-DD
  startFils: number;
  inflows: Flow[];
  outflows: Flow[];
  endFils: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Per-day yield of a swept instrument, integer fils. */
function yieldPerDay(s: Sweep): number {
  const instrument = rulePack.treasury.instruments.find((i) => i.ref === s.instrumentRef);
  if (!instrument) return 0;
  return mulDivFloor(s.amountFils, instrument.yieldMbsdPermyriad, 10_000);
}

export async function GET() {
  try {
    await ensureSeed();
    const t = DEMO_TENANT;

    const [entity, policy, walletEntries] = await Promise.all([
      db.entity.findFirst({ where: { tenantId: t, role: "sme" } }),
      db.treasuryPolicy.findUnique({ where: { tenantId: t } }),
      accountBalance(t, LEDGER_ACCOUNTS.SME_WALLET(t)),
    ]);
    if (!entity || !policy) return errors.internal();
    const startFils = -walletEntries; // credit-normal account
    const floorFils = policy.floorFils;

    const horizonEnd = new Date(Date.now() + HORIZON_DAYS * DAY);

    // ── Obligations: base occurrences + recurring cadence projections ──────
    const obligations = await db.obligation.findMany({
      where: { tenantId: t, active: true, dueDate: { lte: horizonEnd } },
      orderBy: { dueDate: "asc" },
    });
    const outByDay = new Map<string, Flow[]>();
    const projectObligation = (o: Obligation, due: Date, recurring: boolean) => {
      const key = ymd(due);
      const list = outByDay.get(key) ?? [];
      list.push({
        label: o.label,
        amountFils: o.amountFils,
        kind: "obligation",
        confidencePermyriad: o.confidencePermyriad,
        recurring,
        sourceRef: o.id,
      });
      outByDay.set(key, list);
    };
    for (const o of obligations) {
      projectObligation(o, o.dueDate, false);
      // Cadence projection — the detection calendar carries forward honestly.
      if (o.cadence === "monthly" || o.cadence === "weekly") {
        const step = o.cadence === "monthly" ? 30 : 7;
        let next = new Date(o.dueDate.getTime() + step * DAY);
        while (next.getTime() <= horizonEnd.getTime()) {
          projectObligation(o, next, true);
          next = new Date(next.getTime() + step * DAY);
        }
      }
    }

    // ── Inflows ─────────────────────────────────────────────────────────────
    const inByDay = new Map<string, Flow[]>();
    const pushIn = (d: Date, f: Flow) => {
      const key = ymd(d);
      const list = inByDay.get(key) ?? [];
      list.push(f);
      inByDay.set(key, list);
    };

    // 1) Funded invoices: reserve release at due date (exact stored amounts).
    const funded = await db.offer.findMany({
      where: { tenantId: t, state: "accepted" },
      include: { invoice: { include: { buyerLink: true } } },
    });
    const fundedInvoices = new Set<string>();
    for (const offer of funded) {
      fundedInvoices.add(offer.invoiceId);
      if (offer.invoice.fundingState === "settled") continue; // reserve already released
      const fee = offer.feeFils ?? 0;
      const net = offer.netProceedsFils ?? offer.principalFils;
      const reserve = offer.grossFils - net - fee;
      if (reserve <= 0) continue;
      pushIn(offer.invoice.dueDate, {
        label: `Reserve released — ${offer.invoice.externalRef}`,
        amountFils: reserve,
        kind: "reserve_release",
        sourceRef: offer.id,
      });
    }

    // 2) Escrow milestones in review: release at metAt + declared window.
    const contracts = await db.escrowContract.findMany({
      where: { tenantId: t, state: "active" },
      include: { milestones: { orderBy: { sequence: "asc" } } },
    });
    for (const c of contracts) {
      for (const m of c.milestones) {
        if (m.state !== "in_review" || !m.metAt) continue;
        const releaseAt = new Date(m.metAt.getTime() + m.reviewWindowDays * DAY);
        pushIn(releaseAt, {
          label: `Escrow — ${m.description}`,
          amountFils: m.amountFils,
          kind: "escrow_release",
          onCondition: true,
          sourceRef: m.id,
        });
      }
    }

    // 3) Unfunded invoices: expected buyer payment at issueDate + avgDaysToPay.
    const unfunded = await db.invoice.findMany({
      where: {
        tenantId: t,
        fundingState: { in: ["none", "quoted"] },
        verificationState: { in: ["verified", "deduped", "received", "parsed"] },
      },
      include: { buyerLink: true },
    });
    for (const inv of unfunded) {
      if (fundedInvoices.has(inv.id)) continue;
      const expectedAt = new Date(inv.issueDate.getTime() + inv.buyerLink.avgDaysToPay * DAY);
      if (expectedAt.getTime() < Date.now() || expectedAt.getTime() > horizonEnd.getTime()) continue;
      pushIn(expectedAt, {
        label: `Expected payment — ${inv.buyerLink.buyerName}`,
        amountFils: inv.grossFils,
        kind: "buyer_payment",
        estimate: true,
        sourceRef: inv.id,
      });
    }

    // ── Day-by-day simulation with the modelled autopilot ──────────────────
    // Invested sweeps the autopilot can recall (FIFO, whole sweeps, yield
    // accrued to the recall day included). Only when the autopilot is on.
    const swept = await db.sweep.findMany({
      where: { tenantId: t, state: "swept" },
      orderBy: { createdAt: "asc" },
    });
    const recallable = swept.map((s) => ({
      id: s.id,
      amountFils: s.amountFils,
      createdAt: s.createdAt,
      instrumentName: rulePack.treasury.instruments.find((i) => i.ref === s.instrumentRef)?.name ?? s.instrumentRef,
      perDay: yieldPerDay(s),
    }));

    const days: DayProjection[] = [];
    let balance = startFils;
    let minBalance = { date: ymd(new Date()), endFils: startFils, aboveFloor: startFils >= floorFils };
    const warnings: string[] = [];

    for (let i = 0; i < HORIZON_DAYS; i++) {
      const dayStart = new Date(Date.now() + i * DAY);
      dayStart.setUTCHours(0, 0, 0, 0);
      const key = ymd(dayStart);
      const startOfDay = balance;
      // Scheduled inflows for this day (reserve/escrow/buyer-payment events).
      const inflows: Flow[] = [...(inByDay.get(key) ?? [])];
      const outflows = outByDay.get(key) ?? [];

      // Would today's outflows breach the floor? Model the autopilot recall.
      const outTotal = outflows.reduce((a, f) => a + f.amountFils, 0);
      if (policy.autoPilotEnabled && startOfDay - outTotal < floorFils && recallable.length > 0) {
        const safety = applyPermyriad(startOfDay, policy.safetyMarginPermyriad);
        let need = floorFils + safety - (startOfDay - outTotal);
        while (need > 0 && recallable.length > 0) {
          const s = recallable[0];
          const daysInvested = Math.max(0, Math.floor((dayStart.getTime() - s.createdAt.getTime()) / DAY));
          const yieldAccrued = s.perDay * daysInvested;
          inflows.push({
            label: `Autopilot recall — ${s.instrumentName}`,
            amountFils: s.amountFils + yieldAccrued,
            kind: "autopilot_recall",
            sourceRef: s.id,
          });
          need -= s.amountFils + yieldAccrued;
          recallable.shift();
        }
      }

      const inTotal = inflows.reduce((a, f) => a + f.amountFils, 0);
      balance = startOfDay + inTotal - outTotal;

      if (balance < minBalance.endFils) {
        minBalance = { date: key, endFils: balance, aboveFloor: balance >= floorFils };
      }
      if (balance < floorFils) {
        warnings.push(key);
      }

      days.push({ date: key, startFils: startOfDay, inflows, outflows, endFils: balance });
    }

    // ── Honest advisory summary (informative, never decisive) ──────────────
    const totalIn = days.reduce((a, d) => a + d.inflows.reduce((x, f) => x + f.amountFils, 0), 0);
    const totalOut = days.reduce((a, d) => a + d.outflows.reduce((x, f) => x + f.amountFils, 0), 0);
    const uniqueBreachDays = [...new Set(warnings)];

    const data = {
      asOf: new Date().toISOString(),
      horizonDays: HORIZON_DAYS,
      startFils,
      floorFils,
      autoPilotEnabled: policy.autoPilotEnabled,
      days,
      minBalance,
      summary: {
        totalInFils: totalIn,
        totalOutFils: totalOut,
        projectedEndFils: balance,
        floorBreachDays: uniqueBreachDays,
      },
      advisory:
        uniqueBreachDays.length === 0
          ? "Projection only — the rule pack decides; this informs. Your balance stays above the floor across the next 90 days."
          : `Projection only — the rule pack decides; this informs. On ${uniqueBreachDays[0]} the projected balance would fall below your floor. Early payment on a confirmed invoice can close the gap.`,
    };

    return ok(data);
  } catch {
    return errors.internal();
  }
}
