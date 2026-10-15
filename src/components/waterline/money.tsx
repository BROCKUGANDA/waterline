"use client";

// WATERLINE — money display. Amounts are the largest, clearest element on
// any screen they appear on; tabular figures; never wrap, never truncate;
// digit-roll on change (PRD 11.2/11.4/11.12).

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatAed, formatAedAr } from "@/lib/money";
import { useUi } from "@/stores/ui";

type MoneySize = "display" | "amount" | "heading" | "body" | "caption";

const sizeClass: Record<MoneySize, string> = {
  display: "type-display",
  amount: "type-amount",
  heading: "type-heading",
  body: "type-body-strong",
  caption: "type-caption",
};

export function Money({
  fils,
  size = "body",
  whole = true,
  className,
  animate = true,
  colorize,
}: {
  fils: number;
  size?: MoneySize;
  whole?: boolean;
  className?: string;
  animate?: boolean;
  colorize?: "default" | "accent" | "success" | "danger" | "treasury";
}) {
  const lang = useUi((s) => s.lang);
  // Digit roll on the changed amount: adjust state during render (React
  // documented pattern), clear via timeout callback.
  const [prev, setPrev] = useState(fils);
  const [rolled, setRolled] = useState(false);
  if (animate && prev !== fils) {
    setPrev(fils);
    setRolled(true);
  }
  useEffect(() => {
    if (!rolled) return;
    const id = setTimeout(() => setRolled(false), 280);
    return () => clearTimeout(id);
  }, [rolled]);

  const text = lang === "ar" ? formatAedAr(fils, { whole }) : formatAed(fils, { whole });
  const color =
    colorize === "accent" ? "text-accent-money" : colorize === "success" ? "text-success-w" : colorize === "danger" ? "text-danger-w" : colorize === "treasury" ? "text-treasury-w" : "";

  return (
    <span className={cn("money", sizeClass[size], color, rolled && "digit-roll", className)}>
      {text}
    </span>
  );
}
