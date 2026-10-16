"use client";

// WATERLINE UI state — client-side navigation, language, selection.
// The session gate (landing → auth → app) is a client-side stage machine:
// only "/" is user-visible, so the pre-auth surfaces live as views inside
// the same route (judges land on the marketing page, sign in via the demo
// personas, and the app shell takes over).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Lang } from "@/lib/i18n";

export type View = "cash" | "invoices" | "escrow" | "activity" | "ops";

/** Pre-auth surfaces — see page.tsx for the gate. */
export type Stage = "landing" | "auth" | "app";

/** Demo personas for judges: the SME tenant, or the du platform operator. */
export type Persona = "sme" | "operator";

interface UiState {
  stage: Stage;
  persona: Persona | null;
  view: View;
  lang: Lang;
  railCollapsed: boolean;
  selectedInvoiceId: string | null; // side-panel / sheet selection
  quoteInvoiceId: string | null; // invoice currently in the quote flow
  advisorOpen: boolean; // advisor sheet — opened from the rail (desktop) or FAB (mobile)
  advisorSeed: string | null; // a pre-filled question from a deep-link (e.g. forecast gap) — consumed once on open
  setStage: (s: Stage) => void;
  /** Enter the product as a demo persona — operators land on the ops console. */
  signIn: (p: Persona) => void;
  /** Leave the product — back to the landing page, persona cleared. */
  signOut: () => void;
  setView: (v: View) => void;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  toggleRail: () => void;
  selectInvoice: (id: string | null) => void;
  setQuoteInvoice: (id: string | null) => void;
  setAdvisorOpen: (v: boolean) => void;
  setAdvisorSeed: (seed: string | null) => void;
  /** Deep-link helper: seed a question and open the sheet in one action. */
  askAdvisor: (seed: string) => void;
  /** Deep-link helper: jump to the Invoices view with an invoice selected. */
  openInvoice: (id: string) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      stage: "landing",
      persona: null,
      view: "cash",
      lang: "en",
      railCollapsed: false,
      selectedInvoiceId: null,
      quoteInvoiceId: null,
      advisorOpen: false,
      advisorSeed: null,
      setStage: (stage) => set({ stage }),
      signIn: (persona) =>
        set({ stage: "app", persona, view: persona === "operator" ? "ops" : "cash", selectedInvoiceId: null, quoteInvoiceId: null }),
      signOut: () => set({ stage: "landing", persona: null, view: "cash", advisorOpen: false, advisorSeed: null, selectedInvoiceId: null, quoteInvoiceId: null }),
      setView: (view) => set({ view, selectedInvoiceId: null, quoteInvoiceId: null }),
      setLang: (lang) => set({ lang }),
      toggleLang: () => set((s) => ({ lang: s.lang === "en" ? "ar" : "en" })),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      selectInvoice: (selectedInvoiceId) => set({ selectedInvoiceId }),
      setQuoteInvoice: (quoteInvoiceId) => set({ quoteInvoiceId }),
      setAdvisorOpen: (advisorOpen) => set({ advisorOpen }),
      setAdvisorSeed: (advisorSeed) => set({ advisorSeed }),
      askAdvisor: (seed) => set({ advisorSeed: seed, advisorOpen: true }),
      openInvoice: (id) => set({ view: "invoices", selectedInvoiceId: id, quoteInvoiceId: null }),
    }),
    {
      name: "waterline-ui",
      // view is persisted so a signed-in judge resumes where they were;
      // stage/persona persist the session so reloads stay in the product.
      partialize: (s) => ({ lang: s.lang, railCollapsed: s.railCollapsed, view: s.view, stage: s.stage, persona: s.persona }),
    }
  )
);
