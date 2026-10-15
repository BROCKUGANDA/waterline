"use client";

// WATERLINE — Activity view: the append-only trail. Grouped by day,
// virtualised scroll above 60 rows equivalent (limit + custom scrollbar),
// every entry with a traceable subject reference (PRD 11.7 deep links).

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useActivity } from "@/hooks/waterline";
import { SectionLabel, SkeletonCard } from "@/components/waterline/primitives";
import { EmptyState } from "@/components/waterline/invoice-card";
import { WlIcon, type WlIconName } from "@/components/waterline/icons";
import { CopyRef } from "@/components/waterline/primitives";
import { t } from "@/lib/i18n";
import { renderActivityEventAr } from "@/lib/activity-ar";
import { useUi } from "@/stores/ui";
import type { ActivityEventDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const typeIcon: Record<string, WlIconName> = {
  "invoice.submitted": "invoice",
  "invoice.verified": "invoice-verified",
  "invoice.settled": "invoice-verified",
  "invoice.disputed": "invoice-disputed",
  "invoice.dispute_resolved": "invoice-verified",
  "decision.recorded": "rule-pack",
  "decision.replayed": "audit-record",
  "offer.accepted": "wallet",
  "payout.initiated": "arrow-out",
  "payout.queued": "clock",
  "payout.released": "arrow-out",
  "payout.state_changed": "clock",
  "payout.settled": "check",
  "escrow.awarded": "escrow-lock",
  "escrow.released": "milestone",
  "escrow.condition_met": "milestone",
  "escrow.disputed": "invoice-disputed",
  "escrow.completed": "check",
  "sweep.executed": "treasury-sweep",
  "sweep.recalled": "treasury-return",
  "treasury.policy_updated": "rule-pack",
  "treasury.obligation_added": "calendar",
  "consent.granted": "consent",
  "consent.revoked": "consent",
  "fraud.review": "alert",
  "guardrail.triggered": "alert",
  "status.changed": "status-degraded",
  "onboarding.completed": "buyer",
  "reserve.released": "arrow-in",
  "advisor.qa": "advisor",
  "canary.promoted": "rule-pack",
  "canary.withdrawn": "rule-pack",
  "canary.rolled_back": "status-degraded",
};

const typeTone: Record<string, string> = {
  "invoice.disputed": "text-danger-w bg-danger-w/10",
  "escrow.disputed": "text-danger-w bg-danger-w/10",
  "fraud.review": "text-danger-w bg-danger-w/10",
  "payout.settled": "text-success-w bg-success-w/10",
  "invoice.settled": "text-success-w bg-success-w/10",
  "invoice.dispute_resolved": "text-success-w bg-success-w/10",
  "guardrail.triggered": "text-caution-w bg-caution-w/10",
  "escrow.released": "text-escrow-w bg-escrow-w/10",
  "escrow.awarded": "text-escrow-w bg-escrow-w/10",
  "sweep.executed": "text-treasury-w bg-treasury-w/10",
  "sweep.recalled": "text-treasury-w bg-treasury-w/10",
  "offer.accepted": "text-accent-w bg-accent-w-soft",
  "payout.initiated": "text-accent-w bg-accent-w-soft",
  "payout.queued": "text-caution-w bg-caution-w/10",
  "payout.released": "text-accent-w bg-accent-w-soft",
  "advisor.qa": "text-accent-w bg-accent-w-soft",
  "canary.promoted": "text-accent-w bg-accent-w-soft",
  "canary.withdrawn": "text-caution-w bg-caution-w/10",
  "canary.rolled_back": "text-caution-w bg-caution-w/10",
};

function EventRow({ event, index }: { event: ActivityEventDto; index: number }) {
  const lang = useUi((s) => s.lang);
  const icon = typeIcon[event.type] ?? "activity";
  const tone = typeTone[event.type] ?? "text-ink-400 bg-surface-2";
  const time = new Date(event.occurredAt).toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-AE", { hour: "2-digit", minute: "2-digit" });
  // Arabic mirror rendered client-side from the structured facts; the English
  // server copy stays canonical and is the fallback for unknown types.
  const copy = lang === "ar" ? renderActivityEventAr(event) : { title: event.title, detail: event.detail };

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1], delay: Math.min(index * 0.015, 0.15) }}
      className="flex gap-3 py-3 border-b border-border/60 last:border-0"
    >
      <span className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0", tone)}>
        <WlIcon name={icon} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="type-body-strong truncate">{copy.title}</span>
          <span className="type-caption text-ink-400 money shrink-0">{time}</span>
        </div>
        {copy.detail && <div className="type-caption text-ink-600 mt-0.5 break-words">{copy.detail}</div>}
        {event.subjectRef && (
          <div className="mt-1">
            <CopyRef value={event.subjectRef} />
          </div>
        )}
      </div>
    </motion.li>
  );
}

export function ActivityView() {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const [limit, setLimit] = useState(50);
  const { data, isLoading, isFetching } = useActivity(limit);
  const events = data?.events ?? [];

  const grouped = useMemo(() => {
    const groups: { label: string; events: ActivityEventDto[] }[] = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86_400_000;
    let current: { label: string; events: ActivityEventDto[] } | null = null;
    for (const e of events) {
      const ts = new Date(e.occurredAt).getTime();
      const label =
        ts >= today ? T.activity.today
          : ts >= yesterday ? T.activity.yesterday
          : new Date(e.occurredAt).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-AE", { weekday: "long", day: "numeric", month: "short" });
      if (!current || current.label !== label) {
        current = { label, events: [] };
        groups.push(current);
      }
      current.events.push(e);
    }
    return groups;
  }, [events, T, lang]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="type-title">{T.activity.title}</h1>
          <p className="type-caption text-ink-400">{T.activity.subtitle}</p>
        </div>
        {isFetching && <WlIcon name="clock" size={16} className="text-ink-400 dot-pulse" />}
      </div>

      {isLoading ? (
        <SkeletonCard lines={6} />
      ) : events.length === 0 ? (
        <EmptyState icon="activity" title={T.activity.empty} />
      ) : (
        <div>
          {grouped.map((g) => (
            <section key={g.label} className="mb-2">
              {/* sticky section label with rule that appears beneath content */}
              <div className="sticky top-14 md:top-0 z-10 bg-background/95 backdrop-blur py-1.5">
                <div className="flex items-center gap-2">
                  <SectionLabel>{g.label}</SectionLabel>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </div>
              <ul className="ps-1">
                {g.events.map((e, i) => (
                  <EventRow key={e.id} event={e} index={i} />
                ))}
              </ul>
            </section>
          ))}
          {events.length >= limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + 50)}
              className="mt-4 w-full h-11 rounded-md border border-border type-caption text-ink-600 hover:border-accent-w/40 press-scale"
            >
              {T.common.viewAll}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
