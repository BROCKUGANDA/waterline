// WATERLINE — advisor shared library. The context builder, system prompt
// and validation used by BOTH /api/advisor (non-streaming) and
// /api/advisor/stream (SSE). Backend-only: the z-ai-web-dev-sdk never runs
// client-side.
//
// Invariants honoured here:
// - Money is pre-formatted to AED strings server-side; the model never
//   performs arithmetic on fils and never sees raw minor units.
// - The context is built from the same derived balances as /api/overview.
// - M4 (read-only) disables the advisor: no advisory on possibly-stale data.

import { db } from "@/lib/db";
import { DEMO_TENANT } from "@/lib/api";
import { formatAed } from "@/lib/money";
import { accountBalance, LEDGER_ACCOUNTS } from "@/lib/ledger";
import { evaluateSweep, type FeatureSnapshot } from "@/lib/ruleengine";
import { rulePack, RULEPACK_VERSION } from "@/lib/rulepack";
import { packForMode } from "@/lib/rulepacks";

const DAY = 86_400_000;

export const MAX_QUESTION = 500;
export const MAX_HISTORY = 6;
export const MAX_TURN = 1000;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface AdvisorRequest {
  question: string;
  lang: "en" | "ar";
  history: Turn[];
}

export function buildSystemPrompt(lang: string, contextJson: string, mode: string | null): string {
  const voice =
    lang === "ar"
      ? [
          "أنت «مرشد ووترلاين» — طبقة السيولة لأعمال دو في الإمارات.",
          "أسلوبك: قصير، واقعي، ودود بلا مبالغة. تجيب بالعربية الفصحى المبسطة.",
          "أرقامك تأتي حصراً من الحقائق أدناه بصيغة درهم جاهزة — لا تُجرِ عمليات حسابية ولا تبتكر أرقاماً.",
          "عند سؤالك عن رقم محدد (رصيد، حد، التزام): ابحث عنه في الحقائق بالاسم نفسه وانقله حرفياً مع تسميته — «رصيد محفظة دو باي: ...» — ولا تستبدل برقم آخر من الحقائق.",
          "التسعير والحدود والأهلية تقررها حزمة القواعد الحتمية — أنت تشرح، لا تقرر أبداً.",
          "إن لم تكن الإجابة في الحقائق، قل ذلك بصراحة وأحِل إلى ما يستطيع المستخدم رؤيته في التطبيق.",
          "لا تقدّم نصائح استثمارية عامة؛ اشرح منتج ووترلاين: الدفع المبكر للفواتير، الضمان المرحلي، الطيار الآلي للخزانة.",
        ].join(" ")
      : [
          "You are the WATERLINE advisor — the liquidity layer for du Business in the UAE.",
          "Voice: short, factual, warm without hype. Plain language for an SME owner.",
          "Your numbers come ONLY from the facts below, pre-formatted in dirhams — never compute, never invent figures.",
          "When asked for a specific figure (balance, floor, obligation): find it in the facts by its exact name and quote it verbatim with its label — 'du Pay wallet balance: AED …' — never substitute a different fact's number.",
          "Pricing, limits and eligibility are decided by the deterministic rule pack — you explain, you never decide.",
          "If the answer is not in the facts, say so honestly and point to what the user can see in the app.",
          "Do not give general investment advice; explain WATERLINE's product: early invoice payment, milestone escrow, treasury autopilot.",
        ].join(" ");

  return [
    voice,
    "",
    "TENANT FACTS (live, derived — the only numbers you may cite):",
    contextJson,
    "",
    `RULE PACK anchors (${packForMode(mode).version}${mode === "M1" ? " — cautious tightening active" : ""}): advance rates up to ${packForMode(mode).limits.baseAdvanceRatePermyriad / 100}% of invoice value (${packForMode(mode).limits.unratedAdvanceCapPermyriad / 100}% for unrated buyers), price curves ${Object.entries(packForMode(mode).pricing.baseCurveMilliBps).map(([k, v]) => `${k} ${(v / 10).toFixed(1)} bps/day`).join(", ")}, floor ${packForMode(mode).pricing.floorMilliBps / 10} bps/day, minimum invoice ${formatAed(200_000)}, minimum sweep ${formatAed(packForMode(mode).treasury.minSweepFils)}.`,
    "Every fee is: days early × rate per day × advance — always shown expanded in the app.",
  ].join("\n");
}


export async function buildContext(): Promise<string> {
  const t = DEMO_TENANT;
  const now = new Date();

  const [entity, policy, status] = await Promise.all([
    db.entity.findFirst({ where: { tenantId: t, role: "sme" } }),
    db.treasuryPolicy.findFirst({ where: { tenantId: t } }),
    db.statusState.findUnique({ where: { id: "singleton" } }),
  ]);
  if (!entity) throw new Error("SME entity missing");

  const walletLedgerBalance = await accountBalance(t, LEDGER_ACCOUNTS.SME_WALLET(t));
  const walletFils = -walletLedgerBalance;

  const instrumentRows = await db.ledgerEntry.findMany({
    where: { tenantId: t, accountCode: { startsWith: "instrument." } },
    select: { direction: true, amountFils: true },
  });
  const investedFils = -instrumentRows.reduce(
    (acc, r) => acc + (r.direction === "debit" ? r.amountFils : -r.amountFils),
    0,
  );

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
    if (inv.verificationState === "verified" && !funded && inv.dueDate.getTime() > now.getTime()) {
      readyCount += 1;
      readyFils += inv.grossFils;
    } else if (inv.fundingState === "settled") settledCount += 1;
    else if (inv.verificationState === "disputed") disputedCount += 1;
    else if (inv.verificationState !== "verified") pendingCount += 1;
  }

  const floorFils = policy?.floorFils ?? 5_000_000;
  const horizonDays = policy?.horizonDays ?? 14;
  const safetyMarginPermyriad = policy?.safetyMarginPermyriad ?? 1500;
  const obligations = await db.obligation.findMany({
    where: { tenantId: t, active: true, dueDate: { lte: new Date(now.getTime() + horizonDays * DAY) } },
    select: { amountFils: true, label: true, dueDate: true },
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

  const buyers = await db.buyerLink.findMany({
    where: { tenantId: t },
    orderBy: { confirmedInvoiceCount: "desc" },
    take: 4,
  });

  const escrowContracts = await db.escrowContract.findMany({
    where: { tenantId: t },
    select: { totalFils: true, state: true, milestones: { select: { amountFils: true, state: true } } },
  });
  const escrowTotal = escrowContracts.reduce((a, c) => a + c.totalFils, 0);
  // Released so far — derived from milestone states, never stored as truth.
  const escrowReleased = escrowContracts.reduce(
    (a, c) => a + c.milestones.filter((m) => m.state === "released").reduce((s, m) => s + m.amountFils, 0),
    0,
  );

  const decisions = await db.decision.findMany({
    where: { tenantId: t },
    orderBy: { evaluatedAt: "desc" },
    take: 5,
    select: { decisionType: true, outcome: true, reasonCode: true, reasonText: true },
  });

  const killSwitches = JSON.parse(status?.killSwitchesJson ?? "{}") as Record<string, boolean>;

  const lines = [
    `Entity: ${entity.legalName} — ${entity.sectorCode} sector, ${entity.emirate}, ${entity.tenureMonths} months tenure, billing band ${entity.billingBand}, KYB ${entity.kybState}, licence ${Math.ceil((entity.licenceExpiry.getTime() - now.getTime()) / DAY)} days remaining.`,
    `Available now (du Pay wallet balance — the exact figure the app's home shows as "Available now"; when the user asks for their balance or available money, THIS is the number): ${formatAed(walletFils)}.`,
    `Invested in treasury instruments (earns yield, recallable — part of "Total liquidity", NOT spendable cash): ${formatAed(investedFils)}.`,
    `Treasury floor (absolute hard stop): ${formatAed(floorFils)}; horizon ${horizonDays} days; safety margin ${(safetyMarginPermyriad / 100).toFixed(1)}%.`,
    `Obligations in horizon (future outflows, NOT money the user has): ${formatAed(obligationsFils)} across ${obligations.length} items${obligations.length ? ` (next: ${obligations
      .slice()
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 3)
      .map((o) => `${o.label} ${formatAed(o.amountFils)}`)
      .join("; ")})` : ""}.`,
    `Sweepable today (SURPLUS above the floor that the autopilot may invest — a treasury capacity, NOT the user's balance): ${sweep.outcome === "approved" ? formatAed(sweep.sweepableFils) : `nothing — ${sweep.reasonCode}: ${sweep.reasonText}`}.`,
    `Invoices: ${readyCount} ready to fund (${formatAed(readyFils)}), ${pendingCount} pending buyer confirmation, ${disputedCount} disputed, ${settledCount} settled.`,
    `Buyers (top): ${buyers.map((b) => `${b.buyerName} (${b.tier}, pays in ~${b.avgDaysToPay} days, ${b.confirmedInvoiceCount} confirmed)`).join("; ")}.`,
    `Escrow: ${escrowContracts.length} milestone contracts, total ${formatAed(escrowTotal)}, released so far ${formatAed(escrowReleased)}.`,
    `Recent decisions: ${decisions.map((d) => `${d.decisionType} ${d.outcome}${d.reasonCode ? ` (${d.reasonCode})` : ""}`).join("; ")}.`,
    `System mode: ${status?.mode ?? "M0"}${killSwitches.global || killSwitches.dynamicDiscounting ? " — funding halted by operator guardrail" : ""}.`,
    `Rule pack version: ${RULEPACK_VERSION}.`,
  ];
  return lines.join("\n");
}



/** Shared request parsing/validation — both routes accept the same body. */
export function parseAdvisorBody(raw: unknown): { question: string; lang: "en" | "ar"; history: Turn[] } | { error: string } {
  const body = (raw ?? null) as AdvisorBody | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const lang = body?.lang === "ar" ? "ar" : "en";
  const historyIn = Array.isArray(body?.history) ? (body!.history as unknown[]) : [];

  if (!question || question.length > MAX_QUESTION) {
    return { error: `Question must be 1–${MAX_QUESTION} characters.` };
  }

  const history: Turn[] = [];
  for (const r of historyIn.slice(-MAX_HISTORY)) {
    if (
      r && typeof r === "object" &&
      (r as { role?: unknown }).role === "user" &&
      typeof (r as { content?: unknown }).content === "string"
    ) {
      history.push({ role: "user", content: (r as { content: string }).content.slice(0, MAX_TURN) });
    } else if (
      r && typeof r === "object" &&
      (r as { role?: unknown }).role === "assistant" &&
      typeof (r as { content?: unknown }).content === "string"
    ) {
      history.push({ role: "assistant", content: (r as { content: string }).content.slice(0, MAX_TURN) });
    }
  }
  return { question, lang, history };
}

interface AdvisorBody {
  question?: unknown;
  lang?: unknown;
  history?: unknown;
}

/** Append-only audit trail: questions asked about money are part of the story. */
export async function auditAdvisorQa(question: string, lang: string, answerChars: number): Promise<void> {
  await db.appEvent.create({
    data: {
      tenantId: DEMO_TENANT,
      type: "advisor.qa",
      subjectRef: null,
      payloadJson: JSON.stringify({
        question: question.slice(0, 200),
        lang,
        answerChars,
      }),
      occurredAt: new Date(),
    },
  });
}
