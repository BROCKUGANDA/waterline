"use client";

// WATERLINE — Forward cash projection chart (PRD 5.2 GET /v1/treasury/
// projection; advisory only per PRD 9.4 — "the forecast produces features,
// never decisions"). A 90-day day-by-day area chart of the projected wallet
// balance with the floor as a hard reference line, event markers for every
// scheduled inflow/outflow, the autopilot's modelled recalls visible, and a
// fully transparent tooltip — every figure is integer fils underneath and
// shown exactly in the tooltip.

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, ReferenceLine, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import type { ForecastDto, ForecastFlowDto } from "@/lib/types";
import { Money } from "@/components/waterline/money";
import { SectionLabel, StatusDot, SkeletonCard } from "@/components/waterline/primitives";
import { WlIcon } from "@/components/waterline/icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import { formatAed, formatAedAr } from "@/lib/money";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

interface TooltipPayload {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}

interface ChartPoint {
  dayIndex: number;
  date: string;
  dateLabel: string;
  endFils: number;
  inflowFils: number;
  outflowFils: number;
  hasEvents: boolean;
  inflows: ForecastFlowDto[];
  outflows: ForecastFlowDto[];
}

/** Badge for an event's honesty level (estimate / on condition / recurring / autopilot). */
function FlowBadges({ flow, T }: { flow: ForecastFlowDto; T: ReturnType<typeof t> }) {
  const F = T.forecast;
  return (
    <span className="flex items-center gap-1">
      {flow.estimate && (
        <span className="type-label text-ink-400 px-1 rounded-sm bg-surface-2">{F.estimate}</span>
      )}
      {flow.onCondition && (
        <span className="type-label text-escrow-w px-1 rounded-sm bg-escrow-w/10">{F.onCondition}</span>
      )}
      {flow.recurring && (
        <span className="type-label text-ink-400 px-1 rounded-sm bg-surface-2">{F.recurring}</span>
      )}
      {flow.kind === "autopilot_recall" && (
        <span className="type-label text-treasury-w px-1 rounded-sm bg-treasury-w/10">{F.autopilot}</span>
      )}
    </span>
  );
}

function DayTooltip({ active, payload, lang }: TooltipPayload & { lang: "en" | "ar" }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as ChartPoint;
  const T = t(lang);
  const F = T.forecast;
  const fmt = (fils: number) => (lang === "ar" ? formatAedAr(fils) : formatAed(fils));
  return (
    <div className="rounded-[10px] border border-border bg-card px-3 py-2.5 elev-2 max-w-[260px] shadow-lg" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="type-label text-ink-400">{p.dateLabel}</div>
      <div className="money type-body-strong mt-0.5">{fmt(p.endFils)}</div>
      {(p.inflows.length > 0 || p.outflows.length > 0) && (
        <div className="mt-2 space-y-1.5">
          {p.inflows.map((f) => (
            <div key={`in-${f.sourceRef}`} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="type-caption block truncate">{f.label}</span>
                <FlowBadges flow={f} T={T} />
              </span>
              <span className="type-caption money text-success-w whitespace-nowrap">+{fmt(f.amountFils)}</span>
            </div>
          ))}
          {p.outflows.map((f) => (
            <div key={`out-${f.sourceRef}`} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="type-caption block truncate">{f.label}</span>
                <FlowBadges flow={f} T={T} />
              </span>
              <span className="type-caption money text-danger-w whitespace-nowrap">−{fmt(f.amountFils)}</span>
            </div>
          ))}
        </div>
      )}
      {p.inflows.length === 0 && p.outflows.length === 0 && (
        <div className="type-caption text-ink-400 mt-1.5">{F.noEvents}</div>
      )}
    </div>
  );
}

/** A diamond marker on event days — accent above the line is not needed; the
 *  marker sits ON the line, colored by dominant flow direction. */
function EventDot(props: { cx?: number; cy?: number; inflow: boolean; outflow: boolean }) {
  const { cx, cy, inflow, outflow } = props;
  if (cx == null || cy == null) return <g />;
  const fill = inflow && !outflow ? "var(--wl-success)" : outflow && !inflow ? "var(--wl-caution)" : "var(--wl-ink-400)";
  return (
    <circle cx={cx} cy={cy} r={3} fill={fill} stroke="var(--wl-paper)" strokeWidth={1.5} />
  );
}

export function ForecastChart({ data, isLoading }: { data: ForecastDto | undefined; isLoading: boolean }) {
  const lang = useUi((s) => s.lang);
  const askAdvisor = useUi((s) => s.askAdvisor);
  const T = t(lang);
  const F = T.forecast;
  const locale = lang === "ar" ? "ar-AE" : "en-AE";
  const fmtY = (fils: number) => (lang === "ar" ? formatAedAr(fils) : formatAed(fils));

  const points: ChartPoint[] = useMemo(() => {
    if (!data) return [];
    return data.days.map((d, i) => {
      const date = new Date(d.date + "T00:00:00Z");
      const inflowFils = d.inflows.reduce((a, f) => a + f.amountFils, 0);
      const outflowFils = d.outflows.reduce((a, f) => a + f.amountFils, 0);
      return {
        dayIndex: i,
        date: d.date,
        dateLabel: date.toLocaleDateString(locale, { day: "numeric", month: "short" }),
        endFils: d.endFils,
        inflowFils,
        outflowFils,
        hasEvents: d.inflows.length > 0 || d.outflows.length > 0,
        inflows: d.inflows,
        outflows: d.outflows,
      };
    });
  }, [data, locale]);

  if (isLoading || !data) {
    return (
      <section aria-label={F.title}>
        <SkeletonCard lines={7} />
      </section>
    );
  }

  const maxFils = Math.max(data.startFils, ...points.map((p) => p.endFils), data.floorFils);
  const eventPoints = points.filter((p) => p.hasEvents);
  const minPoint = points.find((p) => p.date === data.minBalance.date);
  const minDate = minPoint
    ? new Date(minPoint.date + "T00:00:00Z").toLocaleDateString(locale, { day: "numeric", month: "short" })
    : data.minBalance.date;

  // Month-start tick labels (honest axis, not a decorative ruler).
  const monthTicks = points
    .filter((p) => new Date(p.date + "T00:00:00Z").getUTCDate() === 1 || p.dayIndex === 0)
    .map((p) => p.dayIndex);

  return (
    <section aria-labelledby="forecast-h">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 id="forecast-h" className="type-heading">{F.title}</h2>
          <div className="type-caption text-ink-400">{F.subtitle}</div>
        </div>
      </div>

      <div className="rounded-[10px] border border-border bg-card p-4 pt-3">
        {/* Headline figures */}
        <div className="grid grid-cols-3 gap-2 mb-1">
          <div>
            <SectionLabel>{F.today}</SectionLabel>
            <Money fils={data.startFils} size="body" animate={false} />
          </div>
          <div>
            <SectionLabel>{F.minPoint}</SectionLabel>
            <div className="flex items-center gap-1.5">
              <Money fils={data.minBalance.endFils} size="body" animate={false} colorize={data.minBalance.aboveFloor ? undefined : "danger"} />
            </div>
            <div className="type-caption text-ink-400">{F.onDate(minDate)}</div>
          </div>
          <div>
            <SectionLabel>{F.end90}</SectionLabel>
            <Money fils={data.summary.projectedEndFils} size="body" animate={false} />
          </div>
        </div>

        {/* The chart — floor as a hard reference, events as markers */}
        <div className="h-[220px] sm:h-[240px] -mx-1" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="wlForecastFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--wl-accent-500)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--wl-accent-500)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--wl-ink-100)" strokeDasharray="0" vertical={false} />
              <XAxis
                dataKey="dayIndex"
                ticks={monthTicks}
                tickFormatter={(i: number) => points[i]?.dateLabel ?? ""}
                tick={{ fontSize: 11, fill: "var(--wl-ink-400)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--wl-ink-100)" }}
                interval={0}
              />
              <YAxis
                width={56}
                tickFormatter={(v: number) => `${Math.round(v / 100 / 1000)}K`}
                tick={{ fontSize: 11, fill: "var(--wl-ink-400)" }}
                tickLine={false}
                axisLine={false}
                domain={[0, Math.ceil((maxFils * 1.08) / 100_000) * 100_000]}
              />
              <Tooltip content={<DayTooltip lang={lang} />} cursor={{ stroke: "var(--wl-ink-200)", strokeDasharray: "3 3" }} />
              <ReferenceLine
                y={data.floorFils}
                stroke="var(--wl-caution)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{
                  value: T.common.floor,
                  position: "insideTopLeft",
                  fontSize: 10,
                  fill: "var(--wl-caution)",
                }}
              />
              <Area
                type="monotone"
                dataKey="endFils"
                stroke="var(--wl-accent-500)"
                strokeWidth={2}
                fill="url(#wlForecastFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, fill: "var(--wl-accent-500)", stroke: "var(--wl-paper)", strokeWidth: 2 }}
              />
              <Scatter
                data={eventPoints}
                dataKey="endFils"
                isAnimationActive={false}
                shape={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => (
                  <EventDot
                    cx={props.cx}
                    cy={props.cy}
                    inflow={(props.payload?.inflowFils ?? 0) > 0}
                    outflow={(props.payload?.outflowFils ?? 0) > 0}
                  />
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Min-balance honesty line + totals */}
        <div
          className={cn(
            "mt-2 flex items-start gap-2 rounded-md px-3 py-2",
            data.minBalance.aboveFloor ? "bg-success-w/8" : "bg-danger-w/10"
          )}
        >
          <StatusDot tone={data.minBalance.aboveFloor ? "success" : "danger"} />
          <div className="type-caption flex-1 min-w-0">
            {data.minBalance.aboveFloor ? F.floorHolds : F.breachWarn} — {data.advisory}
            {/* A projected floor gap is actionable: one tap opens the advisor
                with the question pre-filled — the SME presses send. */}
            {!data.minBalance.aboveFloor && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() =>
                    askAdvisor(
                      lang === "ar"
                        ? `التوقّع يبين أن رصيدي قد ينزل دون حدّي الأدنى حول ${new Date(data.minBalance.date + "T00:00:00Z").toLocaleDateString("ar-AE", { day: "numeric", month: "long" })}. ما خياراتي لسد هذه الفجوة؟`
                        : `My forecast shows my balance dropping below my floor around ${new Date(data.minBalance.date + "T00:00:00Z").toLocaleDateString("en-AE", { day: "numeric", month: "long" })}. What are my options to close this gap?`
                    )
                  }
                  className="type-caption font-semibold text-accent-w-dark underline decoration-accent-w/40 underline-offset-2 hover:decoration-accent-w press-scale"
                >
                  {F.askAdvisor}
                </button>
                <span className="sr-only">{F.askAdvisorHint}</span>
              </div>
            )}
          </div>
        </div>
        {/* Live sweep yield — the money working in the background, visible */}
        {data.sweepYield && data.sweepYield.investedFils > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-success-w/25 bg-success-w/8 px-3 py-2">
            <WlIcon name="gauge" size={14} className="text-success-w shrink-0" />
            <div className="type-caption text-ink-600 min-w-0 flex-1">
              <span className="font-semibold">{F.yieldAccruing}</span>{" "}
              <span className="money text-success-w">{F.yieldPerDay(fmtY(data.sweepYield.perDayFils))}</span>
              <span className="text-ink-400"> · {F.yieldToDate(fmtY(data.sweepYield.accruedTodayFils))} · {F.yieldOn(fmtY(data.sweepYield.investedFils))}</span>
            </div>
          </div>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
            <span className="type-caption text-ink-400">{F.totalIn}</span>
            <Money fils={data.summary.totalInFils} size="caption" colorize="success" animate={false} whole={false} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
            <span className="type-caption text-ink-400">{F.totalOut}</span>
            <Money fils={data.summary.totalOutFils} size="caption" colorize="danger" animate={false} whole={false} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
            <span className="type-caption text-ink-400">{F.projectedEnd}</span>
            <Money fils={data.summary.projectedEndFils} size="caption" animate={false} whole={false} />
          </div>
        </div>
      </div>
    </section>
  );
}
