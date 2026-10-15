"use client";

// WATERLINE — invoice card: buyer, amount, due date, verification state and
// a single primary action. Never more than one primary per card (PRD 11.8).

import { motion } from "framer-motion";
import { Money } from "./money";
import { StatusDot, TierChip, SectionLabel } from "./primitives";
import { WlIcon, type WlIconName } from "./icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import type { InvoiceDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const stateTone: Record<string, "success" | "caution" | "danger" | "neutral" | "accent"> = {
  verified: "success",
  deduped: "caution",
  received: "neutral",
  parsed: "neutral",
  disputed: "danger",
  unverifiable: "danger",
  superseded: "neutral",
  duplicate: "danger",
};

const stateIcon: Record<string, WlIconName> = {
  verified: "invoice-verified",
  deduped: "invoice",
  received: "invoice",
  parsed: "invoice",
  disputed: "invoice-disputed",
  unverifiable: "invoice-disputed",
  superseded: "invoice",
  duplicate: "invoice-disputed",
};

export function InvoiceCard({
  invoice,
  onOpen,
  index = 0,
}: {
  invoice: InvoiceDto;
  onOpen: (id: string) => void;
  index?: number;
}) {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const state = invoice.verificationState;
  const funded = invoice.fundingState === "accepted" || invoice.fundingState === "settled";
  const overdue = invoice.dueInDays < 0;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: Math.min(index * 0.02, 0.16) }}
      onClick={() => onOpen(invoice.id)}
      className="w-full text-start grad-lift rounded-[10px] border border-border hover:border-ink-200 dark:hover:border-ink-600 p-4 elev-1 hover:elev-2 transition-shadow press-scale focus-visible:border-accent-w"
      aria-label={`${invoice.externalRef} — ${invoice.buyer?.buyerName ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="type-body-strong truncate">{invoice.buyer?.buyerName ?? invoice.buyerLinkId}</span>
            {invoice.buyer?.tier && <TierChip tier={invoice.buyer.tier} />}
          </div>
          <div className="type-caption text-ink-400 mt-0.5 type-mono text-[12px]">{invoice.externalRef}</div>
        </div>
        <div className="text-end shrink-0">
          <Money fils={invoice.grossFils} size="heading" whole={false} />
          <div className={cn("type-caption mt-0.5 money", overdue ? "text-danger-w" : "text-ink-400")}>
            {overdue ? T.invoices.overdue(-invoice.dueInDays) : T.invoices.dueIn(invoice.dueInDays)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <StatusDot tone={stateTone[state] ?? "neutral"} pulse={state === "deduped"} />
          <span className="type-caption text-ink-600">
            {T.invoices.stateLabels[state] ?? state}
            {invoice.verifiedVia && T.invoices.verifiedVia[invoice.verifiedVia as keyof typeof T.invoices.verifiedVia] ? (
              <span className="text-ink-400"> · {T.invoices.verifiedVia[invoice.verifiedVia as keyof typeof T.invoices.verifiedVia]}</span>
            ) : null}
          </span>
        </div>

        {funded ? (
          invoice.payoutState === "queued" ? (
            <span className="type-label px-2 py-1 rounded-sm bg-caution-w/10 text-caution-w border border-caution-w/30 flex items-center gap-1.5">
              <WlIcon name="clock" size={12} />
              {T.invoices.queuedTitle}
            </span>
          ) : (
            <span className="type-label px-2 py-1 rounded-sm bg-success-w/10 text-success-w border border-success-w/30">
              {invoice.fundingState === "settled" ? T.invoices.settled : T.invoices.funded}
            </span>
          )
        ) : state === "verified" && !overdue ? (
          <span className="type-label px-2.5 py-1.5 rounded-md grad-liquidity text-white flex items-center gap-1.5 elev-1 press-scale">
            <WlIcon name="arrow-out" size={13} />
            {T.invoices.getQuote}
          </span>
        ) : state === "deduped" ? (
          <span className="type-label px-2.5 py-1.5 rounded-md bg-accent-w-soft text-accent-w-dark border border-accent-w/30 flex items-center gap-1.5">
            <WlIcon name="invoice" size={13} />
            {T.invoices.waitingBuyer}
          </span>
        ) : (
          <WlIcon name={stateIcon[state] ?? "invoice"} size={16} className="text-ink-400" />
        )}
      </div>
    </motion.button>
  );
}

export function InvoiceListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="grad-lift rounded-[10px] border border-border p-4">
          <div className="flex justify-between">
            <div className="space-y-2 w-2/5">
              <div className="shimmer h-4 rounded" />
              <div className="shimmer h-3 w-2/3 rounded" />
            </div>
            <div className="shimmer h-6 w-24 rounded" />
          </div>
          <div className="shimmer h-3 w-1/3 rounded mt-3" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = "invoice", title, hint }: { icon?: WlIconName; title: string; hint?: string }) {
  return (
    <div className="grad-lift rounded-[10px] border border-dashed border-ink-200 dark:border-ink-600 p-8 text-center">
      {/* the waterline motif lives in the empty state (PRD 11.6) */}
      <div className="mx-auto w-24 h-10 relative mb-3">
        <div className="absolute inset-x-0 top-2 h-px bg-ink-200 dark:bg-ink-600" />
        <div className="absolute inset-x-0 top-3 h-[2px] bg-accent-w/50" />
        <WlIcon name={icon} size={20} className="absolute -top-1 start-0 text-ink-400" />
      </div>
      <div className="type-body-strong text-ink-600">{title}</div>
      {hint && <div className="type-caption text-ink-400 mt-1">{hint}</div>}
    </div>
  );
}

export function ListHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <SectionLabel>{title}</SectionLabel>
      {count !== undefined && <span className="type-caption text-ink-400 money">{count}</span>}
    </div>
  );
}
