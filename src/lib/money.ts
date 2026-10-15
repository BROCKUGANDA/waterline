// WATERLINE — money utilities. PRD 3.2: all money is integer minor units (fils),
// all rates are fixed-point. No floating point touches a monetary calculation.

export const FILS_PER_AED = 100;
/** milli-bps per day: 1 mbps = 0.001 bps. 34 mbps = 3.4 bps/day. */
export const MBPS_DENOM = 100_000; // fee_fils = days * mbps * fils / MBPS_DENOM

const enFormatter = new Intl.NumberFormat("en-AE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const enFormatterWhole = new Intl.NumberFormat("en-AE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format fils as a dirham string, e.g. 14280000 → "AED 142,800" (whole) / "AED 142,800.00". */
export function formatAed(fils: number, opts?: { whole?: boolean; symbol?: boolean }): string {
  const aed = fils / FILS_PER_AED;
  const num = opts?.whole
    ? enFormatterWhole.format(Math.round(aed))
    : enFormatter.format(aed);
  return opts?.symbol === false ? num : `AED ${num}`;
}

/** Format fils for Arabic locale with Eastern Arabic numerals (user preference, PRD 11.14). */
export function formatAedAr(fils: number, opts?: { whole?: boolean }): string {
  const aed = fils / FILS_PER_AED;
  const num = new Intl.NumberFormat("ar-AE", {
    minimumFractionDigits: opts?.whole ? 0 : 2,
    maximumFractionDigits: opts?.whole ? 0 : 2,
  }).format(aed);
  return `د.إ ${num}`;
}

/** Parse user input like "12,500.50" or "12500.5" to fils. Returns null when invalid. */
export function parseAedToFils(input: string): number | null {
  const cleaned = input.replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [intPart, decPart = ""] = cleaned.split(".");
  const fils = Number(intPart) * FILS_PER_AED + Number((decPart + "00").slice(0, 2));
  return Number.isSafeInteger(fils) ? fils : null;
}

/** Integer floor division of (a * b) / d using BigInt — no float drift. */
export function mulDivFloor(a: number, b: number, d: number): number {
  return Number((BigInt(a) * BigInt(b)) / BigInt(d));
}

/** Fee in fils, pure integer arithmetic: days × mbps/day × principal ÷ 100,000. */
export function feeFils(daysEarly: number, mbpsPerDay: number, principalFils: number): number {
  if (daysEarly <= 0 || principalFils <= 0 || mbpsPerDay <= 0) return 0;
  return mulDivFloor(daysEarly * mbpsPerDay, principalFils, MBPS_DENOM);
}

/** Apply a permyriad rate (9000 = 0.90) to fils. */
export function applyPermyriad(fils: number, permyriad: number): number {
  return mulDivFloor(fils, permyriad, 10_000);
}

export function formatBps(mbpsPerDay: number): string {
  const bps = mbpsPerDay / 10;
  return `${bps.toFixed(1)} bps/day`;
}

export function formatPermyriad(permyriad: number): string {
  return `${(permyriad / 10_000).toFixed(2)}×`;
}
