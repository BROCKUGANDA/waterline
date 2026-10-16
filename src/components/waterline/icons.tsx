// WATERLINE — custom icon set. 24px grid, 1.75px stroke, round caps and
// joins, 2px optical inset, outline default (filled variant for active
// navigation state only). Single SVG sprite discipline via one component,
// currentColor throughout. No icon font (PRD 11.6).

import { cn } from "@/lib/utils";

export type WlIconName =
  | "wallet" | "invoice" | "invoice-verified" | "invoice-disputed" | "escrow-lock"
  | "milestone" | "treasury-sweep" | "treasury-return" | "buyer" | "consent"
  | "audit-record" | "rule-pack" | "status-degraded" | "kill-switch" | "activity"
  | "waterline" | "gauge" | "check" | "close" | "plus" | "copy" | "chevron"
  | "arrow-out" | "arrow-in" | "clock" | "sun" | "moon" | "globe" | "terminal"
  | "info" | "alert" | "lock-solid" | "spark" | "undo" | "calendar" | "user" | "advisor"
  | "sign-out" | "phone" | "shield" | "scales";

const PATHS: Record<WlIconName, React.ReactNode> = {
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M15.5 12h4.5" />
      <path d="M15.51 12h-.01" strokeLinecap="round" />
    </>
  ),
  invoice: (
    <>
      <path d="M7 3.5h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3.5" />
    </>
  ),
  "invoice-verified": (
    <>
      <path d="M7 3.5h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M9 7.5h6" />
      <path d="M9.5 14l1.8 1.8 3.2-3.6" />
    </>
  ),
  "invoice-disputed": (
    <>
      <path d="M7 3.5h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M12 8v4.5" />
      <path d="M12 15.5h.01" />
    </>
  ),
  "escrow-lock": (
    <>
      <path d="M7 11h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
      <path d="M9 11V8.5a3 3 0 0 1 6 0V11" />
      <path d="M12 14v2" />
    </>
  ),
  milestone: (
    <>
      <path d="M6 21V3.5" />
      <path d="M6 4.5h9.5l-2.5 3.5 2.5 3.5H6" />
    </>
  ),
  "treasury-sweep": (
    <>
      <path d="M3.5 15c2-1.6 4-1.6 6 0s4 1.6 6 0" />
      <path d="M3.5 19c2-1.6 4-1.6 6 0s4 1.6 6 0" />
      <path d="M12 11V4.5" />
      <path d="M9 7l3-2.5L15 7" />
    </>
  ),
  "treasury-return": (
    <>
      <path d="M3.5 14.5c2-1.6 4-1.6 6 0s4 1.6 6 0" />
      <path d="M3.5 18.5c2-1.6 4-1.6 6 0s4 1.6 6 0" />
      <path d="M12 4.5V11" />
      <path d="M9 8.5l3 2.5 3-2.5" />
    </>
  ),
  buyer: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c1-3.6 3.5-5.2 6.5-5.2s5.5 1.6 6.5 5.2" />
    </>
  ),
  consent: (
    <>
      <path d="M12 3l7 2.4V11c0 4.9-2.9 7.6-7 9.2-4.1-1.6-7-4.3-7-9.2V5.4L12 3z" />
      <path d="M9.5 11.3l1.9 1.9 3.4-3.9" />
    </>
  ),
  "audit-record": (
    <>
      <path d="M7 3.5h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M9.5 8h.01" />
      <path d="M12.5 8h2" />
      <path d="M9.5 12h.01" />
      <path d="M12.5 12h2" />
      <path d="M9.5 16h.01" />
      <path d="M12.5 16h2" />
    </>
  ),
  "rule-pack": (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
      <circle cx="9" cy="7" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "status-degraded": (
    <>
      <path d="M4.5 14a7.5 7.5 0 0 1 15 0" />
      <path d="M12 14l3.5-3.5" />
      <path d="M4 17.5h16" />
    </>
  ),
  "kill-switch": (
    <>
      <path d="M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7z" />
      <path d="M9.5 9.5l5 5" />
      <path d="M14.5 9.5l-5 5" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l2.5-6.5 4 12.5 2.5-6h5" />
    </>
  ),
  waterline: (
    <>
      <path d="M3 8.75h18" />
      <path d="M3 12.5h18" strokeWidth="3" />
    </>
  ),
  gauge: (
    <>
      <path d="M9.5 3.5h5a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 19v-14a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M12 8.5v3" />
      <path d="M5.5 6.5h2.5" />
      <path d="M5.5 10h2.5" />
      <path d="M5.5 13.5h2.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  copy: (
    <>
      <path d="M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5" />
    </>
  ),
  chevron: <path d="M9 5.5l6.5 6.5L9 18.5" />,
  "arrow-out": (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6.5L19 12l-5.5 5.5" />
    </>
  ),
  "arrow-in": (
    <>
      <path d="M20 12H5" />
      <path d="M10.5 6.5L5 12l5.5 5.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2" />
      <path d="M12 19.5v2" />
      <path d="M2.5 12h2" />
      <path d="M19.5 12h2" />
      <path d="M5.2 5.2l1.4 1.4" />
      <path d="M17.4 17.4l1.4 1.4" />
      <path d="M18.8 5.2l-1.4 1.4" />
      <path d="M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5z" />
    </>
  ),
  terminal: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M7 9.5l2.5 2.5L7 14.5" />
      <path d="M12.5 15h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4" />
      <path d="M12 16.8h.01" />
    </>
  ),
  "lock-solid": (
    <>
      <path d="M7 10.5h10a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z" fill="currentColor" />
      <path d="M9 10.5V8a3 3 0 0 1 6 0v2.5" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
    </>
  ),
  advisor: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.2 8.8l-2 4.4-4.4 2 2-4.4z" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h11a5 5 0 0 1 0 10H9" />
      <path d="M8 4.5L3.5 9 8 13.5" />
    </>
  ),
  calendar: (
    <>
      <path d="M5 5.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />
      <path d="M4 10h16" />
      <path d="M8.5 3.5v3.5" />
      <path d="M15.5 3.5v3.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.7-3.4 3.3-5 7-5s6.3 1.6 7 5" />
    </>
  ),
  "sign-out": (
    <>
      <path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M10 12h10.5" />
      <path d="M17 8.5L20.5 12 17 15.5" />
    </>
  ),
  phone: (
    <>
      <path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 8 3.5z" />
      <path d="M10.5 17.5h3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 2.4V11c0 4.9-2.9 7.6-7 9.2-4.1-1.6-7-4.3-7-9.2V5.4L12 3z" />
      <path d="M12 7.5v4" />
      <path d="M12 14h.01" />
    </>
  ),
  scales: (
    <>
      <path d="M12 4v16" />
      <path d="M6 7h12" />
      <path d="M6 7l-2.5 5a2.8 2.8 0 0 0 5 0z" />
      <path d="M18 7l2.5 5a2.8 2.8 0 0 1-5 0z" />
      <path d="M9 20h6" />
    </>
  ),
};

interface WlIconProps extends React.SVGProps<SVGSVGElement> {
  name: WlIconName;
  size?: number;
  filled?: boolean;
}

export function WlIcon({ name, size = 20, filled, className, ...rest }: WlIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The WATERLINE brand mark — the waterline glyph in a rounded square. */
export function WaterlineLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--wl-ink-900)" />
      <path d="M7 12.5h18" stroke="var(--wl-paper)" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M7 18h18" stroke="var(--wl-accent-500)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
