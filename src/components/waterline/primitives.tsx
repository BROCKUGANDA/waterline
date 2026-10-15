"use client";

// Small shared primitives: status dots (always paired with a text label —
// colour alone never conveys state), copy-reference control with the
// glyph→tick morph, and shimmer skeletons (PRD 11.6/11.12).

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { WlIcon } from "./icons";

export type DotTone = "success" | "caution" | "danger" | "accent" | "neutral" | "escrow" | "treasury";

const toneVar: Record<DotTone, string> = {
  success: "bg-success-w",
  caution: "bg-caution-w",
  danger: "bg-danger-w",
  accent: "bg-accent-w",
  neutral: "bg-ink-400",
  escrow: "bg-escrow-w",
  treasury: "bg-treasury-w",
};

export function StatusDot({ tone, pulse, className }: { tone: DotTone; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", toneVar[tone], pulse && "dot-pulse", className)}
      aria-hidden="true"
    />
  );
}

/** Copy control: glyph morphs to a tick for 1.2 s, then reverts (PRD 11.12). */
export function CopyRef({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 type-caption text-ink-400",
        "hover:bg-accent-w-soft hover:text-accent-w-dark transition-colors press-scale",
        className
      )}
      aria-label={label ?? `Copy ${value}`}
    >
      <WlIcon name={copied ? "check" : "copy"} size={14} className={copied ? "text-success-w stroke-draw" : ""} />
      {label ? <span>{label}</span> : <span className="type-mono text-[11px]">{value.slice(0, 14)}</span>}
    </button>
  );
}

export function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md h-4 w-full", className)} />;
}

export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("grad-lift rounded-[10px] border border-border p-4 space-y-3", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} className={i === 0 ? "h-6 w-2/5" : i === lines - 1 ? "h-4 w-3/5" : "h-4"} />
      ))}
    </div>
  );
}

/** Section label — the 11px/700/+14% upper style (PRD 11.4). */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("type-label text-ink-400", className)}>{children}</div>;
}

/** Tier chip for buyer tiers. */
export function TierChip({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    platinum: "bg-accent-w-soft text-accent-w-dark border-accent-w/30",
    gold: "bg-caution-w/10 text-caution-w border-caution-w/30",
    silver: "bg-surface-2 text-ink-600 border-ink-200",
    bronze: "bg-[#E8DCC8] text-[#7A5C2E] border-[#C9B48A] dark:bg-[#3A3225] dark:text-[#D9C9A5]",
    unrated: "bg-surface-2 text-ink-400 border-ink-200 border-dashed",
  };
  return (
    <span className={cn("type-label px-1.5 py-0.5 rounded-sm border", styles[tier] ?? styles.unrated)}>{tier}</span>
  );
}
