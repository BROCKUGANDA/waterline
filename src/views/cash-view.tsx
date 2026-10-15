"use client";

// WATERLINE — Cash view. State before action: every surface tells the SME
// where its money is before offering to move it (PRD 11.1). The balance
// header collapses 180px→56px across the first 120px of scroll,
// interpolated to scroll position (PRD 11.12).

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useOverview, useTreasury, useForecast, useUpdatePolicy, useSweep, useRecall, useAddObligation } from "@/hooks/waterline";
import { LiquidityGauge } from "@/components/waterline/liquidity-gauge";
import { RunwayStrip } from "@/components/waterline/runway-strip";
import { ForecastChart } from "@/components/waterline/forecast-chart";
import { Money } from "@/components/waterline/money";
import { SectionLabel, StatusDot, SkeletonCard } from "@/components/waterline/primitives";
import { WlIcon } from "@/components/waterline/icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import { formatAed, formatAedAr } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Interpolated collapsing balance header. */
function BalanceHeader({ walletFils, asOf }: { walletFils: number; asOf: string }) {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    const onScroll = () => setScroll(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const p = Math.min(1, Math.max(0, scroll / 120)); // 0 → full, 1 → collapsed
  const height = 180 - 124 * p;
  const displaySize = 34 - 8 * p;
  const horizonOpacity = 1 - p;

  return (
    <div
      className="relative grad-horizon rounded-[16px] border border-border overflow-hidden sticky top-14 md:top-0 z-20 bg-card"
      style={{ height }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ opacity: horizonOpacity }}>
        <div className="absolute bottom-0 inset-x-4">
          <div className="waterline-rule" />
        </div>
      </div>
      <div className="h-full flex flex-col justify-center px-5">
        <SectionLabel>{T.cash.availableNow}</SectionLabel>
        <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 mt-1">
          <span
            className="money type-display text-accent-w-deep dark:text-accent-money"
            style={{ fontSize: displaySize, lineHeight: 1.1, transition: "font-size 100ms linear" }}
          >
            {lang === "ar" ? formatAedAr(walletFils) : formatAed(walletFils)}
          </span>
          {/* On phones this caption stacks BELOW the figure — a side-by-side
              baseline squeezes it into a one-word-per-line column. It fades
              out with the collapse (the collapsed header is money-only). */}
          {p < 0.85 && (
            <span
              className="type-caption text-ink-400 whitespace-nowrap"
              style={{ opacity: 1 - p * 0.4 }}
            >
              {T.cash.walletBalance} · {T.common.asOf}{" "}
              {new Date(asOf).toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-AE", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {p < 0.7 && (
          <div className="type-caption text-ink-400 mt-1.5" style={{ opacity: 1 - p / 0.7 }}>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone="success" />
              {T.cash.floorProtected}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TreasuryPanel() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const { data, isLoading } = useTreasury();
  const updatePolicy = useUpdatePolicy();
  const sweep = useSweep();
  const recall = useRecall();
  const addObligation = useAddObligation();
  const [instrument, setInstrument] = useState<string>("");
  const [floorDraft, setFloorDraft] = useState<number | null>(null);
  const [obLabel, setObLabel] = useState("");
  const [obAmount, setObAmount] = useState("");
  const [obDate, setObDate] = useState("");

  if (isLoading || !data) return <SkeletonCard lines={6} />;
  const { policy, projection, instruments, sweeps } = data;
  const floor = floorDraft ?? policy.floorFils;
  const selectedInstrument = instruments.find((i) => i.ref === (instrument || instruments[0]?.ref));

  const doSweep = async () => {
    if (!selectedInstrument) return;
    try {
      const res = await sweep.mutateAsync({ instrumentRef: selectedInstrument.ref });
      if (res.sweep) {
        toast.success(T.cash.swept(lang === "ar" ? formatAedAr((res.sweep as { amountFils: number }).amountFils) : formatAed((res.sweep as { amountFils: number }).amountFils), selectedInstrument.name));
      } else {
        toast(T.cash.sweepRejected, { description: (res.decision as { reasonText: string }).reasonText });
      }
      setFloorDraft(null);
    } catch {
      toast.error(T.errors.generic);
    }
  };

  return (
    <section aria-labelledby="treasury-h">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 id="treasury-h" className="type-heading">{T.cash.treasuryTitle}</h2>
          <div className="type-caption text-ink-400">{T.cash.treasurySubtitle}</div>
        </div>
        {/* Autopilot toggle — 160ms slide, spring knob */}
        <button
          type="button"
          role="switch"
          aria-checked={policy.autoPilotEnabled}
          aria-label={T.cash.autopilotOn}
          onClick={() =>
            updatePolicy.mutate(
              { autoPilotEnabled: !policy.autoPilotEnabled },
              { onSuccess: () => toast.success(T.cash.updatedPolicy) }
            )
          }
          className={cn(
            "relative w-12 h-7 rounded-full border transition-colors duration-[160ms] press-scale",
            policy.autoPilotEnabled ? "bg-treasury-w border-treasury-w" : "bg-surface-2 border-border"
          )}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 210, damping: 26 }}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow",
              policy.autoPilotEnabled ? "start-[26px]" : "start-1"
            )}
          />
        </button>
      </div>
      <div className="type-caption text-ink-400 mb-3">
        {policy.autoPilotEnabled ? T.cash.autopilotOn : T.cash.autopilotOff}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Floor — the one number that matters */}
        <div className="rounded-[10px] border border-border bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="type-body-strong">{T.cash.setFloor}</span>
            <Money fils={floor} size="body" colorize="accent" animate={false} />
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(projection.walletFils * 2, 1)}
            step={50_000}
            value={Math.min(floor, Math.max(projection.walletFils * 2, 1))}
            onChange={(e) => setFloorDraft(Number(e.target.value))}
            className="wl-slider w-full mt-2"
            dir="ltr"
            aria-label={T.cash.setFloor}
            style={{ "--wl-fill": `${(Math.min(floor, Math.max(projection.walletFils * 2, 1)) / Math.max(projection.walletFils * 2, 1)) * 100}%` } as React.CSSProperties}
          />
          <div className="flex justify-between type-caption text-ink-400">
            <span>{T.cash.sweepable}:</span>
            <Money fils={projection.sweepableFils} size="caption" colorize="accent" />
          </div>
          {floorDraft !== null && floorDraft !== policy.floorFils && (
            <button
              type="button"
              onClick={() =>
                updatePolicy.mutate(
                  { floorFils: floorDraft },
                  { onSuccess: () => { toast.success(T.cash.updatedPolicy); setFloorDraft(null); } }
                )
              }
              className="mt-2 w-full h-11 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1"
            >
              {T.common.confirm}
            </button>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <WlIcon name="lock-solid" size={13} className="text-caution-w" />
            <span className="type-caption text-ink-400">{T.cash.floorProtected}</span>
          </div>
        </div>

        {/* Sweep box */}
        <div className="rounded-[10px] border border-border bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="type-body-strong">{T.cash.sweepNow}</span>
            <Money fils={projection.sweepableFils} size="body" colorize="treasury" />
          </div>
          <div className="mt-2 space-y-1.5">
            {instruments.map((i) => (
              <button
                key={i.ref}
                type="button"
                onClick={() => setInstrument(i.ref)}
                className={cn(
                  "w-full flex items-center justify-between rounded-md border px-3 py-2 text-start transition-colors",
                  (instrument || instruments[0]?.ref) === i.ref
                    ? "border-treasury-w/50 bg-treasury-w/10"
                    : "border-border hover:border-ink-200 dark:hover:border-ink-600"
                )}
              >
                <div className="min-w-0">
                  <div className="type-body-strong truncate">{i.name}</div>
                  <div className="type-caption text-ink-400">
                    {T.cash.maturity} {i.maturityDays}d · {T.cash.yield} {(i.yieldMbsdPermyriad / 100).toFixed(2)}%
                  </div>
                </div>
                {(instrument || instruments[0]?.ref) === i.ref && <StatusDot tone="treasury" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={projection.sweepableFils < 500_000}
            onClick={doSweep}
            className="mt-3 w-full h-11 rounded-md bg-treasury-deep text-white type-body-strong press-scale disabled:opacity-40 disabled:cursor-not-allowed elev-1"
          >
            {T.cash.sweepNow}
          </button>
          {data.earnedYieldFils > 0 && (
            <div className="mt-2 flex justify-between type-caption text-ink-400">
              <span>{T.cash.earnedYield}</span>
              <Money fils={data.earnedYieldFils} size="caption" colorize="treasury" whole={false} />
            </div>
          )}
        </div>
      </div>

      {/* Sweep history */}
      {sweeps.length > 0 && (
        <div className="mt-4">
          <SectionLabel className="mb-2">{T.cash.sweeps}</SectionLabel>
          <div className="max-h-64 overflow-y-auto wl-scroll space-y-2 pe-1">
            {sweeps.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <WlIcon name={s.state === "swept" ? "treasury-sweep" : "treasury-return"} size={15} className="text-treasury-w" />
                    <span className="type-body-strong truncate">{s.instrumentName ?? s.instrumentRef}</span>
                    {s.state === "swept" && (
                      <span className="type-label text-treasury-w px-1.5 py-0.5 rounded-sm bg-treasury-w/10">
                        {T.cash.instrument}
                      </span>
                    )}
                  </div>
                  <div className="type-caption text-ink-400">
                    {new Date(s.createdAt).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-AE", { day: "numeric", month: "short" })}
                    {(s.accruedYieldFils ?? s.yieldFils) > 0 && (
                      <>
                        {" · "}
                        <Money fils={s.accruedYieldFils ?? s.yieldFils} size="caption" animate={false} colorize="treasury" whole={false} />{" "}
                        {T.cash.yield}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Money fils={s.amountFils} size="body" animate={false} whole={false} />
                  {s.state === "swept" && (
                    <button
                      type="button"
                      onClick={() => recall.mutate(s.id, { onSuccess: () => toast.success(T.cash.recalled(lang === "ar" ? formatAedAr(s.amountFils) : formatAed(s.amountFils))) })}
                      className="h-9 px-3 rounded-md border border-border type-caption hover:border-treasury-w/50 hover:text-treasury-w press-scale flex items-center gap-1.5"
                    >
                      <WlIcon name="undo" size={14} />
                      {T.cash.recall}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add obligation */}
      <div className="mt-4 rounded-[10px] border border-dashed border-ink-200 dark:border-ink-600 p-3">
        <SectionLabel className="mb-2">{T.cash.addObligation}</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <input
            value={obLabel}
            onChange={(e) => setObLabel(e.target.value)}
            placeholder={T.escrow.description}
            className="flex-1 min-w-[140px] h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w"
          />
          <input
            value={obAmount}
            onChange={(e) => setObAmount(e.target.value)}
            inputMode="decimal"
            placeholder="12,500"
            className="w-28 h-10 rounded-md border border-border bg-card px-3 type-body money outline-none focus:border-accent-w"
            dir="ltr"
          />
          <input
            type="date"
            value={obDate}
            onChange={(e) => setObDate(e.target.value)}
            className="h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w"
            dir="ltr"
          />
          <button
            type="button"
            disabled={!obLabel || !obAmount || !obDate}
            onClick={async () => {
              const fils = Math.round(Number(obAmount.replace(/[,\s]/g, "")) * 100);
              if (!Number.isFinite(fils) || fils <= 0) return;
              await addObligation.mutateAsync({ label: obLabel, dueDate: new Date(obDate).toISOString(), amountFils: fils });
              setObLabel(""); setObAmount(""); setObDate("");
              toast.success(T.cash.obligations);
            }}
            className="h-10 px-4 rounded-md bg-accent-w-soft text-accent-w-dark border border-accent-w/30 type-body-strong press-scale disabled:opacity-40"
            aria-label={T.cash.addObligation}
          >
            <WlIcon name="plus" size={15} className="inline" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function CashView() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const setView = useUi((s) => s.setView);
  const { data: overview, isLoading } = useOverview();
  const { data: treasury } = useTreasury();
  const { data: forecast, isLoading: forecastLoading } = useForecast();

  if (isLoading || !overview) {
    return (
      <div className="space-y-4">
        <div className="shimmer rounded-[16px] h-[180px]" />
        <SkeletonCard lines={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BalanceHeader walletFils={overview.balance.walletFils} asOf={overview.balance.asOf} />

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <div className="lg:pe-2">
          <LiquidityGauge
            walletFils={overview.balance.walletFils}
            investedFils={overview.liquidity.investedFils}
            floorFils={overview.liquidity.floorFils}
            totalApprovedFils={overview.liquidity.totalApprovedFils}
          />
        </div>

        <div className="space-y-6 min-w-0">
          <RunwayStrip obligations={treasury?.obligations ?? []} walletFils={overview.balance.walletFils} />

          {/* Ready to fund teaser */}
          <button
            type="button"
            onClick={() => setView("invoices")}
            className="w-full text-start rounded-[10px] border border-accent-w/30 bg-accent-w-soft/60 p-4 hover:border-accent-w/60 transition-colors press-scale"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-full grad-liquidity flex items-center justify-center text-white elev-1">
                  <WlIcon name="arrow-out" size={16} />
                </div>
                <div>
                  <div className="type-body-strong">{T.cash.readyToFund}</div>
                  <div className="type-caption text-ink-400">{T.cash.readyToFundHint(overview.invoices.readyCount)}</div>
                </div>
              </div>
              <div className="text-end">
                <Money fils={overview.invoices.readyFils} size="heading" colorize="accent" whole={false} />
                <div className="flex items-center gap-1 type-caption text-ink-400">
                  {T.common.viewAll}
                  <WlIcon name="chevron" size={13} className={lang === "ar" ? "rotate-180" : ""} />
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Forward cash — 90-day advisory projection (PRD 5.2) */}
      <ForecastChart data={forecast} isLoading={forecastLoading} />

      <TreasuryPanel />
    </div>
  );
}
