"use client";

// WATERLINE — server-state hooks. The status endpoint is polled and drives
// the UI directly (the UI never guesses system state — PRD 11.8).

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type {
  OverviewDto, InvoiceDto, InvoiceDetailDto, QuoteResponse, OfferDto, PayoutDto,
  EscrowContractDto, TreasuryDto, ForecastDto, StatusDto, ActivityEventDto, DecisionDto, AuditDto, ConsentDto, CanaryView,
} from "@/lib/types";

export function useOverview() {
  return useQuery({ queryKey: ["overview"], queryFn: () => api.get<OverviewDto>("/api/overview") });
}

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => api.get<StatusDto>("/api/status"),
    refetchInterval: 12_000,
  });
}

export function useInvoices(filter: string) {
  return useQuery({
    queryKey: ["invoices", filter],
    queryFn: () => api.get<{ invoices: InvoiceDto[] }>(`/api/invoices?filter=${filter}`),
  });
}

export function useInvoiceDetail(id: string | null) {
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDetailDto>(`/api/invoices/${id}`),
    enabled: !!id,
    // While this invoice's payout is queued or mid-pipeline, keep watching —
    // the route drains the M2 queue the moment the rail is back and the
    // stages advance server-side on each read (PRD Part 8, 11.13).
    refetchInterval: (query) => {
      const data = query.state.data as InvoiceDetailDto | undefined;
      const st = data?.payout?.state;
      return st && st !== "settled" && st !== "failed" ? 2000 : false;
    },
  });
}

export function useQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => api.get<QuoteResponse>(`/api/invoices/${invoiceId}/quote`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
    },
  });
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { offerId: string; daysEarly: number }) =>
      api.post<{ offer: OfferDto; payout: PayoutDto; replayed?: boolean; queued?: boolean }>(
        `/api/offers/${vars.offerId}/accept`,
        { daysEarly: vars.daysEarly },
        { idemScope: `accept:${vars.offerId}` }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function usePayout(id: string | null, active: boolean) {
  return useQuery({
    queryKey: ["payout", id],
    queryFn: () => api.get<PayoutDto>(`/api/payouts/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as PayoutDto | undefined;
      if (!data) return 1500;
      return data.state === "settled" || data.state === "failed" ? false : 1200;
    },
  });
}

export function useConfirmInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => api.post<{ invoice: InvoiceDto }>(`/api/invoices/${invoiceId}/confirm`, {}, { idemScope: `confirm:${invoiceId}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

/** Dispute drill (ops console, PRD Part 8): flag an invoice disputed or
 *  resolve it. Crossing the dispute-rate band auto-applies M1 on the next
 *  status heartbeat — the guardrails are published on /api/status. */
export function useDisputeDrill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { invoiceId: string; reason: string; resolve?: boolean }) =>
      api.post<{ invoice: InvoiceDto; resolved: boolean }>(
        `/api/invoices/${vars.invoiceId}/dispute`,
        { reason: vars.reason, resolve: vars.resolve ?? false },
        { idemScope: `dispute:${vars.invoiceId}:${vars.resolve ? "resolve" : "flag"}` },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

/** E07 portfolio-ceiling drill (ops console): stage the honest demo — fund
 *  the book under the cautious pack, submit an invoice that crosses the
 *  tightened ceiling, then quote it to see E_PORTFOLIO. Unwind settles the
 *  drill-funded book (the recovery arc: headroom returns, the quote passes). */
export interface E07DrillResult {
  action: string;
  staged: boolean;
  alreadyStaged: boolean;
  mode: string;
  exposureFils: number;
  ceilingFils: number;
  crossed: boolean;
  acceptedCount: number;
  settledCount?: number;
  remainingFundedCount?: number;
  drillInvoice?: { id: string; ref: string; grossFils: number };
  note: string;
}

export function useE07Drill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { action: "stage" | "unwind"; reason: string }) =>
      api.post<E07DrillResult>("/api/ops/e07-drill", vars, {
        idemScope: `e07drill:${vars.action}:${Date.now()}`,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
      qc.invalidateQueries({ queryKey: ["treasury"] });
    },
  });
}

export function useSubmitInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { buyerLinkId: string; externalRef: string; grossFils: number; dueDate: string }) =>
      api.post<{ invoice: InvoiceDto }>("/api/invoices", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useSettleInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => api.post<{ invoice: InvoiceDto }>(`/api/invoices/${invoiceId}/settle`, {}, { idemScope: `settle:${invoiceId}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["treasury"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useEscrow() {
  return useQuery({ queryKey: ["escrow"], queryFn: () => api.get<{ contracts: EscrowContractDto[] }>("/api/escrow") });
}

export function useMilestoneAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { contractId: string; milestoneId: string; action: string; evidence?: string }) =>
      api.post<{ contract: EscrowContractDto }>(
        `/api/escrow/${vars.contractId}/milestones/${vars.milestoneId}`,
        { action: vars.action, evidence: vars.evidence },
        { idemScope: `milestone:${vars.milestoneId}:${vars.action}` }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escrow"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["treasury"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useCreateEscrow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { buyerName: string; description: string; totalFils: number; milestones: { description: string; amountFils: number; conditionType: string; reviewWindowDays: number }[] }) =>
      api.post<{ contract: EscrowContractDto }>("/api/escrow", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escrow"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useTreasury() {
  return useQuery({ queryKey: ["treasury"], queryFn: () => api.get<TreasuryDto>("/api/treasury") });
}

// Forward cash projection (PRD 5.2) — advisory, deterministic, 90 days.
export function useForecast() {
  return useQuery({
    queryKey: ["forecast"],
    queryFn: () => api.get<ForecastDto>("/api/treasury/projection"),
    // The projection moves with every money event; a slow poll keeps the
    // chart honest without hammering the read path.
    refetchInterval: 60_000,
  });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<{ floorFils: number; horizonDays: number; safetyMarginPermyriad: number; autoPilotEnabled: boolean }>) =>
      api.put<{ policy: TreasuryDto["policy"] }>("/api/treasury/policy", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useSweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { instrumentRef: string; amountFils?: number }) =>
      api.post<{ decision: DecisionDto; sweep: unknown }>("/api/treasury/sweep", data, { idemScope: `sweep:${data.instrumentRef}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useRecall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sweepId: string) => api.post<{ sweep: unknown }>("/api/treasury/recall", { sweepId }, { idemScope: `recall:${sweepId}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useAddObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; dueDate: string; amountFils: number }) =>
      api.post<{ obligation: unknown }>("/api/treasury/obligations", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treasury"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
}

export function useActivity(limit = 50) {
  return useQuery({ queryKey: ["activity", limit], queryFn: () => api.get<{ events: ActivityEventDto[] }>(`/api/activity?limit=${limit}`) });
}

export function useDecisions() {
  return useQuery({
    queryKey: ["decisions"],
    queryFn: () =>
      api.get<{
        decisions: DecisionDto[];
        shadowDiff?: {
          candidateVersion: string;
          delta: { field: string; from: string; to: string; reason: string }[];
          shadowPairs: number;
          approvalsGained: number;
          approvalsLost: number;
          limitMoves: number;
          priceMoves: number;
          examples: { label: string; liveOutcome: string; liveLimitFils: number | null; shadowOutcome: string; shadowLimitFils: number | null }[];
          note: string;
        };
        canary?: CanaryView;
      }>("/api/decisions"),
  });
}

/** PRD 3.3 canary phase — operator controls (promote / withdraw). */
export function useCanaryControls() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { action: "promote" | "withdraw"; reason: string }) =>
      api.post<{ canary: CanaryView | null }>("/api/ops/canary", vars, { idemScope: `canary:${vars.action}:${Date.now()}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

export function useReplayDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisionId: string) => api.post<{ matchesOriginal: boolean; original: DecisionDto; replay: DecisionDto }>(`/api/decisions/${decisionId}/replay`, {}, { idemScope: `replay:${decisionId}` }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity"] }),
  });
}

export function useAudit() {
  return useQuery({ queryKey: ["audit"], queryFn: () => api.get<AuditDto>("/api/audit") });
}

export function useOperatorStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { mode?: string; killSwitch?: { name: string; on: boolean }; breaker?: { name: string; state: string }; message?: string; reason: string; confirm: true }) =>
      api.post<StatusDto>("/api/status", data, { idemScope: `status:${JSON.stringify(data).slice(0, 40)}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["status"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useConsents() {
  return useQuery({
    queryKey: ["consents"],
    queryFn: () => api.get<{ consents: ConsentDto[] }>("/api/consents"),
  });
}

export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ consent: ConsentDto }>(`/api/consents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consents"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useGrantConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (purpose: string) => api.post<{ consent: ConsentDto }>("/api/consents", { purpose }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consents"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

// ── Advisor (AI explainer — the rule pack decides, the advisor explains) ──

export interface AdvisorTurn {
  role: "user" | "assistant";
  content: string;
}

export function useAdvisor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { question: string; lang: string; history: AdvisorTurn[] }) =>
      api.post<{ answer: string; lang: string; mode: string }>("/api/advisor", vars),
    onSuccess: () => {
      // advisor.qa lands in the activity feed (append-only audit)
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}
