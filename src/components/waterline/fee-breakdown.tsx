"use client";

// WATERLINE — the fee breakdown and date slider. The fee is always expanded,
// never behind a disclosure: days early × rate × advance, in dirhams, before
// and after acceptance (PRD 11.1/11.8). The slider recomputes locally
// against the quoted rate — no server round trip, works on poor connectivity
// (PRD 4.3-02).

import { useMemo } from "react";
import { Money } from "./money";
import { feeFor } from "@/lib/ruleengine";
import { formatBps } from "@/lib/money";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface FeeModel {
  principalFils: number;
  rateMilliBps: number;
  maxDaysEarly: number;
}

function FeeRow({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between py-1.5 border-b border-border/60 last:border-0", strong && "pt-2.5")}>
      <span className={cn("type-caption text-ink-400", strong && "type-body text-foreground")}>{label}</span>
      {children}
    </div>
  );
}

export function FeeBreakdown({ model, daysEarly, className }: { model: FeeModel; daysEarly: number; className?: string }) {
  const T = t(useUi((s) => s.lang));
  const fee = feeFor(daysEarly, model.rateMilliBps, model.principalFils);
  const net = model.principalFils - fee;

  return (
    <div className={cn("rounded-[10px] border border-border bg-card p-4", className)}>
      <FeeRow label={T.invoices.daysEarly}>
        <span className="type-body-strong money">{daysEarly}</span>
      </FeeRow>
      <FeeRow label={T.invoices.ratePerDay}>
        <span className="type-body-strong money">{formatBps(model.rateMilliBps)}</span>
      </FeeRow>
      <FeeRow label={T.invoices.principal}>
        <Money fils={model.principalFils} size="body" animate={false} />
      </FeeRow>
      <FeeRow label={T.invoices.fee}>
        <Money fils={fee} size="body" colorize="accent" animate={false} />
      </FeeRow>
      <FeeRow label={T.invoices.netProceeds} strong>
        <Money fils={net} size="heading" colorize="accent" animate={false} />
      </FeeRow>
      <div className="type-caption text-ink-400 mt-2">{T.invoices.feeHint}</div>
    </div>
  );
}

export function DateSlider({
  model,
  daysEarly,
  onChange,
  disabled,
}: {
  model: FeeModel;
  daysEarly: number;
  onChange: (d: number) => void;
  disabled?: boolean;
}) {
  const T = t(useUi((s) => s.lang));
  const fee = useMemo(() => feeFor(daysEarly, model.rateMilliBps, model.principalFils), [daysEarly, model]);

  const ticks = useMemo(() => {
    const max = model.maxDaysEarly;
    const step = max > 30 ? 10 : max > 14 ? 5 : 2;
    const out: number[] = [];
    for (let d = 1; d <= max; d += step) out.push(d);
    if (out[out.length - 1] !== max) out.push(max);
    return out;
  }, [model.maxDaysEarly]);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="type-body-strong">{T.invoices.chooseDate}</span>
        <span className="type-caption text-ink-400">
          {T.invoices.daysEarly}: <span className="money type-body-strong text-accent-w">{daysEarly}</span>
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={Math.max(1, model.maxDaysEarly)}
        value={daysEarly}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="wl-slider w-full"
        aria-label={T.invoices.chooseDate}
        dir="ltr"
      />
      <div className="flex justify-between type-label text-ink-400 mt-0.5 select-none" dir="ltr">
        {ticks.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => onChange(d)}
            className={cn(
              "px-1 py-0.5 rounded transition-colors",
              daysEarly === d ? "text-accent-w" : "hover:text-ink-600"
            )}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 type-caption">
        <span className="text-ink-400">{T.invoices.settleOn}</span>
        <Money fils={model.principalFils - fee} size="caption" colorize="accent" />
      </div>
    </div>
  );
}
