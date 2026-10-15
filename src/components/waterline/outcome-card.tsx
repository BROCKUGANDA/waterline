"use client";

// WATERLINE — rule rejection is NOT an error. It is a neutral outcome card
// with the plain-language reason and the specific path to becoming
// eligible (PRD 11.11).

import { WlIcon } from "./icons";
import { DecisionReceipt } from "./decision-receipt";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import type { DecisionDto } from "@/lib/types";

export function OutcomeCard({ decision, className }: { decision: DecisionDto; className?: string }) {
  const T = t(useUi((s) => s.lang));

  return (
    <div className={className}>
      <div className="grad-lift rounded-[10px] border border-border p-4 elev-1">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-9 w-9 rounded-full bg-surface-2 border border-border flex items-center justify-center">
            <WlIcon name="invoice" size={18} className="text-ink-400" />
          </div>
          <div className="min-w-0">
            <div className="type-heading">{T.invoices.rejectedTitle}</div>
            <p className="type-body text-ink-600 mt-1">{decision.reasonText}</p>
          </div>
        </div>
      </div>
      <DecisionReceipt decision={decision} className="mt-3" />
    </div>
  );
}
