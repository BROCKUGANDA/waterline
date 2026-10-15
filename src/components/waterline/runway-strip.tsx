"use client";

// WATERLINE — cash runway strip: a horizontal 90-day forward view with
// obligation markers for payroll, rent and VAT. Tap a marker to see the
// detected obligation and its confidence (PRD 11.8).

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Money } from "./money";
import { SectionLabel } from "./primitives";
import { WlIcon, type WlIconName } from "./icons";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import type { ObligationDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const kindIcon: Record<string, WlIconName> = {
  payroll: "buyer",
  rent: "waterline",
  vat: "rule-pack",
  supplier: "invoice",
  du_bill: "wallet",
  custom: "plus",
};

const kindTone: Record<string, string> = {
  payroll: "bg-caution-w border-caution-w/50",
  rent: "bg-escrow-w border-escrow-w/50",
  vat: "bg-treasury-w border-treasury-w/50",
  supplier: "bg-accent-w border-accent-w/50",
  du_bill: "bg-accent-w border-accent-w/50",
  custom: "bg-ink-400 border-ink-400/50",
};

function kindLabel(kind: string, T: ReturnType<typeof t>["cash"]): string {
  const map: Record<string, string> = {
    payroll: T.payroll,
    rent: T.rent,
    vat: T.vat,
    supplier: T.supplier,
    du_bill: T.duBill,
    custom: T.custom,
  };
  return map[kind] ?? T.custom;
}

export function RunwayStrip({ obligations, walletFils }: { obligations: ObligationDto[]; walletFils: number }) {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const [selected, setSelected] = useState<ObligationDto | null>(null);

  const forward = obligations.filter((o) => {
    const d = new Date(o.dueDate).getTime();
    const days = (d - Date.now()) / 86_400_000;
    return days >= -1 && days <= 90;
  });

  const position = (o: ObligationDto) => {
    const days = Math.max(0, (new Date(o.dueDate).getTime() - Date.now()) / 86_400_000);
    return Math.min(100, (days / 90) * 100);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="type-heading">{T.cash.runway}</div>
          <div className="type-caption text-ink-400">{T.cash.runwayHint}</div>
        </div>
        <div className="text-end">
          <div className="type-label text-ink-400">{lang === "ar" ? "نقد اليوم" : "cash today"}</div>
          <Money fils={walletFils} size="caption" animate={false} className="text-ink-600" />
        </div>
      </div>

      <div className="relative h-14 grad-lift rounded-[10px] border border-border elev-1 overflow-visible">
        {/* the strip base — the waterline motif */}
        <div className="absolute inset-x-3 top-1/2 h-px bg-ink-200 dark:bg-ink-600" />
        <div className="absolute inset-x-3 top-1/2 h-[2px] bg-accent-w/25" style={{ transform: "translateY(1px)" }} />

        {/* quarter guides */}
        {[30, 60, 90].map((d) => (
          <div key={d} className="absolute top-1/2 h-3 w-px bg-ink-200 dark:bg-ink-600 -translate-y-1/2" style={{ [`${lang === "ar" ? "right" : "left"}`]: `${(d / 90) * 100}%` }} />
        ))}

        {/* obligation markers */}
        {forward.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setSelected(selected?.id === o.id ? null : o)}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rtl:translate-x-1/2 group"
            style={{ [`${lang === "ar" ? "right" : "left"}`]: `${position(o)}%` }}
            aria-label={`${kindLabel(o.kind, T.cash)} — ${o.label} — ${T.cash.confidence(Math.round(o.confidencePermyriad / 100))}`}
          >
            <span
              className={cn(
                "block h-3.5 w-3.5 rounded-full border-2 border-border elev-2 transition-transform",
                kindTone[o.kind] ?? kindTone.custom,
                "group-hover:scale-125 group-focus-visible:scale-125"
              )}
            />
          </button>
        ))}

        {/* day labels */}
        <div className="absolute inset-x-3 bottom-1 flex justify-between type-label text-ink-400 pointer-events-none">
          <span>{lang === "ar" ? "اليوم" : "today"}</span>
          <span>+30</span>
          <span>+60</span>
          <span>+90</span>
        </div>
      </div>

      {/* selected obligation popover (inline, 280px max) */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            className="mt-2 max-w-[280px] rounded-[10px] border border-border bg-card p-3 elev-2"
          >
            <div className="flex items-center gap-2">
              <WlIcon name={kindIcon[selected.kind] ?? "plus"} size={16} className="text-accent-w" />
              <span className="type-body-strong">{selected.label}</span>
              <span className="type-label text-ink-400 px-1.5 py-0.5 rounded-sm bg-surface-2">{kindLabel(selected.kind, T.cash)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <Money fils={selected.amountFils} size="body" whole={false} />
              <span className="type-caption text-ink-400">
                {T.cash.confidence(Math.round(selected.confidencePermyriad / 100))}
              </span>
            </div>
            <div className="type-caption text-ink-400 mt-0.5">
              {new Date(selected.dueDate).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-AE", { day: "numeric", month: "short" })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
