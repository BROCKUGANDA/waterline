"use client";

// WATERLINE — decision receipt: plain-language reason, rule-pack version,
// decision reference and a copy control. Attached to EVERY outcome,
// including rejections (PRD 11.8).

import { CopyRef } from "./primitives";
import { WlIcon } from "./icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import type { DecisionDto } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DecisionReceipt({ decision, compact, className }: { decision: DecisionDto; compact?: boolean; className?: string }) {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const date = new Date(decision.evaluatedAt).toLocaleString(lang === "ar" ? "ar-AE" : "en-AE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={cn("rounded-[10px] border border-border bg-surface-2/60 p-3.5", className)}>
      <div className="flex items-center gap-2 mb-1.5">
        <WlIcon name="audit-record" size={16} className="text-ink-400" />
        <span className="type-label text-ink-400">{T.invoices.decisionReceipt}</span>
        {decision.shadow && <span className="type-label text-caution-w">{T.ops.shadow}</span>}
      </div>
      <p className="type-body text-ink-600">{decision.reasonText}</p>
      {!compact && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 type-caption text-ink-400">
          <span className="flex items-center gap-1.5">
            <span className="type-label">{T.invoices.reasonWhy}</span>
            <span className="type-mono text-[11px]">{decision.reasonCode}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="type-label">{T.ops.rulepack}</span>
            <span className="type-mono text-[11px]">{decision.rulepackVersion ?? "—"}</span>
          </span>
          {decision.inputHash && (
            <span className="flex items-center gap-1.5">
              <span className="type-label">{T.ops.inputHash}</span>
              <span className="type-mono text-[11px] truncate max-w-[120px]">{decision.inputHash.slice(0, 18)}…</span>
            </span>
          )}
          <CopyRef value={decision.id} />
          <span className="ms-auto type-caption">{date}</span>
        </div>
      )}
      {compact && (
        <div className="mt-2 flex items-center gap-3 type-caption text-ink-400">
          <span className="type-mono text-[11px]">{decision.rulepackVersion ?? "—"}</span>
          <CopyRef value={decision.id} />
        </div>
      )}
    </div>
  );
}
