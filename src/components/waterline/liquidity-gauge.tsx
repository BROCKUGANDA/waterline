"use client";

// WATERLINE — the signature widget: the vertical liquidity gauge. Shows
// available liquidity against total approved receivables with the waterline
// marking the floor. Animates on value change over 420 ms with spring
// easing — never on mount (PRD 11.8/11.12).

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Money } from "./money";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LiquidityGauge({
  walletFils,
  investedFils,
  floorFils,
  totalApprovedFils,
  className,
}: {
  walletFils: number;
  investedFils: number;
  floorFils: number;
  totalApprovedFils: number;
  className?: string;
}) {
  const T = t(useUi((s) => s.lang));
  const capacity = Math.max(totalApprovedFils, walletFils + investedFils + floorFils, 1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(id);
  }, []);

  const walletPct = (walletFils / capacity) * 100;
  const investedPct = (investedFils / capacity) * 100;
  const floorPct = Math.min(100, (floorFils / capacity) * 100);
  const approvedPct = Math.min(100, (totalApprovedFils / capacity) * 100);

  return (
    <div className={cn("flex gap-4", className)} role="img" aria-label={`${T.cash.gauge.available}: ${(walletFils + investedFils) / 100} AED`}>
      {/* The measuring column */}
      <div className="relative w-16 h-56 rounded-full bg-surface-2 border border-border overflow-hidden elev-1">
        {/* approved receivables reference zone */}
        <div
          className="absolute inset-x-0 top-0 bg-accent-w-soft"
          style={{ height: mounted ? `${approvedPct}%` : "0%", transition: "height 420ms cubic-bezier(0.34,1.3,0.5,1)" }}
        />
        {/* invested (treasury) fill */}
        <motion.div
          className="absolute inset-x-0 bottom-0 bg-treasury-w/80"
          initial={{ height: 0 }}
          animate={{ height: `${investedPct}%` }}
          transition={mounted ? { duration: 0.42, ease: [0.34, 1.3, 0.5, 1] } : { duration: 0 }}
        />
        {/* wallet fill — the liquidity gradient, permitted here */}
        <motion.div
          className="absolute inset-x-0 bottom-0 grad-liquidity"
          initial={{ height: 0 }}
          animate={{ height: `${walletPct}%` }}
          transition={mounted ? { duration: 0.42, ease: [0.34, 1.3, 0.5, 1] } : { duration: 0 }}
        />
        {/* The waterline — marks the floor */}
        <div
          className="absolute inset-x-0 flex items-center"
          style={{ bottom: `calc(${floorPct}% - 1px)` }}
        >
          <div className="h-[2px] flex-1 bg-ink-900 dark:bg-ink-800" />
          <div className="w-1.5 h-1.5 rounded-full bg-ink-900 dark:bg-ink-800 -ms-1.5 rtl:-me-1.5" />
        </div>
        {/* ruler ticks */}
        {[25, 50, 75].map((p) => (
          <div key={p} className="absolute inset-x-0 h-px bg-ink-200/60 dark:bg-ink-600/40" style={{ bottom: `${p}%` }} />
        ))}
      </div>

      {/* Read-outs — the headline is TOTAL liquidity (wallet + invested);
          the spendable wallet and invested components sit directly beneath,
          each with its own figure. "Available" would overstate — invested
          money must be recalled first (T+1, minimum size). */}
      <div className="flex flex-col justify-between py-0.5 min-w-0">
        <div>
          <div className="type-label text-ink-400">{T.cash.gauge.available}</div>
          <Money fils={walletFils + investedFils} size="amount" colorize="accent" className="mt-1" />
          <div className="type-caption text-ink-400 mt-1">
            {T.cash.walletBalance} <Money fils={walletFils} size="caption" animate={false} />
          </div>
          {investedFils > 0 && (
            <div className="type-caption text-treasury-w mt-0.5 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-treasury-w" aria-hidden="true" />
              {T.cash.invested} <Money fils={investedFils} size="caption" animate={false} />
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 bg-ink-900 dark:bg-ink-800" aria-hidden="true" />
            <span className="type-caption text-ink-600">
              {T.cash.gauge.floorMark} <Money fils={floorFils} size="caption" animate={false} />
            </span>
          </div>
          <div>
            <div className="type-label text-ink-400">{T.cash.gauge.total}</div>
            <Money fils={totalApprovedFils} size="body" animate={false} className="text-ink-600" />
          </div>
        </div>
      </div>
    </div>
  );
}
