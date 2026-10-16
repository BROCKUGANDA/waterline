"use client";

// WATERLINE — app shell. Desktop: left rail 240px, collapsible to 64px with
// persistent tooltips. Mobile: four-tab bottom bar with labels always
// visible — icon-only navigation fails users under stress, which is exactly
// when this product is used (PRD 11.7).

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useUi, type View } from "@/stores/ui";
import { t, type Lang } from "@/lib/i18n";
import { WlIcon, WaterlineLogo, type WlIconName } from "./icons";
import { useStatus } from "@/hooks/waterline";
import { StatusBanner } from "./status-banner";
import { AdvisorPanel } from "./advisor";
import { OnboardingFlow } from "./onboarding";
import { cn } from "@/lib/utils";

const NAV: { view: View; icon: WlIconName; label: (l: Lang) => string }[] = [
  { view: "cash", icon: "wallet", label: (l) => t(l).nav.cash },
  { view: "invoices", icon: "invoice", label: (l) => t(l).nav.invoices },
  { view: "escrow", icon: "escrow-lock", label: (l) => t(l).nav.escrow },
  { view: "activity", icon: "activity", label: (l) => t(l).nav.activity },
];

const OPS_NAV: { view: View; icon: WlIconName; label: (l: Lang) => string }[] = [
  { view: "ops", icon: "terminal", label: (l) => t(l).nav.ops },
];

function RailButton({
  active, icon, label, collapsed, onClick, onHover,
}: {
  active: boolean; icon: WlIconName; label: string; collapsed: boolean; onClick: () => void; onHover?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "relative w-full flex items-center gap-3 rounded-md px-3 py-2.5 type-body transition-colors press-scale",
        active
          ? "bg-accent-w-soft text-accent-w-dark font-semibold"
          : "text-ink-600 hover:bg-surface-2 hover:text-foreground"
      )}
    >
      {/* Active accent — a 3px bar on the leading edge, unmistakable at a glance */}
      {active && (
        <motion.span
          layoutId="rail-active"
          className="absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-full grad-liquidity"
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        />
      )}
      <WlIcon name={icon} size={20} filled={active} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

function MobileTabButton({
  n, active, lang, onSelect,
}: {
  n: { view: View; icon: WlIconName; label: (l: Lang) => string };
  active: boolean;
  lang: Lang;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className="relative h-16 flex flex-col items-center justify-center gap-1 press-scale"
    >
      {active && (
        <motion.span
          layoutId="mobile-tab"
          className="absolute top-0 inset-x-4 h-[2px] grad-liquidity rounded-full"
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        />
      )}
      <WlIcon name={n.icon} size={22} filled={active} className={active ? "text-accent-w" : "text-ink-400"} />
      <span className={cn("type-caption", active ? "text-accent-w-dark font-semibold" : "text-ink-400")}>{n.label(lang)}</span>
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { view, setView, lang, toggleLang, railCollapsed, toggleRail, setAdvisorOpen, persona, signOut } = useUi();
  // The footer names the pack that decides right now — published on
  // /api/status, never hardcoded (M1 activates the cautious delta).
  const { data: status } = useStatus();
  const { theme, setTheme } = useTheme();
  const T = t(lang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  // next-themes resolves AFTER mount — render the pre-mount branch that
  // matches the server (no "dark" on SSR) so hydration never mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);
  const isDark = mounted && theme === "dark";

  return (
    <div className="min-h-screen flex flex-col bg-background" dir={dir}>
      <StatusBanner />

      <div className="flex flex-1 min-h-0">
        {/* Desktop rail */}
        <aside
          className={cn(
            "hidden md:flex flex-col shrink-0 border-e border-border bg-sidebar transition-[width] duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] sticky top-0 h-screen",
            railCollapsed ? "w-16" : "w-60"
          )}
        >
          <div className="flex items-center gap-3 px-4 h-16">
            <WaterlineLogo size={railCollapsed ? 28 : 32} />
            {!railCollapsed && (
              <div className="min-w-0">
                <div className="type-heading tracking-wide">{T.appName}</div>
                <div className="type-caption text-ink-400 leading-snug">{T.appTagline}</div>
              </div>
            )}
          </div>

          <nav className="flex-1 px-2 space-y-1 mt-2" aria-label="Primary">
            {NAV.map((n) => (
              <RailButton
                key={n.view}
                active={view === n.view}
                icon={n.icon}
                label={n.label(lang)}
                collapsed={railCollapsed}
                onClick={() => setView(n.view)}
              />
            ))}
            <div className="h-px bg-border my-2 mx-2" />
            {OPS_NAV.map((n) => (
              <RailButton
                key={n.view}
                active={view === n.view}
                icon={n.icon}
                label={n.label(lang)}
                collapsed={railCollapsed}
                onClick={() => setView(n.view)}
              />
            ))}
          </nav>

          {/* Utilities — separated from navigation by a rule (PRD 11.5 rail anatomy) */}
          <div className="p-2 space-y-1 border-t border-border">
            {/* Demo session identity — the persona from the auth screen,
                always visible, with sign-out one click away. */}
            {!railCollapsed && (
              <div className="flex items-center gap-2.5 rounded-md px-3 py-2 bg-surface-2/70">
                <span className="h-7 w-7 rounded-full bg-accent-w-soft border border-accent-w/30 flex items-center justify-center shrink-0">
                  <WlIcon name={persona === "operator" ? "terminal" : "buyer"} size={14} className="text-accent-w-dark" />
                </span>
                <div className="min-w-0">
                  <div className="type-caption font-semibold text-foreground truncate">{persona === "operator" ? T.session.operatorName : T.session.smeName}</div>
                  <div className="type-caption text-ink-400 truncate">{persona === "operator" ? T.session.operator : T.session.sme}</div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-3 rounded-md px-3 py-2 type-caption text-ink-600 hover:bg-surface-2 press-scale"
              title={T.session.signOut}
            >
              <WlIcon name="sign-out" size={20} className={cn("text-ink-400", lang === "ar" && "scale-x-[-1]")} />
              {!railCollapsed && <span>{T.session.signOut}</span>}
            </button>
            {/* Advisor launcher — explains, never decides. Lives in the rail on
                desktop so nothing floats over money figures (PRD 11.1). */}
            <button
              type="button"
              onClick={() => setAdvisorOpen(true)}
              className="w-full flex items-center gap-3 rounded-md px-3 py-2 type-caption text-ink-600 hover:bg-accent-w-soft hover:text-accent-w-dark press-scale"
              title={T.advisor.title}
            >
              <WlIcon name="advisor" size={20} className="text-accent-w" />
              {!railCollapsed && <span>{T.advisor.title}</span>}
            </button>
            <button
              type="button"
              onClick={toggleLang}
              className="w-full flex items-center gap-3 rounded-md px-3 py-2 type-caption text-ink-600 hover:bg-surface-2 press-scale"
              title="العربية / English"
            >
              <WlIcon name="globe" size={20} />
              {!railCollapsed && <span>{lang === "en" ? "العربية" : "English"}</span>}
            </button>
            <button
              type="button"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="w-full flex items-center gap-3 rounded-md px-3 py-2 type-caption text-ink-600 hover:bg-surface-2 press-scale"
              title={isDark ? T.settings.light : T.settings.dark}
            >
              <WlIcon name={isDark ? "sun" : "moon"} size={20} />
              {!railCollapsed && <span>{isDark ? T.settings.light : T.settings.dark}</span>}
            </button>
            <button
              type="button"
              onClick={toggleRail}
              className="w-full hidden lg:flex items-center gap-3 rounded-md px-3 py-2 type-caption text-ink-400 hover:bg-surface-2 press-scale"
              title={railCollapsed ? T.expandRail : T.collapseRail}
            >
              <WlIcon name="chevron" size={20} className={cn("transition-transform", railCollapsed ? "" : "rotate-180", lang === "ar" && "scale-x-[-1]")} />
              {!railCollapsed && <span>{T.collapseRail}</span>}
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile header */}
          <header className="md:hidden sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
            <div className="flex items-center gap-3 px-4 h-14">
              <WaterlineLogo size={26} />
              <div className="min-w-0 flex-1">
                <div className="type-body-strong">{T.appName}</div>
              </div>
              <button type="button" onClick={toggleLang} aria-label="Language" className="h-11 w-11 flex items-center justify-center rounded-md text-ink-600 press-scale">
                <WlIcon name="globe" size={20} />
              </button>
              <button
                type="button"
                onClick={() => setTheme(isDark ? "light" : "dark")}
                aria-label={T.settings.theme}
                className="h-11 w-11 flex items-center justify-center rounded-md text-ink-600 press-scale"
              >
                <WlIcon name={isDark ? "sun" : "moon"} size={20} />
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label={T.session.signOut}
                className="h-11 w-11 flex items-center justify-center rounded-md text-ink-600 press-scale"
              >
                <WlIcon name="sign-out" size={20} className={cn(lang === "ar" && "scale-x-[-1]")} />
              </button>
              <button
                type="button"
                onClick={() => setView("ops")}
                aria-label={T.nav.ops}
                className={cn("h-11 w-11 flex items-center justify-center rounded-md press-scale", view === "ops" ? "text-accent-w" : "text-ink-600")}
              >
                <WlIcon name="terminal" size={20} />
              </button>
            </div>
          </header>

          <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-28 md:pb-10">
            {children}
          </main>

          {/* Footer — sticky to bottom, pushed naturally on overflow */}
          <footer className="mt-auto border-t border-border bg-background">
            <div className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 justify-between">
              <div className="flex items-center gap-2 text-ink-400">
                <WlIcon name="waterline" size={16} />
                <span className="type-caption">
                  {T.appName} · du SME Challenge — Theme 2 · Creating Liquidity
                </span>
              </div>
              <span
                className="type-caption text-ink-400"
                title={status?.rulePacks?.activeVersion}
              >
                {T.footerPack(status?.rulePacks?.activeVersion ?? "2026.10.3", status?.mode === "M1")}
              </span>
            </div>
          </footer>
        </div>
      </div>

      {/* AI advisor — explains, never decides; absent in M4 */}
      <AdvisorPanel />

      {/* First-run onboarding & consent tour (PRD 4.1) — once per browser */}
      <OnboardingFlow />

      {/* Mobile bottom bar — four tabs + a centred advisor dock. The advisor
          lives IN the bar (not a floating FAB): nothing may ever float over
          money figures (PRD 11.1 state-before-action). */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary mobile"
      >
        <div className="grid grid-cols-5 items-end relative">
          {NAV.slice(0, 2).map((n) => (
            <MobileTabButton key={n.view} n={n} active={view === n.view} lang={lang} onSelect={() => setView(n.view)} />
          ))}
          {/* Advisor dock — raised circular gradient button, centred */}
          <div className="relative flex justify-center">
            <button
              type="button"
              onClick={() => setAdvisorOpen(true)}
              aria-label={t(lang).advisor.title}
              aria-haspopup="dialog"
              className="absolute -top-5 h-12 w-12 rounded-full grad-liquidity text-white elev-2 press-scale flex items-center justify-center ring-4 ring-background transition-transform hover:scale-105 focus-visible:scale-105"
            >
              <WlIcon name="advisor" size={22} />
            </button>
            <span className="type-caption text-ink-400 pb-2 pt-7">{t(lang).advisor.dockLabel}</span>
          </div>
          {NAV.slice(2).map((n) => (
            <MobileTabButton key={n.view} n={n} active={view === n.view} lang={lang} onSelect={() => setView(n.view)} />
          ))}
        </div>
      </nav>
    </div>
  );
}
