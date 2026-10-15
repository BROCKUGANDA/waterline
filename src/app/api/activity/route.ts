// WATERLINE — GET /api/activity?limit=50  (Task 2-b2; PRD 4.4/11).
// The activity feed: AppEvents newest-first with title/detail copy rendered
// SERVER-SIDE — the client never formats money and never invents verbs.
// Money is formatted from integer fils via the shared money lib; subject
// references are enriched with human labels (invoice numbers, milestone
// descriptions, contract descriptions). Payloads are parsed defensively:
// a corrupt or missing field never breaks the feed.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok } from "@/lib/api";
import { formatAed } from "@/lib/money";
import { ensureSeed } from "@/lib/seed";
import type { AppEvent, EscrowContract } from "@prisma/client";

export const dynamic = "force-dynamic";

interface RenderedEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  subjectRef: string | null;
  occurredAt: string;
  /** Structured pieces for client-side localization (AR mirror). The English
   * title/detail above remain the canonical server rendering; params carries
   * the same facts so the client can render an Arabic mirror without ever
   * re-deriving money (amounts stay integer fils until formatted). */
  params: {
    ref: string | null;
    milestone: string | null;
    description: string | null;
    payload: Record<string, unknown>;
  };
}

interface Enrichment {
  invoiceRefs: Map<string, string>;
  milestoneDesc: Map<string, string>;
  contracts: Map<string, EscrowContract>;
}

const VIA_LABELS: Record<string, string> = {
  einvoice: "e-invoice registry",
  buyer_api: "buyer API",
  buyer_portal: "buyer portal",
  du_ap: "du AP file",
};

function renderEvent(ev: AppEvent, ctx: Enrichment): RenderedEvent {
  let p: Record<string, unknown> = {};
  try {
    const v = JSON.parse(ev.payloadJson);
    if (v && typeof v === "object" && !Array.isArray(v)) p = v as Record<string, unknown>;
  } catch {
    // A corrupt payload still renders — the feed never breaks on data.
  }
  const num = (k: string): number | null =>
    typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null;
  const aed = (k: string): string | null => {
    const v = num(k);
    return v === null ? null : formatAed(v);
  };
  const str = (k: string): string | null => (typeof p[k] === "string" ? (p[k] as string) : null);
  const ref = (): string => {
    const s = ev.subjectRef ?? "";
    if (s.startsWith("inv_")) return ctx.invoiceRefs.get(s) ?? s;
    return str("ref") ?? s;
  };
  const milestone = (): string =>
    ctx.milestoneDesc.get(ev.subjectRef ?? "") ?? str("milestone") ?? "Milestone";

  let title = "";
  let detail = "";

  switch (ev.type) {
    case "onboarding.completed":
      title = "Onboarding completed";
      detail = "Indicative limit derived from du billing history — before any invoice was uploaded.";
      break;
    case "invoice.submitted":
      title = "Invoice submitted";
      detail = `${ref()} uploaded for verification.`;
      break;
    case "invoice.verified":
      title = "Invoice confirmed";
      detail = `${ref()} confirmed via ${VIA_LABELS[str("via") ?? ""] ?? "buyer confirmation"}.`;
      break;
    case "invoice.disputed":
      title = "Invoice disputed";
      detail = `${ref()} disputed by the buyer — funding paused pending resolution.`;
      break;
    case "invoice.settled":
      title = "Invoice settled";
      detail = `${ref()} settled — buyer paid ${aed("grossFils") ?? "the invoice in full"}.`;
      break;
    case "decision.recorded": {
      title = "Quote computed";
      const limit = num("limitFils");
      detail = `${ref()} — ${str("reasonText") ?? (limit !== null ? `${formatAed(limit)} at the rule pack's deterministic price` : `outcome ${str("outcome") ?? "recorded"}`)}.`;
      break;
    }
    case "decision.replayed":
      title = "Decision replayed";
      detail = p["matchesOriginal"] === false
        ? "Replay DIVERGED from the original outcome — this fails the build and blocks promotion."
        : "Replay matched the original outcome byte-for-byte (nightly regression).";
      break;
    case "offer.accepted":
      title = "Early payment accepted";
      detail = `${aed("netProceedsFils") ?? formatAed(num("principalFils") ?? 0)} net to du Pay — ${num("daysEarly") ?? "?"} days early, fee ${aed("feeFils") ?? "0"}.`;
      break;
    case "payout.initiated":
      title = "Payout started";
      detail = `${aed("amountFils") ?? "the advance"} sent to du Pay on the ${str("rail") ?? "dupay"} rail — 4-stage pipeline, honest timing.`;
      break;
    case "payout.state_changed": {
      const to = str("to") ?? str("stage") ?? "";
      if (to === "reserved") {
        title = "Payout reserved";
        detail = "Funding source reserved for the transfer.";
      } else if (to === "sent") {
        title = "Money sent to du Pay";
        detail = `${aed("amountFils") ?? "the advance"} dispatched${str("providerRef") ? ` — ref ${str("providerRef")}` : ""}.`;
      } else if (to === "settled") {
        title = "Money settled to du Pay";
        detail = `${aed("amountFils") ?? "the advance"} settled — daily reconciliation to the dirham.`;
      } else {
        title = "Payout updated";
        detail = `Pipeline moved from ${str("from") ?? "?"} to ${to || "next stage"}.`;
      }
      break;
    }
    case "payout.settled":
      title = "Money settled to du Pay";
      detail = `${aed("amountFils") ?? "the advance"} settled to the wallet.`;
      break;
    case "payout.failed":
      title = "Payout failed";
      detail = "The transfer failed cleanly — the ledger entry is compensated and the offer re-honoured at the original price.";
      break;
    case "escrow.awarded": {
      const contract = ctx.contracts.get(ev.subjectRef ?? "");
      title = "Escrow funded";
      detail = `${str("buyerName") ?? contract?.buyerName ?? "The buyer"} funded ${aed("totalFils") ?? formatAed(contract?.totalFils ?? 0)} at the custodian — funds locked before work starts.`;
      break;
    }
    case "escrow.condition_met":
      title = "Milestone delivered";
      detail = `${milestone()} marked delivered${str("evidence") ? ` — evidence ${str("evidence")}` : ""}. Buyer review window now open.`;
      break;
    case "escrow.released":
      title = "Milestone released";
      detail = `${aed("amountFils") ?? "the milestone amount"} released to the wallet — ${milestone()}.`;
      break;
    case "escrow.disputed":
      title = "Milestone disputed";
      detail = `${milestone()} frozen${str("reason") ? ` (${str("reason")})` : ""} — undisputed milestones continue.`;
      break;
    case "escrow.completed": {
      const contract = ctx.contracts.get(ev.subjectRef ?? "");
      title = "Escrow completed";
      detail = `All milestones released — ${str("description") ?? contract?.description ?? "the contract"} (${aed("totalFils") ?? formatAed(contract?.totalFils ?? 0)}).`;
      break;
    }
    case "sweep.executed":
      title = "Treasury sweep executed";
      detail = `${aed("amountFils") ?? "surplus cash"} to ${str("instrumentName") ?? str("instrumentRef") ?? "an instrument"} — the floor was protected.`;
      break;
    case "sweep.recalled":
      title = "Treasury sweep recalled";
      detail = `${aed("totalFils") ?? aed("amountFils") ?? "the position"} returned to the wallet${num("yieldFils") ? ` incl. ${formatAed(num("yieldFils")!)} yield` : ""}.`;
      break;
    case "treasury.policy_updated": {
      const floor = num("floorFils");
      const horizon = num("horizonDays");
      const margin = num("safetyMarginPermyriad");
      const parts: string[] = [];
      if (floor !== null) parts.push(`floor set to ${formatAed(floor)}`);
      if (horizon !== null) parts.push(`horizon ${horizon} days`);
      if (margin !== null) parts.push(`safety margin ${(margin / 100).toFixed(1)}%`);
      title = "Treasury policy updated";
      detail = parts.length > 0 ? `${parts.join(", ")} — the floor is an absolute hard stop.` : "Treasury policy updated.";
      break;
    }
    case "treasury.obligation_added": {
      const due = str("dueDate");
      const dueLabel = due
        ? new Date(due).toLocaleDateString("en-AE", { day: "numeric", month: "short" })
        : "upcoming";
      title = "Obligation added";
      detail = `${str("label") ?? "Manual obligation"} — ${aed("amountFils") ?? "an amount"} due ${dueLabel}.`;
      break;
    }
    case "status.changed": {
      title = "System status changed";
      const mode = str("mode") ?? "M0";
      detail = `Mode ${mode}${str("message") ? ` — ${str("message")}` : ""}${str("reason") ? ` (${str("reason")})` : ""}.`;
      break;
    }
    case "consent.granted":
      title = "Consent granted";
      detail = `${str("purpose") ?? "A consent"} granted — scoped, one purpose per toggle.`;
      break;
    case "consent.revoked":
      title = "Consent revoked";
      detail = `${str("purpose") ?? "A consent"} revoked — dependent features disabled within 60 seconds.`;
      break;
    case "reserve.released": {
      title = "Reserve released";
      const reserveAmount = aed("amountFils") ?? aed("reserveFils");
      detail = `${reserveAmount ?? "The reserve"} released to the wallet${ref() ? ` — ${ref()}` : ""}.`;
      break;
    }
    case "fraud.review":
      title = "Duplicate invoice under review";
      detail = "The same invoice hash appeared across tenants — both copies frozen and routed to review. Never auto-rejected.";
      break;
    case "ledger.opened":
      title = "Ledger opened";
      detail = "Opening balances posted — every balance since is derived, never stored as truth.";
      break;
    case "advisor.qa": {
      title = "Advisor question";
      const q = str("question");
      detail = q ? `“${q}” — answered from live figures; the rule pack decides, the advisor explains.` : "Answered from live figures; the rule pack decides, the advisor explains.";
      break;
    }
    default: {
      title = ev.type
        .split(".")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
      detail = "";
      break;
    }
  }

  return {
    id: ev.id,
    type: ev.type,
    title,
    detail,
    subjectRef: ev.subjectRef,
    occurredAt: ev.occurredAt.toISOString(),
    params: {
      ref: ref() || null,
      milestone: ctx.milestoneDesc.has(ev.subjectRef ?? "") ? milestone() : str("milestone"),
      description: ctx.contracts.get(ev.subjectRef ?? "")?.description ?? str("description"),
      payload: p,
    },
  };
}

export async function GET(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;

    // This tenant's feed plus tenant-less system rows, newest first.
    const events = await db.appEvent.findMany({
      where: { OR: [{ tenantId: DEMO_TENANT }, { tenantId: null }] },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 10, // small over-fetch to survive exact-duplicate de-dup below
    });

    // Batch enrichment: one query per subject family, never per event.
    const subjectRefs = events.map((e) => e.subjectRef).filter((s): s is string => Boolean(s));
    const unique = [...new Set(subjectRefs)];
    const where = unique.length ? { id: { in: unique } } : undefined;
    const [invoiceRows, milestoneRows, contractRows] = await Promise.all([
      db.invoice.findMany({ where, select: { id: true, externalRef: true } }),
      db.milestone.findMany({ where, select: { id: true, description: true } }),
      db.escrowContract.findMany({ where }),
    ]);

    const enrichment: Enrichment = {
      invoiceRefs: new Map(invoiceRows.map((i): [string, string] => [i.id, i.externalRef])),
      milestoneDesc: new Map(milestoneRows.map((m): [string, string] => [m.id, m.description])),
      contracts: new Map(contractRows.map((c): [string, EscrowContract] => [c.id, c])),
    };

    // De-duplicate only byte-identical rows (type + subject + instant +
    // payload) that idempotent replays can produce — distinct moments within
    // the same second are all kept.
    const seen = new Set<string>();
    const rendered: RenderedEvent[] = [];
    for (const ev of events) {
      const key = `${ev.type}:${ev.subjectRef ?? ""}:${ev.occurredAt.getTime()}:${ev.payloadJson}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rendered.push(renderEvent(ev, enrichment));
      if (rendered.length >= limit) break;
    }

    return ok({ events: rendered });
  } catch {
    return errors.internal();
  }
}
