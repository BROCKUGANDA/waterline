"use client";

// WATERLINE — Operations console (du operations analyst, PRD 1.2): show me
// what needs a human, why, and give me the authority to resolve it with a
// trail. Degrade modes M0–M4, all kill-switch scopes, breaker states,
// decision replay and the ledger audit — every manual action written to the
// same append-only audit store (PRD Part 8).

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useStatus, useOperatorStatus, useDecisions, useReplayDecision, useAudit, useConsents, useRevokeConsent, useGrantConsent, useInvoices, useDisputeDrill, useE07Drill, useCanaryControls, type E07DrillResult } from "@/hooks/waterline";
import { Money } from "@/components/waterline/money";
import { SectionLabel, StatusDot, SkeletonCard, CopyRef } from "@/components/waterline/primitives";
import { WlIcon } from "@/components/waterline/icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import type { DecisionDto, StatusDto } from "@/lib/types";
import { formatAed, formatAedAr } from "@/lib/money";
import { cn } from "@/lib/utils";

const KILL_SWITCHES: { name: string; label: string }[] = [
  { name: "global", label: "Global funding" },
  { name: "dynamicDiscounting", label: "Dynamic discounting" },
  { name: "escrow", label: "Escrow" },
  { name: "treasury", label: "Treasury" },
  { name: "tenant", label: "Per-tenant" },
  { name: "buyer", label: "Per-buyer" },
  { name: "sector", label: "Per-sector" },
  { name: "rail", label: "Per-rail" },
];

const BREAKERS = ["dupay", "aani", "openfinance", "einvoice", "custodian", "notification"];

/* ── Status & modes tab ────────────────────────────────────────────────── */
function StatusTab() {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const { data: status } = useStatus();
  const operator = useOperatorStatus();
  const [reason, setReason] = useState("");
  const [confirmMode, setConfirmMode] = useState<string | null>(null);

  if (!status) return <SkeletonCard lines={6} />;

  const apply = (payload: Record<string, unknown>, needsConfirm: string | null = null) => {
    if (needsConfirm && (!reason || confirmMode !== needsConfirm)) {
      setConfirmMode(needsConfirm);
      toast.error(T.ops.confirmTwoPerson);
      return;
    }
    operator.mutate(
      { ...payload, reason: reason || "operator console", confirm: true },
      {
        onSuccess: (res) => {
          toast.success(`${T.ops.applyMode} ✓`);
          // When the rail returns, the queue drains server-side — surface the
          // release count so the operator sees the causal effect (PRD Part 8).
          if (res.queueDrained && res.queueDrained > 0) {
            toast(T.ops.queueDrained(res.queueDrained), { duration: 6000 });
          }
          setConfirmMode(null);
          setReason("");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : T.errors.generic),
      }
    );
  };

  return (
    <div className="space-y-5">
      {/* current mode */}
      <div className="rounded-[10px] border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <SectionLabel>{T.ops.mode}</SectionLabel>
          <div className="flex items-center gap-2">
            <StatusDot tone={status.mode === "M0" ? "success" : status.mode === "M4" ? "neutral" : status.mode === "M3" ? "danger" : "caution"} pulse={status.mode !== "M0"} />
            <span className="type-mono">{status.mode}</span>
          </div>
        </div>
        <div className="type-body-strong mt-1">{T.ops.modeCopy[status.mode]?.label ?? status.modeCatalog.find((m) => m.mode === status.mode)?.label}</div>
        <div className="type-caption text-ink-400">{T.ops.modeCopy[status.mode]?.description ?? status.modeCatalog.find((m) => m.mode === status.mode)?.description}</div>
        {/* Which pack decides right now — published, never guessed. In M1 the
            cautious delta is active, and its version is on every decision. */}
        {status.rulePacks && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-surface-2 border border-border px-2.5 py-1.5">
            <WlIcon name="gauge" size={13} className={status.mode === "M1" ? "text-caution-w" : "text-ink-400"} />
            <span className="type-caption text-ink-600">{T.ops.activePack}</span>
            <span className={cn("type-mono text-[11px] ml-auto", status.mode === "M1" ? "text-caution-w-dark" : "text-ink-400")}>
              {status.rulePacks.activeVersion}
            </span>
          </div>
        )}
      </div>

      {/* mode catalog */}
      <div>
        <SectionLabel className="mb-2">{T.ops.modeCatalog}</SectionLabel>
        <div className="space-y-2">
          {status.modeCatalog.map((m) => {
            const copy = T.ops.modeCopy[m.mode];
            return (
            <div
              key={m.mode}
              className={cn(
                "rounded-[10px] border p-3.5 transition-colors",
                status.mode === m.mode ? "border-accent-w/50 bg-accent-w-soft/50" : "border-border bg-card"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="type-mono text-[11px] text-ink-400">{m.mode}</span>
                    <span className="type-body-strong">{copy?.label ?? m.label}</span>
                  </div>
                  <div className="type-caption text-ink-400 mt-0.5">{copy?.description ?? m.description}</div>
                </div>
                {status.mode !== m.mode && (
                  <button
                    type="button"
                    onClick={() => apply({ mode: m.mode }, m.mode)}
                    className={cn(
                      "h-9 px-3 rounded-md type-caption font-semibold press-scale shrink-0 border",
                      confirmMode === m.mode
                        ? "bg-danger-w text-white border-danger-w"
                        : "border-border hover:border-caution-w/50 hover:text-caution-w"
                    )}
                  >
                    {confirmMode === m.mode ? T.common.confirm : T.ops.applyMode}
                  </button>
                )}
              </div>
              {status.mode === m.mode && (
                <div className="mt-1.5 type-caption text-accent-w-dark">✓ {copy?.smeSees ?? m.smeSees}</div>
              )}
              {/* The cautious pack delta, spelled out field by field — the
                  promotion-diff style of PRD 3.3, rendered where it applies. */}
              {m.mode === "M1" && status.rulePacks && (
                <div className="mt-2.5 rounded-md border border-caution-w/30 bg-caution-w/5 p-2.5" dir="auto">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="type-label text-caution-w-dark">{T.ops.packDeltaTitle}</span>
                    <span className="type-mono text-[10px] text-ink-400 ms-auto">{status.rulePacks.cautiousVersion}</span>
                  </div>
                  <div className="space-y-1">
                    {status.rulePacks.delta.map((d) => {
                      const copy2 = T.ops.packDeltaCopy[d.field];
                      const val = (v: string) => T.ops.packValueCopy[v] ?? v;
                      const changed = d.from !== d.to;
                      return (
                        <div key={d.field} className="flex items-baseline justify-between gap-3">
                          <span className="type-caption text-ink-600" title={copy2?.reason ?? d.reason}>
                            {copy2?.field ?? d.field}
                          </span>
                          <span className={cn("type-mono text-[11px] whitespace-nowrap", changed ? "text-caution-w-dark" : "text-ink-400")}>
                            {changed ? `${d.from} → ${d.to}` : val(d.from)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="type-caption text-ink-400 mt-2 pt-2 border-t border-caution-w/20">{T.ops.packUnchangedNote}</div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* kill switches */}
      <div>
        <SectionLabel className="mb-2">{T.ops.killSwitches}</SectionLabel>
        <div className="grid sm:grid-cols-2 gap-2">
          {KILL_SWITCHES.map((k) => {
            const on = status.killSwitches?.[k.name];
            return (
              <div key={k.name} className={cn("rounded-[10px] border p-3 flex items-center justify-between", on ? "border-danger-w/40 bg-danger-w/5" : "border-border bg-card")}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <WlIcon name="kill-switch" size={16} className={on ? "text-danger-w" : "text-ink-400"} />
                  <span className="type-body-strong truncate">{k.label}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!on}
                  aria-label={k.label}
                  onClick={() => apply({ killSwitch: { name: k.name, on: !on } })}
                  className={cn(
                    "relative w-11 h-6 rounded-full border transition-colors press-scale shrink-0",
                    on ? "bg-danger-w border-danger-w" : "bg-surface-2 border-border"
                  )}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 210, damping: 26 }}
                    className={cn("absolute top-1/2 -translate-y-1/2 h-4.5 w-4.5 h-[18px] w-[18px] rounded-full bg-white shadow", on ? "start-[23px]" : "start-1")}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* breakers */}
      <div>
        <SectionLabel className="mb-2">{T.ops.breakerStates}</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {BREAKERS.map((b) => {
            const st = status.breakers?.[b] ?? "closed";
            return (
              <button
                key={b}
                type="button"
                onClick={() => apply({ breaker: { name: b, state: st === "closed" ? "open" : "closed" } })}
                className="rounded-[10px] border border-border bg-card p-3 text-start press-scale hover:border-caution-w/40"
              >
                <div className="type-mono text-[12px]">{b}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <StatusDot tone={st === "closed" ? "success" : st === "half" ? "caution" : "danger"} />
                  <span className="type-caption text-ink-600">
                    {st === "closed" ? T.ops.breakerClosed : st === "half" ? T.ops.breakerHalf : T.ops.breakerOpen}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* reason input — two-person authorisation */}
      <div className="rounded-[10px] border border-caution-w/40 bg-caution-w/5 p-3.5">
        <label className="type-label text-caution-w-dark block mb-1.5">{T.ops.reasonLabel}</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={lang === "ar" ? "اذكر السبب…" : "State the reason…"}
          className="w-full h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-caution-w"
        />
        <div className="type-caption text-ink-400 mt-1.5">{T.ops.operatorActions}</div>
      </div>

      {/* guardrail watch + dispute drill + E07 portfolio drill */}
      <GuardrailWatch reason={reason} />
    </div>
  );
}

/* ── E07 portfolio-ceiling drill (one click stages the honest scenario) ── */
function E07DrillCard({ reason }: { reason: string }) {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const openInvoice = useUi((s) => s.openInvoice);
  const drill = useE07Drill();
  const [result, setResult] = useState<E07DrillResult | null>(null);

  const aed = (fils: number) => (lang === "ar" ? formatAedAr(fils) : formatAed(fils));

  const run = (action: "stage" | "unwind") => {
    if (!reason || reason.trim().length < 3) {
      toast.error(T.ops.confirmTwoPerson);
      return;
    }
    drill.mutate(
      { action, reason },
      {
        onSuccess: (res) => {
          setResult(res);
          if (action === "unwind") {
            toast.success(T.ops.e07.unwindToast, { duration: 6000 });
          } else if (res.alreadyStaged) {
            toast.info(T.ops.e07.alreadyToast, { duration: 6000 });
          } else {
            toast.success(T.ops.e07.stagedToast, { duration: 6000 });
          }
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : T.errors.generic),
      },
    );
  };

  return (
    <div className="rounded-[10px] border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <SectionLabel>{T.ops.e07.title}</SectionLabel>
          <div className="type-caption text-ink-400 mt-0.5">{T.ops.e07.subtitle}</div>
        </div>
        <WlIcon name="invoice" size={16} className="text-ink-400 shrink-0" />
      </div>
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => run("stage")}
          disabled={drill.isPending}
          className={cn(
            "h-10 px-4 rounded-md type-caption font-semibold press-scale border shrink-0",
            "bg-card border-border hover:border-caution-w/50 hover:text-caution-w",
            "disabled:opacity-50 disabled:pointer-events-none"
          )}
        >
          {drill.isPending && drill.variables?.action === "stage" ? T.ops.e07.staging : T.ops.e07.stage}
        </button>
        <button
          type="button"
          onClick={() => run("unwind")}
          disabled={drill.isPending}
          className={cn(
            "h-10 px-4 rounded-md type-caption font-semibold press-scale border shrink-0",
            "bg-card border-border hover:border-success-w/50 hover:text-success-w",
            "disabled:opacity-50 disabled:pointer-events-none"
          )}
        >
          {drill.isPending && drill.variables?.action === "unwind" ? T.ops.e07.unwinding : T.ops.e07.unwind}
        </button>
      </div>
      {result && (
        <div className={cn("mt-3 rounded-md border px-3 py-2.5", result.crossed ? "border-caution-w/50 bg-caution-w/10" : "border-border bg-surface-2/50")}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="type-caption text-ink-400">{T.ops.e07.exposure}</div>
              <div className="type-body-strong money">{aed(result.exposureFils)}</div>
            </div>
            <div>
              <div className="type-caption text-ink-400">{T.ops.e07.ceiling}</div>
              <div className="type-body-strong money">{aed(result.ceilingFils)}</div>
            </div>
          </div>
          <div className={cn("type-caption mt-2 font-semibold", result.crossed ? "text-caution-w-dark" : "text-ink-600")}>
            {result.crossed ? T.ops.e07.crossed : T.ops.e07.notCrossed}
          </div>
          {result.acceptedCount > 0 && (
            <div className="type-caption text-ink-400 mt-1">
              {result.acceptedCount} {T.ops.e07.funded}
            </div>
          )}
          {result.drillInvoice && (
            <button
              type="button"
              onClick={() => openInvoice(result.drillInvoice!.id)}
              className="mt-2 h-8 px-3 rounded-md border border-accent-w/40 text-accent-w type-caption font-semibold press-scale hover:bg-accent-w-soft/50"
              title={T.ops.e07.openHint}
            >
              {T.ops.e07.openInvoice} · {result.drillInvoice.ref} · {aed(result.drillInvoice.grossFils)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Guardrail watch (PRD Part 8) + the dispute drill ──────────────────── */
function GuardrailWatch({ reason }: { reason: string }) {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const { data: status } = useStatus();
  // The full list (not just "pending"): disputed invoices live outside the
  // pending filter, and the drill must reach them to RESOLVE.
  const all = useInvoices("all");
  const dispute = useDisputeDrill();
  const [drillId, setDrillId] = useState<string>("");

  const g = status?.guardrails;
  const allInvoices = all.data?.invoices ?? [];
  const disputedInvoices = allInvoices.filter((i) => i.verificationState === "disputed");
  // The drill list: awaiting-confirmation invoices + already-disputed ones
  // (for the resolve action).
  const drillable = allInvoices.filter((i) =>
    i.verificationState === "deduped" || i.verificationState === "disputed" ||
    i.verificationState === "parsed" || i.verificationState === "received",
  );
  const selected = drillable.find((i) => i.id === drillId) ?? null;
  const isSelectedDisputed = selected?.verificationState === "disputed";

  const fmtValue = (m: NonNullable<StatusDto["guardrails"]>["metrics"][number]): string => {
    if (m.unit === "permyriad") return `${(m.value / 100).toFixed(1)}%`;
    if (m.key === "portfolioCeiling") {
      // Headroom against the ACTIVE pack ceiling — the arithmetic is named in
      // full on the detail line (exposure vs ceiling vs pack version).
      const aed = lang === "ar" ? formatAedAr(Math.abs(m.value)) : formatAed(Math.abs(m.value));
      return m.value >= 0 ? T.ops.guardrails.headroom(aed) : T.ops.guardrails.overCeiling(aed);
    }
    if (m.unit === "fils") {
      const aed = lang === "ar" ? formatAedAr(Math.abs(m.value)) : formatAed(Math.abs(m.value));
      return m.value >= 0 ? T.ops.guardrails.aboveFloor(aed) : T.ops.guardrails.belowFloor(aed);
    }
    if (m.key === "railBreaker") return m.value >= 1 ? T.ops.guardrails.railOpen : T.ops.guardrails.railClosed;
    if (m.key === "replayIntegrity") return m.value >= 1 ? T.ops.guardrails.integrityBroken(m.value) : T.ops.guardrails.integrityClean(m.value);
    return String(m.value);
  };
  const fmtBand = (m: NonNullable<StatusDto["guardrails"]>["metrics"][number]): string =>
    m.unit === "permyriad" ? `${(m.band / 100).toFixed(0)}%` : m.unit === "fils" ? "≥ 0" : m.key === "railBreaker" ? T.ops.guardrails.bandClosed : "0";

  const metricLabel = (key: string): string =>
    key === "disputeRate" ? T.ops.guardrails.disputeRate
    : key === "lossRate" ? T.ops.guardrails.lossRate
    : key === "coverage30d" ? T.ops.guardrails.coverage30d
    : key === "railBreaker" ? T.ops.guardrails.railBreaker
    : key === "portfolioCeiling" ? T.ops.guardrails.portfolioCeiling
    : key === "replayIntegrity" ? T.ops.guardrails.replayIntegrity
    : T.ops.guardrails.reconBreaks;

  const runDrill = () => {
    if (!selected) return;
    if (!reason || reason.trim().length < 3) {
      toast.error(T.ops.confirmTwoPerson);
      return;
    }
    dispute.mutate(
      { invoiceId: selected.id, reason, resolve: isSelectedDisputed },
      {
        onSuccess: (res) => {
          toast.success(res.resolved ? T.ops.drill.resolvedToast : T.ops.drill.flagged, { duration: 5000 });
          setDrillId("");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : T.errors.generic),
      },
    );
  };

  const anyBreached = g?.metrics.some((m) => m.breached) ?? false;

  return (
    <>
      <div className="rounded-[10px] border border-border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <SectionLabel>{T.ops.guardrails.title}</SectionLabel>
            <div className="type-caption text-ink-400 mt-0.5">{T.ops.guardrails.subtitle}</div>
          </div>
          <WlIcon name="alert" size={16} className={anyBreached ? "text-caution-w" : "text-ink-400"} />
        </div>
        {g ? (
          <>
            <div className="mt-3 grid sm:grid-cols-2 gap-2">
              {g.metrics.map((m) => (
                <div
                  key={m.key}
                  className={cn(
                    "relative rounded-md border p-2.5 overflow-hidden",
                    m.breached ? "border-caution-w/50 bg-caution-w/10" : "border-border bg-surface-2/50"
                  )}
                  title={m.detail}
                >
                  {/* Breached cards get a leading accent bar — the eye lands
                      on the crossed band first, before any number. */}
                  {m.breached && (
                    <span aria-hidden className="absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-caution-w" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("type-caption truncate", m.breached ? "text-caution-w-dark font-semibold" : "text-ink-600")}>{metricLabel(m.key)}</span>
                    <StatusDot tone={m.breached ? "caution" : "success"} pulse={m.breached} />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className={cn("type-body-strong", m.breached && "text-caution-w-dark font-bold")}>{fmtValue(m)}</span>
                    <span className="type-caption text-ink-600 whitespace-nowrap">
                      {T.ops.guardrails.bandLabel} {fmtBand(m)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {anyBreached ? (
              <div className="mt-3 rounded-md border border-caution-w/50 bg-caution-w/10 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <WlIcon name="alert" size={14} className="text-caution-w shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="type-caption text-caution-w-dark font-bold">
                      {T.ops.guardrails.breached} —{" "}
                      {g.lastAutoMode === "M3" ? T.ops.guardrails.autoAppliedM3 : g.lastAutoMode === "M2" ? T.ops.guardrails.autoAppliedM2 : T.ops.guardrails.autoAppliedM1}
                    </div>
                    {g.lastAutoEpisode && g.lastAutoMode === status?.mode && (
                      <div className="type-caption text-ink-600 mt-0.5" dir="auto">{g.autoReason}</div>
                    )}
                    {g.lastAutoMode !== status?.mode && (
                      <div className="type-caption text-ink-600 mt-0.5">{T.ops.guardrails.manualOverride}</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="type-caption text-ink-400 mt-3">{T.ops.guardrails.clearNote}</div>
            )}
          </>
        ) : (
          <div className="type-caption text-ink-400 mt-3">…</div>
        )}
      </div>

      {/* dispute drill — the honest path across the band */}
      <div className="rounded-[10px] border border-border bg-card p-4">
        <SectionLabel>{T.ops.drill.title}</SectionLabel>
        <div className="type-caption text-ink-400 mt-0.5">{T.ops.drill.subtitle}</div>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <select
              value={drillId}
              onChange={(e) => setDrillId(e.target.value)}
              aria-label={T.ops.drill.select}
              className="w-full h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-caution-w appearance-none"
            >
              <option value="">{T.ops.drill.select}…</option>
              {drillable.length === 0 && <option value="" disabled>{T.ops.drill.selectNone}</option>}
              {drillable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.externalRef} · {i.buyer?.buyerName ?? "—"} · {lang === "ar" ? formatAedAr(i.grossFils) : formatAed(i.grossFils)}
                  {i.verificationState === "disputed" ? (lang === "ar" ? " — متنازع عليها" : " — disputed") : ""}
                </option>
              ))}
            </select>
            <WlIcon name="invoice" size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={runDrill}
            disabled={!selected || dispute.isPending}
            className={cn(
              "h-10 px-4 rounded-md type-caption font-semibold press-scale border shrink-0",
              isSelectedDisputed
                ? "bg-success-w text-white border-success-w"
                : "bg-card border-border hover:border-caution-w/50 hover:text-caution-w",
              "disabled:opacity-50 disabled:pointer-events-none"
            )}
          >
            {dispute.isPending ? "…" : isSelectedDisputed ? T.ops.drill.resolve : T.ops.drill.flag}
          </button>
        </div>
        {disputedInvoices.length > 0 && (
          <div className="type-caption text-ink-400 mt-2">
            {disputedInvoices.map((i) => i.externalRef).join(", ")}
          </div>
        )}
      </div>

      <E07DrillCard reason={reason} />

      <CanaryCard reason={reason} />
    </>
  );
}

/* ── Canary phase (PRD 3.3 promotion lifecycle — the 5% traffic bucket) ── */
function CanaryCard({ reason }: { reason: string }) {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const { data } = useDecisions();
  const controls = useCanaryControls();
  const canary = data?.canary;
  const active = canary?.active === true;
  const diff = canary?.canaryDiff;
  const aed = (fils: number | null) =>
    fils === null ? "—" : lang === "ar" ? formatAedAr(fils) : formatAed(fils);

  const run = (action: "promote" | "withdraw") => {
    if (!reason || reason.trim().length < 3) {
      toast.error(T.ops.confirmTwoPerson);
      return;
    }
    controls.mutate(
      { action, reason },
      {
        onSuccess: (_res) => {
          toast.success(action === "promote" ? T.ops.canary.promotedToast : T.ops.canary.withdrawnToast, { duration: 6000 });
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : T.errors.generic),
      },
    );
  };

  return (
    <div className={cn("rounded-[10px] border bg-card p-4", active ? "border-accent-w/40" : "border-border")}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <SectionLabel>{T.ops.canary.title}</SectionLabel>
          <div className="type-caption text-ink-400 mt-0.5">{T.ops.canary.subtitle}</div>
        </div>
        <WlIcon name="rule-pack" size={16} className={cn("shrink-0", active ? "text-accent-w" : "text-ink-400")} />
      </div>

      {/* Live state strip — the lifecycle state is data, never a guess. */}
      <div
        className={cn(
          "mt-3 rounded-md border px-3 py-2.5 flex items-start gap-2",
          active ? "border-accent-w/40 bg-accent-w-soft" : "border-border bg-surface-2/50",
        )}
      >
        <StatusDot tone={active ? "accent" : "neutral"} pulse={active} />
        <div className="min-w-0">
          {active && canary ? (
            <>
              <div className="type-caption font-semibold text-accent-w-dark">
                {T.ops.canary.live} — {(canary.trafficPermyriad / 100).toFixed(1)}% {T.ops.canary.traffic} · {canary.candidateVersion}
              </div>
              <div className="type-caption text-ink-600 mt-0.5" dir="auto">
                {T.ops.canary.since} {new Date(canary.since ?? "").toLocaleString(lang === "ar" ? "ar-AE" : "en-AE", { dateStyle: "medium", timeStyle: "short" })} · {T.ops.canary.by} {canary.promotedBy}
              </div>
            </>
          ) : (
            <div className="type-caption text-ink-600">{T.ops.canary.idle}</div>
          )}
        </div>
      </div>

      {/* The canary diff — what the routed traffic received vs the base
          counterfactual. Advisory, complete arithmetic. */}
      {diff && diff.routed > 0 ? (
        <>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
              <div className="type-caption text-ink-400">{T.ops.canary.routed}</div>
              <div className="type-body-strong">{diff.routed}</div>
            </div>
            <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
              <div className="type-caption text-ink-400">{T.ops.canary.gained}</div>
              <div className={cn("type-body-strong", diff.approvalsGained > 0 && "text-success-w-dark")}>{diff.approvalsGained}</div>
            </div>
            <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
              <div className="type-caption text-ink-400">{T.ops.canary.lost}</div>
              <div className={cn("type-body-strong", diff.approvalsLost > 0 && "text-danger-w")}>{diff.approvalsLost}</div>
            </div>
            <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
              <div className="type-caption text-ink-400">{T.ops.canary.limitMoves}</div>
              <div className={cn("type-body-strong", diff.limitMoves > 0 && "text-accent-w-dark")}>{diff.limitMoves}</div>
            </div>
            <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
              <div className="type-caption text-ink-400">{T.ops.canary.priceMoves}</div>
              <div className={cn("type-body-strong", diff.priceMoves > 0 && "text-accent-w-dark")}>{diff.priceMoves}</div>
            </div>
          </div>
          {diff.examples.map((ex, i) => (
            <div key={i} className="type-caption text-ink-600 mt-1 truncate" dir="auto">
              {ex.label}: {ex.canaryOutcome} {aed(ex.canaryLimitFils)} → base {ex.baseOutcome} {aed(ex.baseLimitFils)}
            </div>
          ))}
        </>
      ) : (
        <div className="type-caption text-ink-400 mt-3">{T.ops.canary.noRoutes}</div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          disabled={controls.isPending || active}
          onClick={() => run("promote")}
          className={cn(
            "h-10 px-4 rounded-md type-caption font-semibold press-scale border shrink-0",
            "bg-card border-border hover:border-accent-w/60 hover:text-accent-w-dark",
            "disabled:opacity-50 disabled:pointer-events-none"
          )}
        >
          {controls.isPending && controls.variables?.action === "promote" ? T.ops.canary.promoting : T.ops.canary.promote}
        </button>
        <button
          type="button"
          disabled={controls.isPending || !active}
          onClick={() => run("withdraw")}
          className={cn(
            "h-10 px-4 rounded-md type-caption font-semibold press-scale border shrink-0",
            "bg-card border-border hover:border-caution-w/50 hover:text-caution-w",
            "disabled:opacity-50 disabled:pointer-events-none"
          )}
        >
          {controls.isPending && controls.variables?.action === "withdraw" ? T.ops.canary.withdrawing : T.ops.canary.withdraw}
        </button>
      </div>
      <div className="type-caption text-ink-400 mt-2" dir="auto">{T.ops.canary.note}</div>
    </div>
  );
}

/* ── Decisions tab ─────────────────────────────────────────────────────── */
function DecisionRow({ d }: { d: DecisionDto }) {
  const T = t(useUi((s) => s.lang));
  const replay = useReplayDecision();
  const [result, setResult] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  const outcomeTone = d.outcome === "approved" ? "success" : d.outcome === "capped" ? "accent" : "caution";

  return (
    <div className="rounded-[10px] border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusDot tone={outcomeTone} />
            <span className="type-body-strong">{d.subjectLabel ?? d.subjectRef}</span>
            <span className="type-mono text-[11px] text-ink-400">{d.decisionType}</span>
            {d.shadow && <span className="type-label text-caution-w">{T.ops.shadow}</span>}
            {d.canary && (
              <span className="type-label text-accent-w-dark border border-accent-w/40 bg-accent-w-soft rounded-full px-2 py-0.5">
                {T.ops.canary.liveChip}
              </span>
            )}
          </div>
          <div className="type-caption text-ink-400 mt-0.5 truncate">{d.reasonText}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {d.limitFils != null && <Money fils={d.limitFils} size="caption" animate={false} />}
          {d.priceMilliBpsPerDay != null && (
            <span className="type-caption text-ink-400 money">{(d.priceMilliBpsPerDay / 10).toFixed(1)} bps/d</span>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="h-8 px-2.5 rounded-md border border-border type-caption text-ink-600 press-scale flex items-center gap-1.5"
        >
          <WlIcon name="audit-record" size={13} />
          {T.ops.inputHash}
        </button>
        <CopyRef value={d.id} />
        <button
          type="button"
          disabled={replay.isPending}
          onClick={() => replay.mutate(d.id, { onSuccess: (r) => setResult(r.matchesOriginal) })}
          className="h-8 px-2.5 rounded-md border border-accent-w/40 text-accent-w-dark type-caption font-semibold press-scale flex items-center gap-1.5 disabled:opacity-50"
        >
          <WlIcon name="undo" size={13} />
          {T.ops.replay}
        </button>
        {result === true && <span className="type-caption text-success-w">✓ {T.ops.replayOk}</span>}
        {result === false && <span className="type-caption text-danger-w">✗ {T.ops.replayFail}</span>}
      </div>

      {open && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap type-caption text-ink-400">
            <span className="type-label">{T.ops.rulepack}</span>
            <span className="type-mono text-[11px]">{d.rulepackVersion}</span>
            <span className="type-label">{T.ops.inputHash}</span>
            <span className="type-mono text-[11px] truncate max-w-[220px]">{d.inputHash}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap type-caption text-ink-400">
            <span className="type-label">{T.invoices.reasonWhy}</span>
            <span className="type-mono text-[11px]">{d.reasonCode}</span>
            <span className="type-label">rule</span>
            <span className="type-mono text-[11px]">{d.bindingRule}</span>
          </div>
          <details>
            <summary className="type-caption text-ink-400 cursor-pointer">{T.ops.snapshot}</summary>
            <pre className="mt-1.5 max-h-48 overflow-auto wl-scroll rounded-md bg-surface-2 p-2.5 type-mono text-[10px] leading-relaxed">
              {JSON.stringify(d.featureSnapshot, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function DecisionsTab() {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const { data, isLoading } = useDecisions();
  const [filter, setFilter] = useState<string>("all");
  const decisions = (data?.decisions ?? []).filter((d) => filter === "all" || d.outcome === filter);
  const sd = data?.shadowDiff;
  const canary = data?.canary;
  const aed = (fils: number | null) =>
    fils === null ? "—" : lang === "ar" ? formatAedAr(fils) : formatAed(fils);

  return (
    <div className="space-y-3">
      {/* Shadow pack (PRD 3.3 promotion lifecycle, phase 2) — the candidate
          scores every live decision in parallel; this panel is the review.
          When the canary is live, a chip says so — the lifecycle state is
          published data, never guessed. */}
      {sd && (
        <div className="rounded-[10px] border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SectionLabel>{T.ops.shadowPack.title}</SectionLabel>
                {canary?.active && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-w/40 bg-accent-w-soft px-2 py-0.5 type-caption text-accent-w-dark font-semibold">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent-w animate-pulse" />
                    {T.ops.canary.liveChip}
                  </span>
                )}
              </div>
              <div className="type-caption text-ink-400 mt-0.5">{T.ops.shadowPack.subtitle}</div>
            </div>
            <span className="type-mono text-[11px] text-ink-400 shrink-0">{sd.candidateVersion}</span>
          </div>
          <div className="mt-3 rounded-md border border-border bg-surface-2/50 p-3">
            <div className="type-caption text-ink-400 font-semibold">{T.ops.shadowPack.deltaTitle}</div>
            <div className="mt-1.5 space-y-1">
              {sd.delta.map((d) => (
                <div key={d.field} className="flex items-baseline justify-between gap-2 type-caption">
                  <span className="text-ink-600 min-w-0">{d.field}</span>
                  <span className="type-mono text-[11px] whitespace-nowrap">
                    <span className="text-ink-400">{d.from}</span>
                    <span className="text-ink-400 mx-1">→</span>
                    <span className="text-accent-w-dark font-semibold">{d.to}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {sd.shadowPairs === 0 ? (
            <div className="type-caption text-ink-400 mt-3">{T.ops.shadowPack.noData}</div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
                  <div className="type-caption text-ink-400">{T.ops.shadowPack.pairs}</div>
                  <div className="type-body-strong">{sd.shadowPairs}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
                  <div className="type-caption text-ink-400">{T.ops.shadowPack.approvalsGained}</div>
                  <div className={cn("type-body-strong", sd.approvalsGained > 0 && "text-success-w-dark")}>{sd.approvalsGained}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
                  <div className="type-caption text-ink-400">{T.ops.shadowPack.approvalsLost}</div>
                  <div className={cn("type-body-strong", sd.approvalsLost > 0 && "text-danger-w")}>{sd.approvalsLost}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
                  <div className="type-caption text-ink-400">{T.ops.shadowPack.limitMoves}</div>
                  <div className={cn("type-body-strong", sd.limitMoves > 0 && "text-accent-w-dark")}>{sd.limitMoves}</div>
                </div>
                <div className="rounded-md border border-border bg-surface-2/50 p-2.5">
                  <div className="type-caption text-ink-400">{T.ops.shadowPack.priceMoves}</div>
                  <div className={cn("type-body-strong", sd.priceMoves > 0 && "text-accent-w-dark")}>{sd.priceMoves}</div>
                </div>
              </div>
              {sd.examples.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {sd.examples.map((ex, i) => (
                    <div key={i} className="type-caption text-ink-600 truncate" dir="auto">
                      {T.ops.shadowPack.example(
                        ex.label,
                        `${ex.liveOutcome} ${aed(ex.liveLimitFils)}`,
                        `${ex.shadowOutcome} ${aed(ex.shadowLimitFils)}`,
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="type-caption text-ink-400 mt-2" dir="auto">{sd.note}</div>
            </>
          )}
        </div>
      )}
      <div className="flex gap-1.5">
        {["all", "approved", "capped", "rejected"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 h-8 rounded-full border type-caption press-scale",
              filter === f ? "border-accent-w bg-accent-w-soft text-accent-w-dark font-semibold" : "border-border text-ink-600"
            )}
          >
            {f}
          </button>
        ))}
      </div>
      {isLoading ? (
        <SkeletonCard lines={5} />
      ) : (
        <div className="space-y-2.5 max-h-[calc(100vh-18rem)] overflow-y-auto wl-scroll pe-1">
          {decisions.map((d) => <DecisionRow key={d.id} d={d} />)}
        </div>
      )}
      <div className="type-caption text-ink-400">
        {T.ops.replay}: {T.ops.replayOk.toLowerCase()}
      </div>
    </div>
  );
}

/* ── Audit tab ─────────────────────────────────────────────────────────── */
function AuditTab() {
  const T = t(useUi((s) => s.lang));
  const { data, isLoading } = useAudit();
  const [showConsents, setShowConsents] = useState(false);
  const { data: consents } = useConsents();
  const revoke = useRevokeConsent();
  const grant = useGrantConsent();

  if (isLoading || !data) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-4">
      {/* integrity + counts */}
      <div className="grid sm:grid-cols-3 gap-2.5">
        <div className={cn("rounded-[10px] border p-3.5", data.integrity.balanced ? "border-success-w/40 bg-success-w/5" : "border-danger-w/40 bg-danger-w/5")}>
          <div className="flex items-center gap-2">
            <StatusDot tone={data.integrity.balanced ? "success" : "danger"} />
            <span className="type-body-strong">{T.ops.ledgerIntegrity}</span>
          </div>
          <div className="type-caption mt-1 text-ink-600">
            {data.integrity.balanced ? T.ops.balanced : T.ops.breaksFound(data.integrity.breaks.length)}
            {" · "}{data.integrity.txns} txns
          </div>
        </div>
        <div className="rounded-[10px] border border-border bg-card p-3.5">
          <div className="type-label text-ink-400">{T.ops.payoutTotals}</div>
          <div className="type-heading mt-1 money">{data.counts.payoutsSettled}</div>
          <div className="type-caption text-ink-400 mt-0.5">{T.ops.offersAccepted}: {data.counts.offersAccepted}</div>
        </div>
        <div className="rounded-[10px] border border-border bg-card p-3.5">
          <div className="type-label text-ink-400">{T.ops.rounding}</div>
          <Money fils={data.roundingBalanceFils} size="heading" animate={false} className="mt-1" />
          <div className="type-caption text-ink-400 mt-0.5">{T.ops.decisions}: {data.counts.decisions}</div>
        </div>
      </div>

      {/* consents (PDPL data-subject controls) */}
      <div>
        <button
          type="button"
          onClick={() => setShowConsents(!showConsents)}
          className="w-full flex items-center justify-between rounded-[10px] border border-border bg-card p-3.5 press-scale"
        >
          <span className="type-body-strong">{T.consents.title}</span>
          <WlIcon name="chevron" size={15} className={cn("text-ink-400 transition-transform", showConsents && "rotate-90")} />
        </button>
        {showConsents && (
          <div className="mt-2 space-y-2">
            {(consents?.consents ?? []).map((c) => {
              // The dict maps purpose → label string and `${purpose}_hint` → hint
              // string; look both up directly (no object shape to mis-cast).
              const meta = T.consents as unknown as Record<string, string>;
              const label = meta[c.purpose] ?? c.purpose;
              const hint = meta[`${c.purpose}_hint`];
              const revoked = !!c.revokedAt;
              return (
                <div key={c.id} className={cn("rounded-[10px] border p-3 flex items-center justify-between gap-3", revoked ? "border-border bg-surface-2/50 opacity-70" : "border-border bg-card")}>
                  <div className="min-w-0">
                    <div className="type-body-strong">{label}</div>
                    {hint && <div className="type-caption text-ink-400">{hint}</div>}
                    {revoked && <div className="type-caption text-danger-w mt-0.5">{T.consents.revoked}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => (revoked ? grant.mutate(c.purpose) : revoke.mutate(c.id))}
                    className={cn(
                      "h-9 px-3 rounded-md type-caption font-semibold press-scale shrink-0 border",
                      revoked
                        ? "border-accent-w/40 text-accent-w-dark bg-accent-w-soft"
                        : "border-border text-ink-600 hover:border-danger-w/40 hover:text-danger-w"
                    )}
                  >
                    {revoked ? T.consents.grant : T.consents.revoke}
                  </button>
                </div>
              );
            })}
            <div className="type-caption text-ink-400 ps-1">{T.consents.revokesIn60s}</div>
          </div>
        )}
      </div>

      {/* ledger entries */}
      <div>
        <SectionLabel className="mb-2">{T.ops.entries}</SectionLabel>
        <div className="rounded-[10px] border border-border bg-card divide-y divide-border/60 max-h-80 overflow-y-auto wl-scroll">
          {data.entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("type-caption font-semibold", e.direction === "debit" ? "text-accent-w-deep dark:text-accent-w" : "text-caution-w")}>
                    {e.direction === "debit" ? "DR" : "CR"}
                  </span>
                  <span className="type-mono text-[11px] truncate">{e.accountCode}</span>
                </div>
                {e.memo && <div className="type-caption text-ink-400 truncate">{e.memo}</div>}
              </div>
              <div className="text-end shrink-0">
                <Money fils={e.amountFils} size="caption" animate={false} />
                <div className="type-caption text-ink-400 type-mono text-[10px]">{e.txnId.slice(0, 14)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── The view ──────────────────────────────────────────────────────────── */
export function OpsView() {
  const T = t(useUi((s) => s.lang));
  const [tab, setTab] = useState<"status" | "decisions" | "audit">("status");

  const tabs = [
    { key: "status" as const, label: T.ops.tabStatus },
    { key: "decisions" as const, label: T.ops.tabDecisions },
    { key: "audit" as const, label: T.ops.tabAudit },
  ];

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <h1 className="type-title">{T.ops.title}</h1>
        <p className="type-caption text-ink-400">{T.ops.subtitle}</p>
      </div>

      <div className="flex gap-1.5 mb-4 border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3.5 h-10 -mb-px border-b-2 type-body-strong press-scale transition-colors",
              tab === t.key ? "border-accent-w text-accent-w-dark dark:text-accent-w" : "border-transparent text-ink-400 hover:text-ink-600"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "status" && <StatusTab />}
      {tab === "decisions" && <DecisionsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}
