"use client";

// WATERLINE — onboarding & consent first-run (PRD 4.1). Three minutes, zero
// documents: identity already verified through du SSO + UAE Pass, scoped
// consents presented one purpose per toggle (each showing exactly what it
// unlocks), and the ACTIVATION MOMENT — the indicative limit derived from du
// billing history alone, before any invoice is uploaded. Shown once per
// browser (persisted dismissal); consents stay manageable in the ops console.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useOverview, useConsents, useGrantConsent, useRevokeConsent } from "@/hooks/waterline";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WlIcon, WaterlineLogo } from "./icons";
import { Money } from "./money";
import { StatusDot } from "./primitives";

const STORAGE_KEY = "wl-onboarding-done";

const PURPOSES = ["billing_history", "bank_data", "buyer_contact"] as const;
type Purpose = (typeof PURPOSES)[number];

export function OnboardingFlow() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const { data: overview } = useOverview();
  const { data: consents } = useConsents();
  const grant = useGrantConsent();
  const revoke = useRevokeConsent();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // First visit only — the tour never nags; consents remain in the ops console.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
      } catch {
        // storage unavailable (private mode) — skip the tour rather than nag
      }
    }, 600);
    return () => clearTimeout(id);
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  if (!overview) return null;

  const consentByPurpose = new Map(
    (consents?.consents ?? []).map((c) => [c.purpose, c]),
  );
  const e = overview.entity;
  const meta = T.consents as unknown as Record<string, string>;
  const labelOf = (p: Purpose) => meta[p] ?? p;
  const hintOf = (p: Purpose) => meta[`${p}_hint`] ?? "";

  const steps = [1, 2, 3];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && finish()}>
      <DialogContent
        className="max-w-[480px] p-0 overflow-hidden gap-0"
        onPointerDown={(ev) => ev.stopPropagation()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{T.onboarding.s1Title}</DialogTitle>
          <DialogDescription>{T.onboarding.s1Body}</DialogDescription>
        </DialogHeader>

        {/* Header band — the waterline motif carries the brand */}
        <div className="grad-horizon relative px-6 pt-6 pb-5 border-b border-border">
          <div className="absolute bottom-3 inset-x-6"><div className="waterline-rule" /></div>
          <div className="flex items-center gap-3">
            <WaterlineLogo size={34} />
            <div>
              <div className="type-heading tracking-wide">{T.appName}</div>
              <div className="type-caption text-ink-400">{T.appTagline}</div>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 min-h-[300px] flex flex-col">
          {/* Step rail */}
          <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "h-1 rounded-full transition-all duration-[240ms]",
                  i === step ? "w-8 bg-accent-w" : i < step ? "w-4 bg-accent-w/50" : "w-4 bg-ink-200 dark:bg-ink-600"
                )}
              />
            ))}
            <span className="ms-auto type-label text-ink-600 font-semibold">{T.onboarding.step(step + 1)}</span>
          </div>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="s1"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                className="flex-1"
              >
                <div className="type-title">{T.onboarding.s1Title}</div>
                <p className="type-body text-ink-600 mt-2">{T.onboarding.s1Body}</p>

                <div className="mt-4 rounded-[10px] border border-border bg-card p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="type-body-strong">{e.legalName}</span>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone="success" />
                      <span className="type-caption text-success-w">{T.onboarding.s1Kyb}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 type-caption text-ink-400">
                    <WlIcon name="consent" size={14} />
                    {T.onboarding.s1Licence(e.licenceDaysRemaining)}
                  </div>
                  <div className="flex items-center gap-2 type-caption text-ink-400">
                    <WlIcon name="buyer" size={14} />
                    {T.onboarding.s1Emirate(e.emirate)}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="s2"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                className="flex-1"
              >
                <div className="type-title">{T.onboarding.s2Title}</div>
                <p className="type-caption text-ink-400 mt-1 mb-3">{T.onboarding.s2Body}</p>
                <div className="space-y-2">
                  {PURPOSES.map((p) => {
                    const c = consentByPurpose.get(p);
                    const granted = !!c && !c.revokedAt;
                    return (
                      <div
                        key={p}
                        className={cn(
                          "rounded-[10px] border p-3.5 flex items-center justify-between gap-3 transition-colors",
                          granted ? "border-success-w/30 bg-success-w/5" : "border-border bg-card"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="type-body-strong">{labelOf(p)}</div>
                          <div className="type-caption text-ink-400 mt-0.5">{hintOf(p)}</div>
                        </div>
                        <button
                          type="button"
                          disabled={grant.isPending || revoke.isPending}
                          onClick={() => (granted ? revoke.mutate(c!.id) : grant.mutate(p))}
                          className={cn(
                            "h-9 px-3.5 rounded-md type-caption font-semibold press-scale shrink-0 border",
                            granted
                              ? "border-success-w/40 text-success-w bg-success-w/10"
                              : "border-border text-ink-600 hover:border-accent-w/50 hover:text-accent-w-dark"
                          )}
                        >
                          {granted ? T.onboarding.granted : T.consents.grant}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="type-caption text-ink-400 mt-3 ps-1">{T.consents.revokesIn60s}</div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="s3"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                className="flex-1 flex flex-col"
              >
                <div className="type-title">{T.onboarding.s3Title}</div>
                <p className="type-caption text-ink-400 mt-1">{T.onboarding.s3Body}</p>

                <div className="my-5 rounded-[16px] grad-liquidity text-white p-5 elev-1">
                  <div className="type-label opacity-80">{T.onboarding.s3Badge}</div>
                  {overview.indicativeLimitFils != null ? (
                    <Money fils={overview.indicativeLimitFils} size="display" className="text-white" animate={false} whole={false} />
                  ) : (
                    <div className="type-display money">—</div>
                  )}
                </div>

                <p className="type-caption text-ink-400">{T.onboarding.s3Note}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-3 mt-5">
            <button
              type="button"
              onClick={finish}
              className="type-caption text-ink-600 underline underline-offset-4 decoration-ink-200 dark:decoration-ink-600 hover:text-danger-w hover:decoration-danger-w/50 press-scale transition-colors"
            >
              {T.onboarding.skip}
            </button>
            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="h-11 px-5 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1"
              >
                {T.onboarding.next}
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                className="h-11 px-5 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1"
              >
                {T.onboarding.start}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
