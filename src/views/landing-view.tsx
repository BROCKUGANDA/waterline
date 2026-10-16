"use client";

// WATERLINE — landing page. The pre-auth surface judges see first: the
// Theme 2 story (creating liquidity from operations, not loans), the live
// demo numbers straight from /api/overview, and the honest-arithmetic
// quote example computed with the REAL money functions (integer fils, the
// same feeFils the product uses — marketing copy earns no exemption from
// the non-negotiables). Bilingual + RTL + dark by construction.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { useOverview } from "@/hooks/waterline";
import { WlIcon, WaterlineLogo, type WlIconName } from "@/components/waterline/icons";
import { Money } from "@/components/waterline/money";
import { StatusDot } from "@/components/waterline/primitives";
import { formatAed, formatAedAr, feeFils, applyPermyriad, FILS_PER_AED, formatBps } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── The honest example: the seeded platinum invoice, priced by the real
//    functions. ESS-INV-2214 · AED 48,500 · 21 days early · base pack
//    (90% advance, 26 milliBps/day platinum curve). Computed in fils at
//    render — never hardcoded strings.
const EX_GROSS_FILS = 48_500 * FILS_PER_AED;
const EX_DAYS = 21;
const EX_ADVANCE_PERTMYRIAD = 9_000; // base pack
const EX_PLATINUM_MBPS = 26; // base pack curve
const EX_PRINCIPAL_FILS = applyPermyriad(EX_GROSS_FILS, EX_ADVANCE_PERTMYRIAD);
const EX_FEE_FILS = feeFils(EX_DAYS, EX_PLATINUM_MBPS, EX_PRINCIPAL_FILS);
const EX_NET_FILS = EX_PRINCIPAL_FILS - EX_FEE_FILS;

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.4, ease: [0.2, 0, 0, 1] as const },
};

function money(fils: number, lang: string, opts?: { whole?: boolean }) {
  return lang === "ar" ? formatAedAr(fils, opts) : formatAed(fils, opts);
}

// ── Sticky header ─────────────────────────────────────────────────────────
function LandingHeader() {
  const { lang, toggleLang, setStage } = useUi();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);
  const isDark = mounted && theme === "dark";
  const T = t(lang);

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 h-16 flex items-center gap-4">
        <a href="#wl-top" className="flex items-center gap-3 min-w-0 press-scale" aria-label="WATERLINE — top">
          <WaterlineLogo size={32} />
          <div className="hidden sm:block min-w-0">
            <div className="type-heading tracking-wide">{T.appName}</div>
            <div className="type-caption text-ink-400 leading-snug">{T.appTagline}</div>
          </div>
        </a>

        {/* Anchor nav — desktop only (mobile scrolls naturally) */}
        <nav className="hidden md:flex items-center gap-1 mx-auto" aria-label="Landing">
          {(
            [
              ["#wl-product", T.landing.navProduct],
              ["#wl-how", T.landing.navHow],
              ["#wl-trust", T.landing.navTrust],
            ] as const
          ).map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-md px-3 py-2 type-caption text-ink-600 hover:bg-surface-2 hover:text-foreground transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1 ms-auto md:ms-0">
          <button
            type="button"
            onClick={toggleLang}
            className="h-11 w-11 flex items-center justify-center rounded-md text-ink-600 hover:bg-surface-2 press-scale"
            title="العربية / English"
            aria-label="العربية / English"
          >
            <WlIcon name="globe" size={20} />
          </button>
          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="h-11 w-11 flex items-center justify-center rounded-md text-ink-600 hover:bg-surface-2 press-scale"
            title={isDark ? T.settings.light : T.settings.dark}
            aria-label={T.settings.theme}
          >
            <WlIcon name={isDark ? "sun" : "moon"} size={20} />
          </button>
          <button
            type="button"
            onClick={() => setStage("auth")}
            className="ms-1 h-11 px-4 rounded-md grad-liquidity text-white type-body-strong elev-1 press-scale focus-visible:outline-white"
          >
            {T.landing.signIn}
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Live stats band ───────────────────────────────────────────────────────
function LiveStats() {
  const { data } = useOverview();
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const L = T.landing;

  const stats: { fils: number | null; label: string; colorize?: "accent" | "treasury" | undefined }[] = [
    { fils: data?.balance.walletFils ?? null, label: L.statAvailable, colorize: "accent" },
    { fils: data?.liquidity.totalApprovedFils ?? null, label: L.statApproved },
    { fils: data?.liquidity.investedFils ?? null, label: L.statInvested, colorize: "treasury" },
    { fils: data?.liquidity.floorFils ?? null, label: L.statFloor },
  ];

  return (
    <motion.section {...fadeUp} aria-label={L.liveLabel}>
      <div className="flex items-center gap-2 mb-3">
        <StatusDot tone="success" pulse />
        <span className="type-label text-ink-400">{L.liveLabel}</span>
        {data?.balance.asOf && (
          <span className="type-caption text-ink-400">
            · {L.liveAsOf}{" "}
            {new Date(data.balance.asOf).toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-AE", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
      {/* Single column under sm — the 28px money figures never shrink and
          never wrap (PRD 11.4), so the card must yield instead. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {stats.map((s) => (
          <div key={s.label} className="grad-lift rounded-[10px] border border-border p-4 md:p-5 elev-1">
            <div className="type-caption text-ink-400 mb-1">{s.label}</div>
            {s.fils === null ? (
              <div className="shimmer rounded-md h-8 w-3/4" />
            ) : (
              <Money fils={s.fils} size="amount" whole={false} colorize={s.colorize} />
            )}
          </div>
        ))}
      </div>
    </motion.section>
  );
}

// ── The honest quote example — real functions, real arithmetic ───────────
function QuoteExampleCard() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const L = T.landing;
  const m = (fils: number) => money(fils, lang);

  return (
    <div className="grad-lift rounded-[10px] border border-border elev-2 p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <WlIcon name="invoice-verified" size={18} className="text-accent-w" />
        <div className="type-body-strong">{L.previewQuote}</div>
      </div>

      {/* Invoice header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
        <div className="min-w-0">
          <div className="type-mono text-ink-600 truncate">ESS-INV-2214</div>
          <div className="type-caption text-ink-400 truncate">{T.invoices.buyer}: Emirates Steel Structures · platinum</div>
        </div>
        <span className="type-label px-1.5 py-0.5 rounded-sm border bg-accent-w-soft text-accent-w-dark border-accent-w/30 shrink-0">
          {T.invoices.stateLabels.verified}
        </span>
      </div>

      {/* Gross + days */}
      <div className="flex items-center justify-between gap-2 py-3">
        <span className="type-caption text-ink-600">{T.invoices.amount}</span>
        <span className="money type-body-strong tnum">{m(EX_GROSS_FILS)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 pb-3">
        <span className="type-caption text-ink-600">{L.previewDays(EX_DAYS)}</span>
        <span className="type-body-strong tnum">× 90% × {formatBps(EX_PLATINUM_MBPS)}</span>
      </div>

      {/* The arithmetic — always expanded (PRD 11.2) */}
      <div className="rounded-md bg-surface-2 p-3 space-y-1.5" aria-label={L.previewQuote}>
        <div className="type-mono text-ink-600 leading-relaxed tnum" dir={lang === "ar" ? "ltr" : undefined}>
          {EX_DAYS} {L.previewArithmetic} 0.026%/day {L.previewArithmetic} {m(EX_PRINCIPAL_FILS)}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
          <span className="type-caption text-ink-600">{L.previewFee}</span>
          <span className="money type-body-strong tnum">{m(EX_FEE_FILS)}</span>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 pt-4">
        <span className="type-caption text-ink-600">{L.previewNet}</span>
        <Money fils={EX_NET_FILS} size="amount" whole={false} colorize="accent" />
      </div>

      <div className="flex items-start gap-2 pt-3 border-t border-border mt-4">
        <WlIcon name="clock" size={14} className="text-ink-400 mt-0.5 shrink-0" />
        <span className="type-caption text-ink-400 leading-snug">{L.previewNote}</span>
      </div>
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────
function Hero() {
  const { lang, setStage } = useUi();
  const T = t(lang);
  const L = T.landing;

  return (
    <section id="wl-top" className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-64 grad-horizon pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 pt-10 md:pt-16 pb-8 md:pb-12 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
        <motion.div {...fadeUp}>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 type-caption text-ink-600">
            <WlIcon name="waterline" size={14} className="text-accent-w" />
            {L.challengeChip}
          </span>

          <h1 className="type-display mt-5 text-balance">
            {L.heroTitle1}{" "}
            <span className="text-accent-w-dark">{L.heroTitle2}</span>
          </h1>

          <p className="type-body text-ink-600 mt-5 max-w-[56ch] text-pretty">{L.heroBody}</p>

          <div className="flex flex-wrap items-center gap-3 mt-8">
            <button
              type="button"
              onClick={() => setStage("auth")}
              className="h-12 px-6 rounded-md grad-liquidity text-white type-body-strong elev-2 press-scale focus-visible:outline-white inline-flex items-center gap-2"
            >
              {L.heroCta}
              <WlIcon name="chevron" size={16} className={cn(lang === "ar" && "scale-x-[-1]")} />
            </button>
            <button
              type="button"
              onClick={() => setStage("auth")}
              className="h-12 px-6 rounded-md border border-accent-w/40 text-accent-w-dark type-body-strong bg-card hover:bg-accent-w-soft transition-colors press-scale"
            >
              {L.heroCtaSecondary}
            </button>
          </div>

          <p className="type-caption text-ink-400 mt-4">{L.heroMicro}</p>
        </motion.div>

        <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.08 }}>
          <QuoteExampleCard />
        </motion.div>
      </div>
    </section>
  );
}

// ── Pillars (Theme 2's three sub-tracks) ──────────────────────────────────
const PILLAR_ICONS: WlIconName[] = ["invoice-verified", "escrow-lock", "treasury-sweep"];

function Pillars() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const L = T.landing;

  const pillars = [
    {
      icon: PILLAR_ICONS[0],
      title: L.pillar1Title,
      body: L.pillar1Body,
      bullets: [L.pillar1B1, L.pillar1B2, L.pillar1B3],
      chip: L.pillar1Chip,
      chipClass: "bg-accent-w-soft text-accent-w-dark border-accent-w/30",
    },
    {
      icon: PILLAR_ICONS[1],
      title: L.pillar2Title,
      body: L.pillar2Body,
      bullets: [L.pillar2B1, L.pillar2B2, L.pillar2B3],
      chip: L.pillar2Chip,
      chipClass: "bg-escrow-w/10 text-escrow-w border-escrow-w/30",
    },
    {
      icon: PILLAR_ICONS[2],
      title: L.pillar3Title,
      body: L.pillar3Body,
      bullets: [L.pillar3B1, L.pillar3B2, L.pillar3B3],
      chip: L.pillar3Chip,
      chipClass: "bg-card text-treasury-w border-treasury-w/30",
    },
  ];

  return (
    <section id="wl-product" className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 py-12 md:py-16">
      <motion.div {...fadeUp} className="mb-8">
        <div className="type-label text-ink-400">{L.pillarsEyebrow}</div>
        <h2 className="type-display mt-2 text-balance">{L.pillarsTitle}</h2>
      </motion.div>
      <div className="grid md:grid-cols-3 gap-4 md:gap-6">
        {pillars.map((p, i) => (
          <motion.article
            key={p.title}
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: i * 0.06 }}
            className="grad-lift rounded-[10px] border border-border p-6 elev-1 flex flex-col"
          >
            <div className="h-11 w-11 rounded-md bg-surface-2 border border-border flex items-center justify-center">
              <WlIcon name={p.icon} size={22} className="text-accent-w" />
            </div>
            <h3 className="type-title mt-4">{p.title}</h3>
            <p className="type-caption text-ink-600 mt-2 leading-relaxed">{p.body}</p>
            <ul className="mt-4 space-y-2.5 flex-1">
              {p.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <WlIcon name="check" size={14} className="text-success-w mt-0.5 shrink-0" />
                  <span className="type-caption text-ink-600 leading-snug">{b}</span>
                </li>
              ))}
            </ul>
            <span className={cn("type-label px-2 py-1 rounded-sm border w-fit mt-5", p.chipClass)}>{p.chip}</span>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

// ── How it works — the golden path in four steps ──────────────────────────
function HowItWorks() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const L = T.landing;

  const steps = [
    { icon: "buyer" as WlIconName, title: L.step1Title, body: L.step1Body },
    { icon: "rule-pack" as WlIconName, title: L.step2Title, body: L.step2Body },
    { icon: "arrow-in" as WlIconName, title: L.step3Title, body: L.step3Body },
    { icon: "audit-record" as WlIconName, title: L.step4Title, body: L.step4Body },
  ];

  return (
    <section id="wl-how" className="bg-surface-2 border-y border-border">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 py-12 md:py-16">
        <motion.div {...fadeUp} className="mb-8">
          <div className="type-label text-ink-400">{L.howEyebrow}</div>
          <h2 className="type-display mt-2 text-balance">{L.howTitle}</h2>
        </motion.div>
        <div className="relative grid md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {/* The waterline runs through the steps — the level, marked */}
          <div className="waterline-rule absolute inset-x-0 top-[26px] hidden lg:block" aria-hidden="true" />
          {steps.map((s, i) => (
            <motion.div key={s.title} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.06 }} className="relative">
              <div className="h-[52px] w-[52px] rounded-full grad-liquidity text-white type-heading flex items-center justify-center elev-2 ring-4 ring-surface-2">
                {i + 1}
              </div>
              <div className="flex items-center gap-2 mt-4">
                <WlIcon name={s.icon} size={16} className="text-ink-400" />
                <h3 className="type-title">{s.title}</h3>
              </div>
              <p className="type-caption text-ink-600 mt-2 leading-relaxed max-w-[34ch]">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Trust — the non-negotiables ───────────────────────────────────────────
const TRUST_ICONS: WlIconName[] = ["rule-pack", "audit-record", "scales", "shield", "lock-solid", "status-degraded"];

function Trust() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const L = T.landing;

  const items = [L.trust1, L.trust2, L.trust3, L.trust4, L.trust5, L.trust6];

  return (
    <section id="wl-trust" className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 py-12 md:py-16">
      <motion.div {...fadeUp} className="mb-8">
        <div className="type-label text-ink-400">{L.trustEyebrow}</div>
        <h2 className="type-display mt-2 text-balance">{L.trustTitle}</h2>
      </motion.div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item, i) => (
          <motion.div
            key={item}
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: (i % 3) * 0.05 }}
            className="flex items-start gap-3 rounded-[10px] border border-border bg-card p-4 elev-1"
          >
            <div className="h-9 w-9 rounded-md bg-surface-2 border border-border flex items-center justify-center shrink-0">
              <WlIcon name={TRUST_ICONS[i]} size={18} className="text-ink-600" />
            </div>
            <span className="type-caption text-ink-600 leading-snug pt-1.5">{item}</span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ── Final CTA band ────────────────────────────────────────────────────────
function FinalCta() {
  const { lang, setStage } = useUi();
  const T = t(lang);
  const L = T.landing;

  return (
    <section className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 pb-12 md:pb-16">
      <motion.div
        {...fadeUp}
        className="grad-liquidity rounded-[12px] elev-3 p-8 md:p-12 flex flex-col md:flex-row md:items-center gap-6 md:gap-10 relative overflow-hidden"
      >
        {/* Waterline glyph, oversized, as texture */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.12] pointer-events-none" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 400 160">
          <path d="M0 70h400" stroke="white" strokeWidth="1.5" />
          <path d="M0 100h400" stroke="white" strokeWidth="5" />
        </svg>
        <div className="relative flex-1">
          <h2 className="type-display text-white text-balance">{L.finalTitle}</h2>
          <p className="type-body text-white mt-3 max-w-[52ch] text-pretty">{L.finalBody}</p>
        </div>
        <button
          type="button"
          onClick={() => setStage("auth")}
          className="relative h-12 px-6 rounded-md bg-white text-accent-w-dark type-body-strong press-scale focus-visible:outline-white shrink-0 inline-flex items-center gap-2"
        >
          {L.finalCta}
          <WlIcon name="chevron" size={16} className={cn(lang === "ar" && "scale-x-[-1]")} />
        </button>
      </motion.div>
    </section>
  );
}

// ── Footer (sticky to bottom, pushed naturally on overflow) ───────────────
function LandingFooter() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 justify-between">
        <div className="flex items-center gap-2 text-ink-400">
          <WlIcon name="waterline" size={16} />
          <span className="type-caption">{T.appName} · {T.landing.footerNote}</span>
        </div>
        <span className="type-caption text-ink-400">{T.appTagline}</span>
      </div>
    </footer>
  );
}

// ── View ──────────────────────────────────────────────────────────────────
export function LandingView() {
  const lang = useUi((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const smoothRef = useRef(false);

  // Smooth anchor scrolling while the landing page is mounted (restored on unmount).
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "smooth";
    smoothRef.current = true;
    return () => {
      html.style.scrollBehavior = prev;
      smoothRef.current = false;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background" dir={dir}>
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <div className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8">
          <LiveStats />
        </div>
        <Pillars />
        <HowItWorks />
        <Trust />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
