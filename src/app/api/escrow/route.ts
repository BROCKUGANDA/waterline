// WATERLINE — /api/escrow  (Task 2-b1; PRD 4.4).
// GET: contracts with milestones ordered by sequence + released/pending totals.
// POST: award a new milestone contract. Funds are held at a licensed custodian
// bank under a programmable mandate — WATERLINE never holds client money. The
// buyer contribution is posted to the custodian ledger account in the same
// logical event, so the contract can never exist unfunded.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey, type ApiErr } from "@/lib/api";
import { LEDGER_ACCOUNTS, postTransaction } from "@/lib/ledger";
import { sha256 } from "@/lib/canonical";
import { ensureSeed } from "@/lib/seed";
import type { NextResponse } from "next/server";
import type { EscrowContract, Milestone } from "@prisma/client";

const CONDITION_TYPES = ["buyer_approval", "document_review", "time_release"] as const;

export const dynamic = "force-dynamic";

/** Ledger rows store `sourceEventId:accountCode`; presence of a base event is
 * checked by prefix so replays stay read-only. The DB's (tenant,
 * source_event_id) unique constraint remains the real guard (PRD 6.2). */
async function txnPosted(tenantId: string, baseEventId: string): Promise<boolean> {
  const existing = await db.ledgerEntry.findFirst({
    where: { tenantId, sourceEventId: { startsWith: `${baseEventId}:` } },
    select: { id: true },
  });
  return existing !== null;
}

/** Post a txn unless its base event is already on the ledger; a P2002 from
 * the unique constraint is treated as already-posted, never an error. */
async function postOnce(opts: Parameters<typeof postTransaction>[0]): Promise<void> {
  if (await txnPosted(opts.tenantId, opts.sourceEventId)) return;
  try {
    await postTransaction(opts);
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
}

interface MilestoneInput {
  description?: unknown;
  amountFils?: unknown;
  conditionType?: unknown;
  reviewWindowDays?: unknown;
}

interface EscrowBody {
  buyerName?: unknown;
  description?: unknown;
  totalFils?: unknown;
  milestones?: unknown;
}

/** Status guard for the escrow engine: M4 read-only blocks writes; the
 * escrow / global kill switch pauses milestone instructions. Escrow releases
 * continue in M3 (funding suspension) by design. */
async function escrowGuard(): Promise<NextResponse<ApiErr> | null> {
  const st = await db.statusState.findUnique({ where: { id: "singleton" } });
  if (!st) return null;
  if (st.mode === "M4") return errors.degraded("M4");
  const switches = safeSwitches(st.killSwitchesJson);
  if (switches.global) {
    return errors.killSwitchActive("The global kill switch is engaged — escrow instructions are paused. Poll /api/status.");
  }
  if (switches.escrow) {
    return errors.killSwitchActive("The escrow engine is switched off — milestone releases are paused at the custodian. Poll /api/status.");
  }
  return null;
}

function safeSwitches(json: string): Record<string, boolean> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function serializeMilestone(m: Milestone) {
  return {
    id: m.id,
    contractId: m.contractId,
    sequence: m.sequence,
    description: m.description,
    amountFils: m.amountFils,
    conditionType: m.conditionType,
    reviewWindowDays: m.reviewWindowDays,
    evidenceRef: m.evidenceRef,
    approvedBy: m.approvedBy,
    approvedAt: m.approvedAt ? m.approvedAt.toISOString() : null,
    metAt: m.metAt ? m.metAt.toISOString() : null,
    releasedAt: m.releasedAt ? m.releasedAt.toISOString() : null,
    state: m.state,
  };
}

function serializeContract(c: EscrowContract, milestones: Milestone[]) {
  const releasedFils = milestones
    .filter((m) => m.state === "released")
    .reduce((acc, m) => acc + m.amountFils, 0);
  return {
    id: c.id,
    buyerName: c.buyerName,
    custodianRef: c.custodianRef,
    description: c.description,
    totalFils: c.totalFils,
    state: c.state,
    createdAt: c.createdAt.toISOString(),
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    releasedFils,
    pendingFils: c.totalFils - releasedFils,
    milestones: milestones
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(serializeMilestone),
  };
}

export async function GET(): Promise<Response> {
  try {
    await ensureSeed();
    const contracts = await db.escrowContract.findMany({
      where: { tenantId: DEMO_TENANT },
      include: { milestones: true },
      orderBy: { createdAt: "desc" },
    });
    const views = contracts.map((c) => serializeContract(c, c.milestones));
    const totals = views.reduce(
      (acc, v) => ({
        releasedFils: acc.releasedFils + v.releasedFils,
        pendingFils: acc.pendingFils + v.pendingFils,
      }),
      { releasedFils: 0, pendingFils: 0 },
    );
    return ok({ contracts: views, totals: { ...totals, contractCount: views.length } });
  } catch (e) {
    console.error("[api/escrow GET]", e);
    return errors.internal();
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    // Deterministic contract id from the idempotency key: a retry after an
    // ambiguous timeout replays the original contract, never a second award.
    const contractId = `ctr_${sha256(`escrow:${idemKey}`).slice(7, 19)}`;
    const existing = await db.escrowContract.findUnique({
      where: { id: contractId },
      include: { milestones: { orderBy: { sequence: "asc" } } },
    });
    if (existing && existing.tenantId === DEMO_TENANT) {
      // Self-heal: a crash between contract creation and the award posting
      // recovers here — the award txn is idempotent by source event.
      if (!(await txnPosted(DEMO_TENANT, `escrow.awarded:${existing.id}`))) {
        await postOnce({
          tenantId: DEMO_TENANT,
          txnId: `txn_${existing.id.slice(4)}`,
          sourceEventId: `escrow.awarded:${existing.id}`,
          valueDate: existing.createdAt,
          entries: [
            { accountCode: LEDGER_ACCOUNTS.BUYER_CONTRIBUTION, direction: "debit", amountFils: existing.totalFils, memo: `${existing.buyerName} funds the milestone contract` },
            { accountCode: LEDGER_ACCOUNTS.ESCROW_CUSTODIAN, direction: "credit", amountFils: existing.totalFils, memo: `Held at custodian under programmable mandate ${existing.custodianRef}` },
          ],
          eventType: "escrow.awarded",
          eventSubjectRef: existing.id,
          eventPayload: { totalFils: existing.totalFils, buyerName: existing.buyerName, milestoneCount: existing.milestones.length, custodianRef: existing.custodianRef },
        });
      }
      return ok({ contract: serializeContract(existing, existing.milestones), replayed: true });
    }

    const body = await readJson<EscrowBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    const buyerName = body.buyerName;
    if (typeof buyerName !== "string" || buyerName.trim().length < 2 || buyerName.trim().length > 200) {
      return errors.invalidRequest("buyerName must be a string of 2–200 characters.");
    }
    const description = body.description;
    if (typeof description !== "string" || description.trim().length < 3 || description.trim().length > 500) {
      return errors.invalidRequest("description must be a string of 3–500 characters.");
    }
    const totalFils = body.totalFils;
    if (typeof totalFils !== "number" || !Number.isInteger(totalFils) || totalFils <= 0) {
      return errors.invalidRequest("totalFils must be a positive integer amount in fils.");
    }
    const rawMilestones = body.milestones;
    if (!Array.isArray(rawMilestones) || rawMilestones.length === 0 || rawMilestones.length > 20) {
      return errors.invalidRequest("milestones must be a non-empty array (max 20) of milestone objects.");
    }

    let sum = 0;
    const parsed: { description: string; amountFils: number; conditionType: string; reviewWindowDays: number }[] = [];
    for (const raw of rawMilestones as MilestoneInput[]) {
      if (!raw || typeof raw !== "object") {
        return errors.invalidRequest("each milestone must be an object with description, amountFils, conditionType, reviewWindowDays.");
      }
      const desc = raw.description;
      if (typeof desc !== "string" || desc.trim().length < 3 || desc.trim().length > 200) {
        return errors.invalidRequest("each milestone description must be a string of 3–200 characters.");
      }
      const amount = raw.amountFils;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
        return errors.invalidRequest("each milestone amountFils must be a positive integer in fils.");
      }
      const condition = raw.conditionType;
      if (typeof condition !== "string" || !CONDITION_TYPES.includes(condition as (typeof CONDITION_TYPES)[number])) {
        return errors.invalidRequest(`conditionType is required on every milestone and must be one of ${CONDITION_TYPES.join(", ")}.`);
      }
      const window = raw.reviewWindowDays ?? 3;
      if (typeof window !== "number" || !Number.isInteger(window) || window < 0 || window > 30) {
        return errors.invalidRequest("reviewWindowDays must be an integer between 0 and 30.");
      }
      sum += amount;
      parsed.push({ description: desc.trim(), amountFils: amount, conditionType: condition, reviewWindowDays: window });
    }
    if (sum !== totalFils) {
      return errors.invalidRequest(
        `Milestone amounts must sum to the contract total (sum=${sum} fils vs total=${totalFils} fils — ${Math.abs(totalFils - sum)} fils ${totalFils - sum > 0 ? "unallocated" : "over-allocated"}).`,
      );
    }

    // Status guard AFTER payload validation: a malformed request is a 400
    // regardless of switch state; the guard still precedes every write.
    const guard = await escrowGuard();
    if (guard) return guard;

    const entity = await db.entity.findFirst({ where: { tenantId: DEMO_TENANT, role: "sme" } });
    if (!entity) return errors.internal();

    // ── Award: contract + milestones + custodian funding in one logical event.
    const custodianRef = `ADCB-ESC-${10000 + Math.floor(Math.random() * 90000)}`;
    const contract = await db.escrowContract.create({
      data: {
        id: contractId,
        tenantId: DEMO_TENANT,
        supplierEntityId: entity.id,
        buyerName: buyerName.trim(),
        buyerEntityName: buyerName.trim(),
        custodianRef,
        description: description.trim(),
        totalFils,
        state: "active",
        milestones: {
          create: parsed.map((m, i) => ({
            sequence: i + 1,
            description: m.description,
            amountFils: m.amountFils,
            conditionType: m.conditionType,
            reviewWindowDays: m.reviewWindowDays,
            state: "pending",
          })),
        },
      },
      include: { milestones: { orderBy: { sequence: "asc" } } },
    });

    // Buyer funds the contract at the custodian (PRD 4.4 — WATERLINE never
    // holds client money). Idempotent on (tenant, source_event_id).
    await postOnce({
      tenantId: DEMO_TENANT,
      txnId: `txn_${contractId.slice(4)}`,
      sourceEventId: `escrow.awarded:${contract.id}`,
      valueDate: new Date(),
      entries: [
        { accountCode: LEDGER_ACCOUNTS.BUYER_CONTRIBUTION, direction: "debit", amountFils: totalFils, memo: `${buyerName.trim()} funds the milestone contract` },
        { accountCode: LEDGER_ACCOUNTS.ESCROW_CUSTODIAN, direction: "credit", amountFils: totalFils, memo: `Held at custodian under programmable mandate ${custodianRef}` },
      ],
      eventType: "escrow.awarded",
      eventSubjectRef: contract.id,
      eventPayload: { totalFils, buyerName: buyerName.trim(), milestoneCount: parsed.length, custodianRef },
    });

    return ok({ contract: serializeContract(contract, contract.milestones), replayed: false });
  } catch (e) {
    console.error("[api/escrow POST]", e);
    return errors.internal();
  }
}
