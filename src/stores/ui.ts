"use client";

// WATERLINE UI state — client-side navigation, language, selection.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Lang } from "@/lib/i18n";

export type View = "cash" | "invoices" | "escrow" | "activity" | "ops";

interface UiState {
  view: View;
  lang: Lang;
  railCollapsed: boolean;
  selectedInvoiceId: string | null; // side-panel / sheet selection
  quoteInvoiceId: string | null; // invoice currently in the quote flow
  advisorOpen: boolean; // advisor sheet — opened from the rail (desktop) or FAB (mobile)
  advisorSeed: string | null; // a pre-filled question from a deep-link (e.g. forecast gap) — consumed once on open
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
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      view: "cash",
      lang: "en",
      railCollapsed: false,
      selectedInvoiceId: null,
      quoteInvoiceId: null,
      advisorOpen: false,
      advisorSeed: null,
      setView: (view) => set({ view, selectedInvoiceId: null, quoteInvoiceId: null }),
      setLang: (lang) => set({ lang }),
      toggleLang: () => set((s) => ({ lang: s.lang === "en" ? "ar" : "en" })),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      selectInvoice: (selectedInvoiceId) => set({ selectedInvoiceId }),
      setQuoteInvoice: (quoteInvoiceId) => set({ quoteInvoiceId }),
      setAdvisorOpen: (advisorOpen) => set({ advisorOpen }),
      setAdvisorSeed: (advisorSeed) => set({ advisorSeed }),
      askAdvisor: (seed) => set({ advisorSeed: seed, advisorOpen: true }),
    }),
    {
      name: "waterline-ui",
      partialize: (s) => ({ lang: s.lang, railCollapsed: s.railCollapsed, view: s.view }),
    }
  )
);
