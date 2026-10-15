// WATERLINE — POST /api/escrow/[id]/milestones/[mid]  (Task 2-b1; PRD 4.4).
// Milestone state machine: mark_delivered (pending → in_review, metAt=now),
// approve (→ released, custodian pays the SME wallet), dispute (→ disputed,
// only THIS milestone freezes — others continue), resolve (disputed →
// released with evidence). When every milestone is released the contract
// completes. Releases are ledger-posted idempotently per milestone.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey, type ApiErr } from "@/lib/api";
import { LEDGER_ACCOUNTS, postTransaction } from "@/lib/ledger";
import { shortId } from "@/lib/canonical";
import { ensureSeed } from "@/lib/seed";
import type { NextResponse } from "next/server";
import type { EscrowContract, Milestone } from "@prisma/client";

type Action = "mark_delivered" | "approve" | "dispute" | "resolve";
const ACTIONS: Action[] = ["mark_delivered", "approve", "dispute", "resolve"];
const APPROVED_BY = "EFG-AP portal";

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

interface ActionBody {
  action?: unknown;
  evidence?: unknown;
}

/** Status guard for the escrow engine: M4 read-only blocks writes; the
 * escrow / global kill switch pauses milestone instructions. Releases
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

/** Post the custodian release: custodian debit → SME wallet credit.
 * Idempotent per milestone — a repeated release event is a no-op. */
async function postRelease(milestone: Milestone, contract: EscrowContract, evidence: string | null): Promise<void> {
  const baseEventId = `escrow.release:${milestone.id}`;
  if (await txnPosted(contract.tenantId, baseEventId)) return;
  try {
    await postTransaction({
      tenantId: contract.tenantId,
      txnId: `txn_${shortId("e")}`,
      sourceEventId: baseEventId,
      valueDate: new Date(),
      entries: [
        { accountCode: LEDGER_ACCOUNTS.ESCROW_CUSTODIAN, direction: "debit", amountFils: milestone.amountFils, memo: `Milestone ${milestone.sequence} release instructed — ${milestone.description}` },
        { accountCode: LEDGER_ACCOUNTS.SME_WALLET(contract.tenantId), direction: "credit", amountFils: milestone.amountFils, memo: `Milestone ${milestone.sequence} — ${milestone.description}` },
      ],
      eventType: "escrow.released",
      eventSubjectRef: milestone.id,
      eventPayload: {
        amountFils: milestone.amountFils,
        milestone: milestone.description,
        milestoneId: milestone.id,
        contractId: contract.id,
        approvedBy: APPROVED_BY,
        evidence: evidence ?? milestone.evidenceRef ?? null,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // duplicate release → already posted
  }
}

/** Complete the contract when every milestone is released. */
async function completeIfDone(contract: EscrowContract): Promise<EscrowContract> {
  const milestones = await db.milestone.findMany({ where: { contractId: contract.id } });
  if (milestones.length > 0 && milestones.every((m) => m.state === "released") && contract.state !== "completed") {
    const updated = await db.escrowContract.update({
      where: { id: contract.id },
      data: { state: "completed", completedAt: new Date() },
    });
    await db.appEvent.create({
      data: {
        tenantId: contract.tenantId,
        type: "escrow.completed",
        subjectRef: contract.id,
        payloadJson: JSON.stringify({
          contractId: contract.id,
          totalFils: contract.totalFils,
          description: contract.description,
          buyerName: contract.buyerName,
        }),
      },
    });
    return updated;
  }
  return contract;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; mid: string }> },
): Promise<NextResponse> {
  try {
    await ensureSeed();
    const { id, mid } = await ctx.params;

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const contract = await db.escrowContract.findUnique({ where: { id } });
    if (!contract || contract.tenantId !== DEMO_TENANT) return errors.notFound("Escrow contract");
    const milestone = await db.milestone.findFirst({ where: { id: mid, contractId: contract.id } });
    if (!milestone) return errors.notFound("Milestone");

    const body = await readJson<ActionBody>(req);
    const action = body?.action;
    if (typeof action !== "string" || !ACTIONS.includes(action as Action)) {
      return errors.invalidRequest(`action must be one of ${ACTIONS.join(", ")}.`);
    }
    const rawEvidence = body?.evidence;
    const evidence = typeof rawEvidence === "string" && rawEvidence.trim().length > 0 ? rawEvidence.trim().slice(0, 500) : null;

    const guard = await escrowGuard();
    if (guard) return guard;

    const now = new Date();

    switch (action as Action) {
      case "mark_delivered": {
        if (milestone.state === "in_review") {
          // Idempotent replay of the delivery declaration.
          return ok({ contract: serializeContract(contract, await db.milestone.findMany({ where: { contractId: contract.id } })), milestone: serializeMilestone(milestone), replayed: true });
        }
        if (milestone.state !== "pending") {
          return errors.invalidRequest(`mark_delivered is only valid on a pending milestone (state=${milestone.state}).`);
        }
        const delivered = await db.milestone.update({
          where: { id: milestone.id },
          data: { state: "in_review", metAt: now, evidenceRef: evidence ?? milestone.evidenceRef },
        });
        await db.appEvent.create({
          data: {
            tenantId: contract.tenantId,
            type: "escrow.condition_met",
            subjectRef: milestone.id,
            payloadJson: JSON.stringify({
              milestoneId: milestone.id,
              milestone: milestone.description,
              evidence: evidence ?? milestone.evidenceRef ?? null,
              reviewWindowDays: milestone.reviewWindowDays,
              contractId: contract.id,
            }),
          },
        });
        return ok({
          contract: serializeContract(contract, await db.milestone.findMany({ where: { contractId: contract.id } })),
          milestone: serializeMilestone(delivered),
          replayed: false,
        });
      }

      case "approve": {
        if (milestone.state === "released") {
          // Idempotent replay — self-heal the release txn if a crash skipped it.
          await postRelease(milestone, contract, evidence);
          const completed = await completeIfDone(contract);
          return ok({ contract: serializeContract(completed, await db.milestone.findMany({ where: { contractId: contract.id } })), milestone: serializeMilestone(milestone), alreadyReleased: true, replayed: true });
        }
        if (milestone.state === "disputed") {
          return errors.invalidRequest("This milestone is disputed — resolve it with evidence instead of approving.");
        }
        if (!["pending", "in_review", "met"].includes(milestone.state)) {
          return errors.invalidRequest(`approve is not valid from state=${milestone.state}.`);
        }
        const released = await db.milestone.update({
          where: { id: milestone.id },
          data: { state: "released", approvedBy: APPROVED_BY, approvedAt: now, releasedAt: now, metAt: milestone.metAt ?? now },
        });
        await postRelease(milestone, contract, evidence);
        const completed = await completeIfDone(contract);
        return ok({
          contract: serializeContract(completed, await db.milestone.findMany({ where: { contractId: contract.id } })),
          milestone: serializeMilestone(released),
          replayed: false,
        });
      }

      case "dispute": {
        if (milestone.state === "disputed") {
          return ok({ contract: serializeContract(contract, await db.milestone.findMany({ where: { contractId: contract.id } })), milestone: serializeMilestone(milestone), replayed: true });
        }
        if (milestone.state === "released") {
          return errors.invalidRequest("This milestone is already released — dispute is no longer possible.");
        }
        const disputed = await db.milestone.update({
          where: { id: milestone.id },
          data: { state: "disputed", evidenceRef: evidence ?? milestone.evidenceRef },
        });
        // Only THIS milestone freezes; undisputed milestones continue (PRD 4.4).
        await db.appEvent.create({
          data: {
            tenantId: contract.tenantId,
            type: "escrow.disputed",
            subjectRef: milestone.id,
            payloadJson: JSON.stringify({
              milestoneId: milestone.id,
              milestone: milestone.description,
              amountFils: milestone.amountFils,
              reason: evidence,
              contractId: contract.id,
            }),
          },
        });
        return ok({
          contract: serializeContract(contract, await db.milestone.findMany({ where: { contractId: contract.id } })),
          milestone: serializeMilestone(disputed),
          replayed: false,
        });
      }

      case "resolve": {
        if (milestone.state === "released") {
          // Idempotent replay — self-heal the release txn if a crash skipped it.
          await postRelease(milestone, contract, evidence);
          const completed = await completeIfDone(contract);
          return ok({ contract: serializeContract(completed, await db.milestone.findMany({ where: { contractId: contract.id } })), milestone: serializeMilestone(milestone), alreadyReleased: true, replayed: true });
        }
        if (milestone.state !== "disputed") {
          return errors.invalidRequest(`resolve is only valid on a disputed milestone (state=${milestone.state}).`);
        }
        if (!evidence) {
          return errors.invalidRequest("resolve requires an evidence note — resolutions are auditable (PRD 4.4).");
        }
        const resolved = await db.milestone.update({
          where: { id: milestone.id },
          data: { state: "released", approvedBy: APPROVED_BY, approvedAt: now, releasedAt: now, evidenceRef: evidence },
        });
        await postRelease(milestone, contract, evidence);
        const completed = await completeIfDone(contract);
        return ok({
          contract: serializeContract(completed, await db.milestone.findMany({ where: { contractId: contract.id } })),
          milestone: serializeMilestone(resolved),
          replayed: false,
        });
      }
    }
  } catch (e) {
    console.error("[api/escrow/[id]/milestones/[mid]]", e);
    return errors.internal();
  }
}
