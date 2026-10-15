// WATERLINE — POST /api/treasury/sweep  (Task 2-b2; PRD 4.5 + 3.4).
// Move surplus cash into a rule-pack instrument. The append-only decision
// record is written BEFORE any outcome is returned, with the canonical input
// hash and pack version, so every sweep is replayable forever. The floor is
// an absolute hard stop inside the pure rule engine — a rejected sweep is
// HTTP 200 with the plain-language reason (a neutral outcome card, never an
// error). Idempotent: the Idempotency-Key derives both the decision id and
// the sweep id, so a retry replays the original outcome and can never move
// the money twice (PRD 6.2).

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey } from "@/lib/api";
import { accountBalance, LEDGER_ACCOUNTS, postTransaction } from "@/lib/ledger";
import { canonicalJson, hashSnapshot, sha256 } from "@/lib/canonical";
import { rulePack } from "@/lib/rulepack";
import { evaluateSweep, type FeatureSnapshot, type SweepDecision } from "@/lib/ruleengine";
import { ensureSeed } from "@/lib/seed";
import type { Decision, Sweep } from "@prisma/client";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

interface SweepBody {
  instrumentRef?: unknown;
  amountFils?: unknown;
}

interface DecisionView {
  id: string;
  decisionType: "treasury_sweep";
  subjectType: "treasury";
  subjectRef: string;
  inputHash: string;
  rulepackVersion: string;
  outcome: "approved" | "rejected";
  sweepableFils: number;
  reasonCode: string;
  reasonText: string;
  bindingRule: string;
  checks: { rule: string; passed: boolean; detail: string }[];
  evaluatedAt: string;
}

function serializeSweep(s: Sweep) {
  const instrument = rulePack.treasury.instruments.find((i) => i.ref === s.instrumentRef);
  return {
    id: s.id,
    direction: s.direction,
    amountFils: s.amountFils,
    instrumentRef: s.instrumentRef,
    instrumentName: instrument?.name ?? s.instrumentRef,
    yieldMbsdPermyriad: instrument?.yieldMbsdPermyriad ?? null,
    floorAtDecisionFils: s.floorAtDecisionFils,
    state: s.state,
    yieldFils: s.yieldFils,
    createdAt: s.createdAt.toISOString(),
    recalledAt: s.recalledAt ? s.recalledAt.toISOString() : null,
  };
}

/** The decision view is rebuilt deterministically by re-evaluating the stored
 *  feature snapshot against the same pack — the replay discipline of PRD 9.3,
 *  used here so a retried request returns the ORIGINAL outcome. */
function decisionView(row: Decision, result: SweepDecision): DecisionView {
  return {
    id: row.id,
    decisionType: "treasury_sweep",
    subjectType: "treasury",
    subjectRef: row.subjectRef,
    inputHash: row.inputHash,
    rulepackVersion: row.rulepackVersion,
    outcome: result.outcome,
    sweepableFils: result.sweepableFils,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    bindingRule: row.bindingRule,
    checks: result.checks,
    evaluatedAt: row.evaluatedAt.toISOString(),
  };
}

function storedResult(row: Decision): SweepDecision {
  let snapshot: FeatureSnapshot | null = null;
  try {
    snapshot = JSON.parse(row.featureSnapshot) as FeatureSnapshot;
  } catch {
    snapshot = null;
  }
  if (snapshot) {
    const replay = evaluateSweep(snapshot, rulePack);
    // The row is the record of truth; the re-evaluation supplies the checks.
    if (replay.reasonCode === row.reasonCode && replay.outcome === row.outcome) {
      return replay;
    }
  }
  return {
    outcome: row.outcome === "rejected" ? "rejected" : "approved",
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    sweepableFils: row.limitFils ?? 0,
    bindingRule: row.bindingRule,
    checks: [],
  };
}

/** Kill-switch guard for the treasury engine (PRD 8.1): the treasury or the
 *  global switch pauses sweeps (423). M4 is read-only and blocks all writes
 *  (503, contract rule 4). M3 suspends FUNDING — the SME's own money keeps
 *  working, so sweeps are allowed in M3. */
async function treasuryGuard(): Promise<Response | null> {
  const st = await db.statusState.findUnique({ where: { id: "singleton" } });
  if (!st) return null;
  let switches: Record<string, unknown> = {};
  try {
    const v = JSON.parse(st.killSwitchesJson);
    if (v && typeof v === "object" && !Array.isArray(v)) switches = v as Record<string, unknown>;
  } catch {
    switches = {};
  }
  if (switches.treasury === true) {
    return errors.killSwitchActive("The treasury engine is switched off by an operator — sweeps are paused, your floor still holds. Poll /api/status.");
  }
  if (switches.global === true) {
    return errors.killSwitchActive("The global kill switch is engaged — treasury moves are paused. Poll /api/status.");
  }
  if (st.mode === "M4") return errors.degraded("M4");
  return null;
}

/** The SME's du Pay wallet is a credit-normal account: the derived ledger
 *  balance is negative, so the wallet balance is its negation. */
async function treasuryWalletFils(): Promise<number> {
  const balance = await accountBalance(DEMO_TENANT, LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT));
  return -balance;
}

/** THE treasury feature snapshot — identical to the one built by
 *  GET /api/treasury (asOfDate today, entity from the ledger's SME entity,
 *  invoice/buyer null, portfolio exposure 0, treasury features live). The
 *  decision trail and the projection must never disagree. */
async function buildTreasurySnapshot(): Promise<FeatureSnapshot | null> {
  const [entity, policy] = await Promise.all([
    db.entity.findFirst({ where: { tenantId: DEMO_TENANT, role: "sme" } }),
    db.treasuryPolicy.findUnique({ where: { tenantId: DEMO_TENANT } }),
  ]);
  if (!entity || !policy) return null;

  const walletFils = await treasuryWalletFils();
  const horizonEnd = new Date(Date.now() + policy.horizonDays * DAY);
  const inHorizon = await db.obligation.findMany({
    where: { tenantId: DEMO_TENANT, active: true, dueDate: { lte: horizonEnd } },
    select: { amountFils: true },
  });

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    decisionType: "treasury_sweep",
    entity: {
      kybState: entity.kybState,
      licenceDaysRemaining: Math.ceil((entity.licenceExpiry.getTime() - Date.now()) / DAY),
      tenureMonths: entity.tenureMonths,
      sectorCode: entity.sectorCode,
      billingBand: entity.billingBand,
    },
    invoice: null,
    buyer: null,
    portfolio: { bookExposureFils: 0 },
    treasury: {
      balanceFils: walletFils,
      floorFils: policy.floorFils,
      obligationsFils: inHorizon.reduce((acc, o) => acc + o.amountFils, 0),
      safetyMarginPermyriad: policy.safetyMarginPermyriad,
    },
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const guard = await treasuryGuard();
    if (guard) return guard;

    const body = await readJson<SweepBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    const instrumentRef = body.instrumentRef;
    if (typeof instrumentRef !== "string" || !rulePack.treasury.instruments.some((i) => i.ref === instrumentRef)) {
      return errors.invalidRequest(
        `instrumentRef must be one of ${rulePack.treasury.instruments.map((i) => i.ref).join(", ")} (rule-pack data — reviewable and changeable without a deployment).`,
      );
    }
    if (body.amountFils !== undefined && (typeof body.amountFils !== "number" || !Number.isInteger(body.amountFils) || body.amountFils <= 0)) {
      return errors.invalidRequest("amountFils, when given, must be a positive integer in fils.");
    }

    // Deterministic ids from the idempotency key: a retry replays the original
    // decision + sweep instead of creating a second money movement.
    const digest = sha256(`treasury.sweep:${idemKey}`).slice(7, 23);
    const decisionId = `dec_sweep_${digest.slice(0, 10)}`;
    const sweepId = `sweep_${digest.slice(10)}`;

    // ── Idempotent replay ──
    const priorDecision = await db.decision.findUnique({ where: { id: decisionId } });
    if (priorDecision && priorDecision.tenantId === DEMO_TENANT) {
      if (priorDecision.outcome === "rejected") {
        return ok({ decision: decisionView(priorDecision, storedResult(priorDecision)), sweep: null, replayed: true });
      }
      const priorSweep = await db.sweep.findUnique({ where: { id: sweepId } });
      if (priorSweep && priorSweep.tenantId === DEMO_TENANT) {
        const instrument = rulePack.treasury.instruments.find((i) => i.ref === priorSweep.instrumentRef);
        // Self-heal: a crash between sweep creation and the wallet posting is
        // recovered here — the posting is idempotent on (tenant, source event).
        try {
          await postTransaction({
            tenantId: DEMO_TENANT,
            txnId: `txn_${sweepId.slice(6)}`,
            sourceEventId: `treasury.sweep:${priorSweep.id}`,
            valueDate: priorSweep.createdAt,
            entries: [
              { accountCode: LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT), direction: "debit", amountFils: priorSweep.amountFils, memo: `Sweep to ${instrument?.name ?? priorSweep.instrumentRef}` },
              { accountCode: LEDGER_ACCOUNTS.INSTRUMENT_HOLDING(priorSweep.instrumentRef), direction: "credit", amountFils: priorSweep.amountFils, memo: `Instrument holding — ${instrument?.name ?? priorSweep.instrumentRef}` },
            ],
            eventType: "sweep.executed",
            eventSubjectRef: priorSweep.id,
            eventPayload: { amountFils: priorSweep.amountFils, instrumentRef: priorSweep.instrumentRef, instrumentName: instrument?.name ?? priorSweep.instrumentRef, floorFils: priorSweep.floorAtDecisionFils },
          });
        } catch (e) {
          if ((e as { code?: string }).code !== "P2002") throw e;
        }
        return ok({ decision: decisionView(priorDecision, storedResult(priorDecision)), sweep: serializeSweep(priorSweep), replayed: true });
      }
      // Approved decision recorded but the sweep row never landed (crash):
      // finish the original intent — no second decision row is written.
      return completeApprovedSweep(priorDecision, instrumentRef, body.amountFils, sweepId, true);
    }

    // ── Fresh evaluation: wallet derived NOW, same snapshot as route 1 ──
    const snapshot = await buildTreasurySnapshot();
    if (!snapshot) return errors.internal();
    const floorFils = snapshot.treasury?.floorFils ?? 0;
    const result = evaluateSweep(snapshot, rulePack);

    // Append-only decision record BEFORE the outcome is returned (PRD 3.4).
    const decisionRow = await db.decision.create({
      data: {
        id: decisionId,
        tenantId: DEMO_TENANT,
        subjectRef: "treasury",
        subjectType: "treasury",
        decisionType: "treasury_sweep",
        inputHash: hashSnapshot(snapshot),
        rulepackVersion: rulePack.version,
        featureSnapshot: canonicalJson(snapshot),
        outcome: result.outcome,
        limitFils: result.sweepableFils,
        bindingRule: result.bindingRule,
        reasonCode: result.reasonCode,
        reasonText: result.reasonText,
        actor: "system",
        shadow: false,
      },
    });

    if (result.outcome !== "approved") {
      // Neutral outcome card: HTTP 200, the SME sees the plain-language reason.
      return ok({ decision: decisionView(decisionRow, result), sweep: null, replayed: false });
    }

    return completeApprovedSweep(decisionRow, instrumentRef, body.amountFils, sweepId, false);
  } catch {
    return errors.internal();
  }
}

/** Create the sweep + post the wallet→instrument transaction for an APPROVED
 *  decision. Amount: explicit or the full sweepable headroom; may never
 *  exceed it (the floor and the obligation calendar are absolute). */
async function completeApprovedSweep(
  decisionRow: Decision,
  instrumentRef: string,
  requestedAmountFils: number | undefined,
  sweepId: string,
  replayed: boolean,
): Promise<Response> {
  const recordedSweepableFils = decisionRow.limitFils ?? 0;

  let amount = recordedSweepableFils;
  if (typeof requestedAmountFils === "number") {
    if (requestedAmountFils > recordedSweepableFils) {
      return errors.invalidRequest(
        `amountFils exceeds the sweepable headroom (asked ${requestedAmountFils} fils, sweepable ${recordedSweepableFils} fils — the floor and the obligation calendar are absolute).`,
      );
    }
    if (requestedAmountFils < rulePack.treasury.minSweepFils) {
      return errors.invalidRequest(`amountFils is below the rule pack's minimum sweep size of ${rulePack.treasury.minSweepFils} fils.`);
    }
    amount = requestedAmountFils;
  }

  const instrument = rulePack.treasury.instruments.find((i) => i.ref === instrumentRef)!;

  const sweep = await db.sweep.create({
    data: {
      id: sweepId,
      tenantId: DEMO_TENANT,
      direction: "out",
      amountFils: amount,
      instrumentRef,
      floorAtDecisionFils: decisionRow.featureSnapshot
        ? parseFloorFils(decisionRow.featureSnapshot)
        : 0,
      state: "swept",
      reasonCode: decisionRow.reasonCode,
    },
  });

  // Wallet → instrument holding. Idempotent on (tenant, source_event_id); a
  // P2002 from the unique constraint means a racing retry already posted it.
  try {
    await postTransaction({
      tenantId: DEMO_TENANT,
      txnId: `txn_${sweepId.slice(6)}`,
      sourceEventId: `treasury.sweep:${sweep.id}`,
      valueDate: new Date(),
      entries: [
        { accountCode: LEDGER_ACCOUNTS.SME_WALLET(DEMO_TENANT), direction: "debit", amountFils: amount, memo: `Sweep to ${instrument.name}` },
        { accountCode: LEDGER_ACCOUNTS.INSTRUMENT_HOLDING(instrumentRef), direction: "credit", amountFils: amount, memo: `Instrument holding — ${instrument.name}` },
      ],
      eventType: "sweep.executed",
      eventSubjectRef: sweep.id,
      eventPayload: { amountFils: amount, instrumentRef, instrumentName: instrument.name, floorFils: sweep.floorAtDecisionFils },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
  }

  const view = decisionView(decisionRow, storedResult(decisionRow));
  return ok({ decision: view, sweep: serializeSweep(sweep), replayed });
}

/** Floor recorded in the decision's feature snapshot (canonical JSON). */
function parseFloorFils(featureSnapshot: string): number {
  try {
    const parsed = JSON.parse(featureSnapshot) as FeatureSnapshot;
    const floor = parsed.treasury?.floorFils;
    return typeof floor === "number" ? floor : 0;
  } catch {
    return 0;
  }
}
