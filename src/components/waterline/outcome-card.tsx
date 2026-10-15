"use client";

// WATERLINE — rule rejection is NOT an error. It is a neutral outcome card
// with the plain-language reason and the specific path to becoming
// eligible (PRD 11.11). When the binding rule is one the advisor can
// explain concretely (the portfolio ceiling, caps), the card offers an
// "Ask the advisor" deep-link that pre-fills the question — the SME owns
// the question, the advisor explains, the rule pack still decides.

import { WlIcon } from "./icons";
import { DecisionReceipt } from "./decision-receipt";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import type { DecisionDto } from "@/lib/types";

/** Rejections whose story the advisor can tell from live facts. */
const ADVISORABLE = new Set(["E_PORTFOLIO", "E_ENTITY_CAP", "E_BUYER_CAP", "E_SECTOR_CAP", "E_MIN_SIZE"]);

export function OutcomeCard({ decision, className }: { decision: DecisionDto; className?: string }) {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const askAdvisor = useUi((s) => s.askAdvisor);

  const askable = ADVISORABLE.has(decision.reasonCode);
  const question =
    lang === "ar"
      ? `لماذا رُفضت الفاتورة بسبب ${decision.reasonCode}؟ وما الذي يغيّر ذلك؟`
      : `Why was this invoice declined with ${decision.reasonCode}, and what changes it?`;

  return (
    <div className={className}>
      <div className="grad-lift rounded-[10px] border border-border p-4 elev-1">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-9 w-9 rounded-full bg-surface-2 border border-border flex items-center justify-center shrink-0">
            <WlIcon name="invoice" size={18} className="text-ink-400" />
          </div>
          <div className="min-w-0">
            <div className="type-heading">{T.invoices.rejectedTitle}</div>
            <p className="type-body text-ink-600 mt-1">{decision.reasonText}</p>
            {askable && (
              <button
                type="button"
                onClick={() => askAdvisor(question)}
                className="mt-2.5 inline-flex items-center gap-1.5 type-body-strong text-accent-w-dark dark:text-accent-money underline decoration-accent-w/40 underline-offset-4 hover:decoration-accent-w press-scale"
              >
                <WlIcon name="advisor" size={15} />
                {T.invoices.askWhy}
                <span className="sr-only">{T.invoices.askWhyHint}</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <DecisionReceipt decision={decision} className="mt-3" />
    </div>
  );
}
