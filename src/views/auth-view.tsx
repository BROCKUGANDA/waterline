"use client";

// WATERLINE — auth screen. Two honest doors into the same demo tenant:
// (1) the judge demo access — one click per persona, no credentials; the
//     POST /api/auth/demo route validates the persona and returns the
//     tenant identity (read-only: auth is not a money event, the ledger
//     and the append-only decision record stay untouched);
// (2) the du Business ID form — any credentials sign in as the SME, the
//     documented stand-in for production du Business SSO.
// Bilingual + RTL + dark by construction.

import { useState } from "react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useUi, type Persona } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { WlIcon, WaterlineLogo, type WlIconName } from "@/components/waterline/icons";
import { StatusDot } from "@/components/waterline/primitives";
import { useOverview } from "@/hooks/waterline";
import { Money } from "@/components/waterline/money";
import { cn } from "@/lib/utils";

// ── Persona row — the one-click judge doors ───────────────────────────────
function PersonaCard({
  persona, icon, name, meta, desc, cta, pending, onEnter,
}: {
  persona: Persona;
  icon: WlIconName;
  name: string;
  meta: string;
  desc: string;
  cta: string;
  pending: Persona | null;
  onEnter: (p: Persona) => void;
}) {
  const busy = pending === persona;
  const lang = useUi((s) => s.lang);
  return (
    <div
      className={cn(
        "rounded-[10px] border p-4 transition-colors",
        busy ? "border-accent-w/50 bg-accent-w-soft" : "border-border bg-surface-2/60 hover:border-accent-w/30"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-md flex items-center justify-center shrink-0 border",
            persona === "sme" ? "bg-accent-w-soft border-accent-w/30" : "bg-escrow-w/10 border-escrow-w/30"
          )}
        >
          <WlIcon name={icon} size={20} className={persona === "sme" ? "text-accent-w" : "text-escrow-w"} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="type-body-strong truncate">{name}</div>
          <div className="type-caption text-ink-400 mt-0.5 truncate">{meta}</div>
          <div className="type-caption text-ink-600 mt-1.5 leading-snug">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => onEnter(persona)}
        className={cn(
          "mt-3 w-full h-11 rounded-md type-body-strong press-scale inline-flex items-center justify-center gap-2 transition-colors",
          persona === "sme"
            ? "grad-liquidity text-white elev-1 focus-visible:outline-white"
            : "border border-escrow-w/40 bg-card text-escrow-w hover:bg-escrow-w/10"
        )}
      >
        {busy ? (
          <>
            <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />
            <span className="type-caption">…</span>
          </>
        ) : (
          <>
            {cta}
            <WlIcon name="chevron" size={16} className={cn(lang === "ar" && "scale-x-[-1]")} />
          </>
        )}
      </button>
    </div>
  );
}

// ── Left panel — the brand narrative with live figures ────────────────────
function BrandPanel() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const { data } = useOverview();

  const rows = [
    { icon: "invoice-verified" as WlIconName, text: T.landing.pillar1Title, detail: T.landing.pillar1Body },
    { icon: "escrow-lock" as WlIconName, text: T.landing.pillar2Title, detail: T.landing.pillar2Body },
    { icon: "treasury-sweep" as WlIconName, text: T.landing.pillar3Title, detail: T.landing.pillar3Body },
  ];

  return (
    <aside className="hidden lg:flex flex-col gap-6 p-10 xl:p-14 grad-liquidity text-white relative overflow-hidden">
      {/* Waterline glyph as texture */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.10] pointer-events-none" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 400 400">
        <path d="M0 180h400" stroke="white" strokeWidth="1.5" />
        <path d="M0 220h400" stroke="white" strokeWidth="6" />
      </svg>

      <div className="relative">
        <div className="flex items-center gap-3">
          <WaterlineLogo size={40} />
          <div>
            <div className="type-heading tracking-wide text-white">{T.appName}</div>
            <div className="type-caption text-white">{T.appTagline}</div>
          </div>
        </div>
      </div>

      <div className="relative space-y-5 flex-1">
        {rows.map((r) => (
          <div key={r.text} className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-white/12 border border-white/25 flex items-center justify-center shrink-0">
              <WlIcon name={r.icon} size={18} />
            </div>
            <div className="min-w-0">
              <div className="type-body-strong text-white">{r.text}</div>
              <div className="type-caption text-white mt-1 leading-snug max-w-[40ch]">{r.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Live demo figures — the real /api/overview numbers. The panel is
          DARKENED (bg-black/15), never lightened: white labels must clear
          AA against whatever the gradient shows behind it. */}
      <div className="relative rounded-[10px] bg-black/15 border border-white/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <StatusDot tone="success" pulse />
          <span className="type-label text-white">{T.landing.liveLabel}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="type-caption text-white">{T.landing.statAvailable}</span>
          {data ? (
            <Money fils={data.balance.walletFils} size="heading" whole={false} animate={false} />
          ) : (
            <span className="shimmer rounded-md h-6 w-28 inline-block" />
          )}
        </div>
        {data && (
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="type-caption text-white">{T.landing.statApproved}</span>
            <Money fils={data.liquidity.totalApprovedFils} size="caption" whole={true} animate={false} />
          </div>
        )}
      </div>
    </aside>
  );
}

// ── View ──────────────────────────────────────────────────────────────────
export function AuthView() {
  const { lang, toggleLang, setStage, signIn } = useUi();
  const { theme, setTheme } = useTheme();
  const T = t(lang);
  const A = T.auth;

  const [pending, setPending] = useState<Persona | null>(null);
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  const isDark = theme === "dark";
  const dir = lang === "ar" ? "rtl" : "ltr";

  // Shared sign-in path: validate via the API, then enter the product.
  async function enter(p: Persona) {
    if (pending !== null) return;
    setPending(p);
    setFormError(null);
    try {
      const res = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: p, via: p === "sme" && mobile ? "form" : "judge-oneclick" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { ok?: boolean };
      if (!json.ok) throw new Error("rejected");
      const name = p === "sme" ? A.personaSmeName : A.personaOperatorName;
      toast.success(A.welcomeToast(name));
      signIn(p);
    } catch {
      setFormError(A.errorFailed);
      toast.error(A.errorFailed);
    } finally {
      setPending(null);
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (formBusy || pending !== null) return;
    if (!mobile.trim() || !password.trim()) {
      setFormError(A.errorEmpty);
      return;
    }
    setFormBusy(true);
    await enter("sme");
    setFormBusy(false);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background" dir={dir}>
      {/* Utility bar — back to landing, language, theme */}
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1240px] mx-auto px-4 md:px-6 lg:px-8 h-14 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStage("landing")}
            className="h-11 px-3 rounded-md flex items-center gap-2 type-caption text-ink-600 hover:bg-surface-2 press-scale"
          >
            <WlIcon name="chevron" size={16} className={cn(lang === "en" && "rotate-180")} />
            {A.backToLanding}
          </button>
          <div className="ms-auto flex items-center gap-1">
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
          </div>
        </div>
      </div>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
          className="w-full max-w-[1080px] rounded-[12px] border border-border bg-card elev-2 overflow-hidden grid lg:grid-cols-[1fr_1.05fr]"
        >
          <BrandPanel />

          <section className="p-6 md:p-10">
            <div className="flex items-center gap-3">
              <div className="lg:hidden">
                <WaterlineLogo size={34} />
              </div>
              <div className="min-w-0">
                <h1 className="type-title">{A.title}</h1>
                <p className="type-caption text-ink-600 mt-1">{A.subtitle}</p>
              </div>
            </div>

            {/* Judge demo access */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="type-label text-ink-400">{A.demoEyebrow}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
              <p className="type-caption text-ink-400 mb-3">{A.demoHint}</p>
              <div className="space-y-3">
                <PersonaCard
                  persona="sme"
                  icon="buyer"
                  name={A.personaSmeName}
                  meta={A.personaSmeMeta}
                  desc={A.personaSmeDesc}
                  cta={A.enterAsSme}
                  pending={pending}
                  onEnter={enter}
                />
                <PersonaCard
                  persona="operator"
                  icon="terminal"
                  name={A.personaOperatorName}
                  meta={A.personaOperatorMeta}
                  desc={A.personaOperatorDesc}
                  cta={A.enterAsOperator}
                  pending={pending}
                  onEnter={enter}
                />
              </div>
            </div>

            {/* Manual form */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="type-label text-ink-400">{A.orEmail}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
              <form onSubmit={submitForm} noValidate className="space-y-4">
                <div>
                  <label htmlFor="wl-du-id" className="block type-caption text-ink-600 mb-1.5">
                    {A.fieldId} <span className="text-ink-400">· {A.fieldIdHint}</span>
                  </label>
                  <div className="relative">
                    <WlIcon name="phone" size={17} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                    <input
                      id="wl-du-id"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      value={mobile}
                      onChange={(e) => { setMobile(e.target.value); setFormError(null); }}
                      placeholder="+971 5• ••• ••••"
                      className="w-full h-11 rounded-md border border-border bg-background ps-10 pe-3 type-body text-start placeholder:text-ink-400 focus:border-accent-w/60 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="wl-pass" className="block type-caption text-ink-600 mb-1.5">
                    {A.fieldPassword} <span className="text-ink-400">· {A.fieldPasswordHint}</span>
                  </label>
                  <input
                    id="wl-pass"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setFormError(null); }}
                    className="w-full h-11 rounded-md border border-border bg-background px-3 type-body focus:border-accent-w/60 outline-none"
                  />
                </div>

                {formError && (
                  <div className="flex items-center gap-2 text-danger-w type-caption" role="alert">
                    <WlIcon name="alert" size={15} />
                    {formError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formBusy || pending !== null}
                  className="w-full h-12 rounded-md border border-accent-w/40 bg-card text-accent-w-dark type-body-strong hover:bg-accent-w-soft transition-colors press-scale inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {formBusy || pending === "sme" ? (
                    <>
                      <span className="h-4 w-4 rounded-full border-2 border-accent-w/30 border-t-accent-w animate-spin" aria-hidden="true" />
                      {A.signingIn}
                    </>
                  ) : (
                    A.submit
                  )}
                </button>
              </form>
            </div>

            <p className="type-caption text-ink-400 mt-6 flex items-start gap-2 leading-snug">
              <WlIcon name="info" size={14} className="mt-0.5 shrink-0" />
              {A.demoNote}
            </p>
          </section>
        </motion.div>
      </main>
    </div>
  );
}
