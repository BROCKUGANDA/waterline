"use client";

// WATERLINE — money-in-motion: the four named stages with real timestamps
// (Accepted → Reserved → Sent → Settled), honest indeterminate display and
// the no-duplicate-payment reassurance. Processing states show elapsed time
// and expected completion — never fabricated progress (PRD 11.13).

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Money } from "./money";
import { StatusDot } from "./primitives";
import { WlIcon } from "./icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import type { PayoutDto } from "@/lib/types";
import { cn } from "@/lib/utils";

function fmtElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/** Derive the four stages from a raw payout record when the computed
 *  stages array is not yet present (e.g. straight after acceptance). */
function stagesOf(p: PayoutDto): PayoutStage[] {
  if (p.stages?.length) return p.stages;
  const iso = (d: string | null | undefined) => (d ? new Date(d).toISOString() : null);
  return [
    { key: "accepted", label: "Accepted", at: iso(p.acceptedAt) },
    { key: "reserved", label: "Reserved", at: iso((p as unknown as { reservedAt?: string }).reservedAt) },
    { key: "sent", label: "Sent", at: iso((p as unknown as { sentAt?: string }).sentAt) },
    { key: "settled", label: "Settled", at: iso((p as unknown as { settledAt?: string }).settledAt) },
  ];
}

function stageIndexOf(p: PayoutDto): number {
  if (typeof p.stageIndex === "number") return p.stageIndex;
  const order = ["accepted", "reserved", "sent", "settled"];
  return Math.max(0, order.indexOf(p.state));
}

export function StageTracker({ payout, amountFils }: { payout: PayoutDto; amountFils: number }) {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (payout.state === "settled") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [payout.state]);

  const stages = stagesOf(payout);
  const stageIndex = stageIndexOf(payout);

  const labels: Record<string, string> = {
    accepted: T.invoices.stageAccepted,
    reserved: T.invoices.stageReserved,
    sent: T.invoices.stageSent,
    settled: T.invoices.stageSettled,
  };

  const elapsed = now - new Date(payout.acceptedAt).getTime();
  const etaLeft = Math.max(0, payout.etaSeconds * 1000 - elapsed);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <WlIcon name="clock" size={16} className="text-accent-w" />
          <span className="type-heading">{T.invoices.processing}</span>
        </div>
        <span className="type-caption text-ink-400 money">
          {payout.state === "settled" ? T.invoices.stageSettled : `${fmtElapsed(elapsed)} · ~${Math.ceil(etaLeft / 1000)}s`}
        </span>
      </div>

      <div className="flex items-center mb-3">
        <Money fils={amountFils} size="amount" colorize="accent" />
        <span className="type-caption text-ink-400 ms-2">→ {payout.destinationRef}</span>
      </div>

      <ol className="relative ms-3">
        <div className="absolute inset-y-2 start-[5px] w-px bg-ink-200 dark:bg-ink-600" aria-hidden="true" />
        {stages.map((s, i) => {
          const done = s.at !== null;
          const active = i === stageIndex && !done;
          return (
            <li key={s.key} className="relative flex items-center gap-3 pb-3.5 last:pb-0">
              <span className="relative z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-card">
                {done ? (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.24, ease: [0, 0, 0, 1] }}
                    className="h-2.5 w-2.5 rounded-full bg-success-w"
                  />
                ) : active ? (
                  <StatusDot tone="accent" pulse />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-ink-200 dark:border-ink-600" />
                )}
              </span>
              <div className="flex-1 flex items-baseline justify-between">
                <span className={cn("type-body-strong", !done && !active && "text-ink-400")}>
                  {labels[s.key] ?? s.label}
                </span>
                <span className="type-caption text-ink-400 money">
                  {s.at
                    ? new Date(s.at).toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-AE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                    : active ? "…" : "—"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 rounded-[10px] bg-accent-w-soft/70 border border-accent-w/25 p-3 flex gap-2.5">
        <WlIcon name="consent" size={16} className="text-accent-w-deep mt-0.5" />
        <div>
          <div className="type-caption text-accent-w-dark">{T.invoices.noDuplicate}</div>
          {payout.state !== "settled" && <div className="type-caption text-ink-400 mt-0.5">{T.invoices.stageHint}</div>}
        </div>
      </div>
    </div>
  );
}
