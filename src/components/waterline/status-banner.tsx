"use client";

// WATERLINE — status banner. Rendered directly from the degrade-mode
// endpoint. The UI never guesses system state (PRD 11.8).

import { useStatus } from "@/hooks/waterline";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WlIcon } from "./icons";
import { StatusDot } from "./primitives";

export function StatusBanner() {
  const { data: status } = useStatus();
  const lang = useUi((s) => s.lang);
  const T = t(lang);

  if (!status) return null;

  const mode = status.mode;
  const killOn = status.killSwitches?.global || status.killSwitches?.dynamicDiscounting;
  const openBreakers = Object.entries(status.breakers ?? {}).filter(([, v]) => v !== "closed");

  if (mode === "M0" && !killOn && openBreakers.length === 0) return null;

  const catalog = status.modeCatalog?.find((m) => m.mode === mode);
  const localizedSmeSees = T.ops.modeCopy[mode]?.smeSees;
  const text =
    mode === "M0" ? T.status.m0
      : mode === "M1" ? T.status.m1
      : mode === "M2" ? T.status.m2
      : mode === "M3" ? T.status.m3
      : T.status.m4;

  const tone =
    killOn || mode === "M3" ? "danger"
      : mode === "M4" ? "neutral"
      : "caution";

  const styles =
    tone === "danger"
      ? "bg-danger-w/10 border-danger-w/40 text-danger-w"
      : tone === "caution"
        ? "bg-caution-w/10 border-caution-w/40 text-caution-w"
        : "bg-surface-2 border-border text-ink-600";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-start gap-2.5 px-4 py-2.5 border-b text-body", styles)}
    >
      <WlIcon name={tone === "neutral" ? "status-degraded" : "alert"} size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="type-body-strong">
          {killOn ? T.status.killOn : text}
          <span className="type-mono text-[11px] opacity-70 ms-2">{mode}</span>
        </div>
        {status.message && <div className="type-caption opacity-80">{status.message}</div>}
        {mode === "M2" && (
          <div className="type-caption opacity-80">
            {lang === "ar" ? "الأسعار مقفلة — تقبل الآن وتُجدول الدفعات." : "Prices are locked — accept now, payouts queue."}
          </div>
        )}
        {mode === "M4" && (
          <div className="type-caption opacity-80">
            {lang === "ar" ? "الأرصدة 'حتى' آخر تحديث — لا قراءة صامتة قديمة." : "Balances are \u201cas of\u201d last update — no silent staleness."}
          </div>
        )}
        {openBreakers.length > 0 && mode === "M0" && (
          <div className="type-caption opacity-80">
            {openBreakers.map(([name, st]) => (
              <span key={name} className="me-3 inline-flex items-center gap-1">
                <StatusDot tone={st === "open" ? "danger" : "caution"} />
                {T.status.breakerOpen(name)}
              </span>
            ))}
          </div>
        )}
        {(localizedSmeSees ?? catalog?.smeSees) && tone !== "neutral" && (
          <div className="type-caption opacity-70 mt-0.5">{localizedSmeSees ?? catalog?.smeSees}</div>
        )}
      </div>
    </div>
  );
}
