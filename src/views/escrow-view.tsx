"use client";

// WATERLINE — Escrow view: contract cards with the escrow.lock gradient
// header (the one permitted place), and the milestone tracker — a vertical
// stepper with state, evidence, approval actor and timestamp. WATERLINE
// never holds client money; the custodian bank does (PRD 4.4 / 11.3 / 11.8).

import { useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useEscrow, useMilestoneAction, useCreateEscrow, useOverview } from "@/hooks/waterline";
import { Money } from "@/components/waterline/money";
import { SectionLabel, StatusDot, SkeletonCard } from "@/components/waterline/primitives";
import { WlIcon } from "@/components/waterline/icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import { parseAedToFils } from "@/lib/money";
import type { EscrowContractDto, MilestoneDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const milestoneTone: Record<string, "success" | "caution" | "danger" | "accent" | "neutral"> = {
  released: "success",
  in_review: "caution",
  met: "accent",
  pending: "neutral",
  disputed: "danger",
};

const milestoneDot: Record<string, string> = {
  released: "bg-success-w",
  in_review: "bg-caution-w",
  met: "bg-accent-w",
  pending: "bg-ink-400",
  disputed: "bg-danger-w",
};

function MilestoneTracker({ contract, onAction }: { contract: EscrowContractDto; onAction: (m: MilestoneDto, action: string) => void }) {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <ol className="relative ms-4 mt-4">
      <div className="absolute inset-y-3 start-[7px] w-px bg-ink-200 dark:bg-ink-600" aria-hidden="true" />
      {contract.milestones.map((m) => {
        const tone = milestoneTone[m.state] ?? "neutral";
        const done = m.state === "released";
        return (
          <li key={m.id} className="relative pb-5 last:pb-0">
            <span className="absolute start-0 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-card border border-border">
              <span className={cn("h-2.5 w-2.5 rounded-full", milestoneDot[m.state] ?? "bg-ink-400")} />
            </span>
            <div className="ps-7">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span className="type-body-strong">
                    {contract.milestones.indexOf(m) + 1}. {m.description}
                  </span>
                  <div className="type-caption text-ink-400 mt-0.5">
                    {T.escrow.conditions[m.conditionType]}
                    {m.reviewWindowDays > 0 && ` · ${T.escrow.reviewWindow(m.reviewWindowDays)}`}
                  </div>
                </div>
                <Money fils={m.amountFils} size="body" animate={false} className={done ? "text-success-w" : ""} />
              </div>

              {/* state line */}
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <StatusDot tone={tone} pulse={m.state === "in_review"} />
                <span className="type-caption text-ink-600">
                  {m.state === "disputed" ? T.escrow.frozen
                    : m.state === "released" ? T.escrow.approvedBy(m.approvedBy ?? "—")
                    : m.state === "in_review" ? T.escrow.inReview
                    : T.escrow.milestone}
                </span>
                {m.evidenceRef && (
                  <span className="type-caption text-ink-400 flex items-center gap-1">
                    <WlIcon name="audit-record" size={12} />
                    {T.escrow.evidence}: <span className="type-mono text-[11px]">{m.evidenceRef}</span>
                  </span>
                )}
                {m.releasedAt && (
                  <span className="type-caption text-ink-400 money">
                    {new Date(m.releasedAt).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-AE", { day: "numeric", month: "short" })}
                  </span>
                )}
              </div>

              {/* actions — the disputed milestone freezes; others continue */}
              {m.state !== "released" && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {m.state === "pending" && m.conditionType !== "buyer_approval" && (
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => { setBusy(m.id); onAction(m, "mark_delivered"); }}
                      className="h-9 px-3 rounded-md border border-border type-caption hover:border-caution-w/50 hover:text-caution-w press-scale"
                    >
                      <WlIcon name="milestone" size={13} className="inline me-1" />
                      {T.escrow.markDelivered}
                    </button>
                  )}
                  {(m.state === "pending" || m.state === "in_review" || m.state === "met") && (
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => { setBusy(m.id); onAction(m, "approve"); }}
                      className="h-9 px-3 rounded-md bg-escrow-w/10 border border-escrow-w/40 text-escrow-w type-caption font-semibold press-scale"
                    >
                      <WlIcon name="escrow-lock" size={13} className="inline me-1" />
                      {T.escrow.approve}
                    </button>
                  )}
                  {m.state !== "disputed" && m.state !== "released" && (
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => { setBusy(m.id); onAction(m, "dispute"); }}
                      className="h-9 px-3 rounded-md border border-danger-w/30 text-danger-w type-caption press-scale"
                    >
                      {T.escrow.dispute}
                    </button>
                  )}
                  {m.state === "disputed" && (
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => { setBusy(m.id); onAction(m, "resolve"); }}
                      className="h-9 px-3 rounded-md bg-escrow-w text-white type-caption font-semibold press-scale"
                    >
                      {T.escrow.resolve}
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ContractCard({ contract }: { contract: EscrowContractDto }) {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const action = useMilestoneAction();
  const pct = contract.totalFils > 0 ? Math.round(((contract.releasedFils ?? 0) / contract.totalFils) * 100) : 0;

  const onAction = (m: MilestoneDto, act: string) => {
    const evidence = act === "resolve" ? `evidence-${Date.now().toString(36)}` : undefined;
    action.mutate(
      { contractId: contract.id, milestoneId: m.id, action: act, evidence },
      {
        onSuccess: () => {
          if (act === "approve" || act === "resolve") toast.success(T.escrow.releasedMsg);
          if (act === "mark_delivered") toast.success(T.escrow.inReview);
          if (act === "dispute") toast(T.escrow.frozen);
        },
        onError: () => toast.error(T.errors.generic),
      }
    );
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="rounded-[16px] border border-border bg-card overflow-hidden elev-1"
    >
      {/* escrow.lock gradient — escrow contract header only (PRD 11.3) */}
      <div className="grad-escrow-lock p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <WlIcon name="escrow-lock" size={18} />
              <span className="type-heading truncate">{contract.buyerName}</span>
            </div>
            <div className="type-caption text-white/80 mt-0.5 truncate">{contract.description}</div>
            <div className="type-caption text-white/70 type-mono text-[11px] mt-1">
              {T.escrow.custodian}: {contract.custodianRef}
            </div>
          </div>
          <div className="text-end shrink-0">
            <Money fils={contract.totalFils} size="heading" className="text-white" animate={false} />
            <div className="type-caption text-white/80 mt-0.5">
              {new Date(contract.createdAt).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-AE", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* release progress */}
        <div className="flex items-center gap-3 mb-1">
          <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-escrow-w"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.42, ease: [0.34, 1.3, 0.5, 1] }}
            />
          </div>
          <span className="type-caption text-ink-400 money">{pct}%</span>
        </div>
        <div className="flex justify-between type-caption text-ink-400 mb-3">
          <span>
            {T.escrow.released}: <Money fils={contract.releasedFils ?? 0} size="caption" colorize="success" animate={false} />
          </span>
          <span>
            {T.escrow.pending}: <Money fils={contract.pendingFils ?? contract.totalFils - (contract.releasedFils ?? 0)} size="caption" animate={false} />
          </span>
        </div>

        {contract.state === "completed" && (
          <div className="rounded-md bg-success-w/10 border border-success-w/40 p-2.5 mb-3 flex items-center gap-2">
            <StatusDot tone="success" />
            <span className="type-caption text-success-w">{T.escrow.completed}</span>
          </div>
        )}

        <SectionLabel className="mb-1">{T.escrow.milestonesLabel}</SectionLabel>
        <MilestoneTracker contract={contract} onAction={onAction} />

        <div className="mt-4 rounded-md bg-surface-2/70 border border-border/60 p-2.5 flex items-center gap-2">
          <WlIcon name="lock-solid" size={13} className="text-escrow-w" />
          <span className="type-caption text-ink-400">{T.escrow.neverHolds}</span>
        </div>
      </div>
    </motion.article>
  );
}

function NewContractDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const T = t(useUi((s) => s.lang));
  const create = useCreateEscrow();
  const { data: overview } = useOverview();
  const [buyerName, setBuyerName] = useState("");
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [milestones, setMilestones] = useState([{ description: "", amount: "", conditionType: "buyer_approval" }]);
  const [err, setErr] = useState<string | null>(null);

  const totalFils = parseAedToFils(total) ?? 0;
  const msFils = milestones.map((m) => parseAedToFils(m.amount) ?? 0);
  const sumOk = totalFils > 0 && msFils.reduce((a, b) => a + b, 0) === totalFils;

  const submit = async () => {
    setErr(null);
    if (!buyerName || !description || !sumOk) return setErr(T.escrow.sumError);
    try {
      await create.mutateAsync({
        buyerName,
        description,
        totalFils,
        milestones: milestones.map((m, i) => ({
          description: m.description || `Milestone ${i + 1}`,
          amountFils: msFils[i],
          conditionType: m.conditionType,
          reviewWindowDays: 3,
        })),
      });
      toast.success(T.escrow.created);
      onOpenChange(false);
      setBuyerName(""); setDescription(""); setTotal(""); setMilestones([{ description: "", amount: "", conditionType: "buyer_approval" }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : T.errors.generic);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-y-auto wl-scroll">
        <DialogHeader>
          <DialogTitle className="type-title">{T.escrow.newContract}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="type-label text-ink-400 block mb-1.5">{T.escrow.buyerName}</label>
              <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} list="escrow-buyers" className="w-full h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w" />
              <datalist id="escrow-buyers">
                {(overview?.buyers ?? []).map((b) => <option key={b.id} value={b.buyerName} />)}
              </datalist>
            </div>
            <div>
              <label className="type-label text-ink-400 block mb-1.5">{T.escrow.totalAmount}</label>
              <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="85,000" dir="ltr" className="w-full h-10 rounded-md border border-border bg-card px-3 type-body money outline-none focus:border-accent-w" />
            </div>
          </div>
          <div>
            <label className="type-label text-ink-400 block mb-1.5">{T.escrow.description}</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w" />
          </div>

          <SectionLabel>{T.escrow.milestonesLabel}</SectionLabel>
          <div className="space-y-2">
            {milestones.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={m.description}
                  onChange={(e) => setMilestones((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  placeholder={`Milestone ${i + 1}`}
                  className="flex-1 h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w"
                />
                <input
                  value={m.amount}
                  onChange={(e) => setMilestones((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  inputMode="decimal"
                  dir="ltr"
                  className="w-24 h-10 rounded-md border border-border bg-card px-3 type-body money outline-none focus:border-accent-w"
                />
                <select
                  value={m.conditionType}
                  onChange={(e) => setMilestones((arr) => arr.map((x, j) => (j === i ? { ...x, conditionType: e.target.value } : x)))}
                  className="h-10 rounded-md border border-border bg-card px-2 type-caption outline-none focus:border-accent-w"
                  aria-label={T.escrow.conditions.buyer_approval}
                >
                  <option value="buyer_approval">{T.escrow.conditions.buyer_approval}</option>
                  <option value="document_review">{T.escrow.conditions.document_review}</option>
                  <option value="time_release">{T.escrow.conditions.time_release}</option>
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => setMilestones((arr) => [...arr, { description: "", amount: "", conditionType: "buyer_approval" }])}
              className="h-9 px-3 rounded-md border border-dashed border-ink-200 dark:border-ink-600 type-caption text-ink-600 press-scale flex items-center gap-1.5"
            >
              <WlIcon name="plus" size={13} />
              {T.escrow.addMilestone}
            </button>
            <span className={cn("type-caption money", sumOk ? "text-success-w" : totalFils > 0 ? "text-caution-w" : "text-ink-400")}>
              {msFils.reduce((a, b) => a + b, 0) / 100} / {totalFils / 100}
            </span>
          </div>
          {err && <div className="type-caption text-danger-w">{err}</div>}
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending || !sumOk}
            className="w-full h-12 rounded-md grad-escrow-lock text-white type-body-strong press-scale disabled:opacity-50"
          >
            {create.isPending ? T.common.loading : T.escrow.newContract}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EscrowView() {
  const T = t(useUi((s) => s.lang));
  const { data, isLoading } = useEscrow();
  const [open, setOpen] = useState(false);
  const contracts = data?.contracts ?? [];
  const totalEscrow = contracts.reduce((a, c) => a + (c.state !== "completed" ? c.pendingFils ?? 0 : 0), 0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="type-title">{T.escrow.title}</h1>
          <p className="type-caption text-ink-400">{T.escrow.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 px-4 rounded-md grad-escrow-lock text-white type-body-strong press-scale elev-1 flex items-center gap-2"
        >
          <WlIcon name="plus" size={16} />
          <span className="hidden sm:inline">{T.escrow.newContract}</span>
        </button>
      </div>

      {totalEscrow > 0 && (
        <div className="my-4 rounded-[10px] border border-escrow-w/30 bg-escrow-w/5 p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <WlIcon name="lock-solid" size={16} className="text-escrow-w" />
            <span className="type-body text-ink-600">{T.escrow.lockedFunds}</span>
          </div>
          <Money fils={totalEscrow} size="heading" className="text-escrow-w" />
        </div>
      )}

      <div className="mt-4 space-y-5">
        {isLoading ? (
          <SkeletonCard lines={7} />
        ) : contracts.length === 0 ? (
          <div className="grad-lift rounded-[10px] border border-dashed border-ink-200 dark:border-ink-600 p-8 text-center">
            <div className="type-body-strong text-ink-600">{T.escrow.newContract}</div>
          </div>
        ) : (
          contracts.map((c) => <ContractCard key={c.id} contract={c} />)
        )}
      </div>

      <NewContractDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
