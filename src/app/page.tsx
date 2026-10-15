"use client";

// WATERLINE — the product, embedded as a tile inside du Business.
// Route transition: 160 ms crossfade with a 12px directional offset,
// mirrored under RTL (PRD 11.12).

import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "@/components/waterline/app-shell";
import { CashView } from "@/views/cash-view";
import { InvoicesView } from "@/views/invoices-view";
import { EscrowView } from "@/views/escrow-view";
import { ActivityView } from "@/views/activity-view";
import { OpsView } from "@/views/ops-view";
import { useUi, type View } from "@/stores/ui";

const VIEWS: Record<View, React.ComponentType> = {
  cash: CashView,
  invoices: InvoicesView,
  escrow: EscrowView,
  activity: ActivityView,
  ops: OpsView,
};

const ORDER: View[] = ["cash", "invoices", "escrow", "activity", "ops"];

export default function Page() {
  const view = useUi((s) => s.view);
  const lang = useUi((s) => s.lang);
  const Active = VIEWS[view];

  const dirOffset = ORDER.indexOf(view) - ORDER.indexOf(ORDER.find((v) => v === view) ?? "cash");
  const forward = dirOffset >= 0;
  const offset = (lang === "ar" ? -1 : 1) * (forward ? 12 : -12);

  return (
    <AppShell>
      {/* skip link to main content — keyboard users (PRD 11.14) */}
      <a
        href="#wl-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-accent-w focus:text-white type-body-strong"
      >
        Skip to main content
      </a>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          id="wl-main"
          initial={{ opacity: 0, x: offset }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -offset }}
          transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
          tabIndex={-1}
        >
          <Active />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}
