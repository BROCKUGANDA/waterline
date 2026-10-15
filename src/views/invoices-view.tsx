"use client";

// WATERLINE — Invoices view: the golden path. Quote → local fee modelling on
// the date slider → acceptance with server-side re-validation → the four
// named payout stages with real timestamps → the funding-confirmation
// choreography. Fee breakdown always expanded, never behind a disclosure
// (PRD 4.3 / 11.8 / 11.13).

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { toast } from "sonner";
import {
  useInvoices, useInvoiceDetail, useQuote, useAcceptOffer, usePayout,
  useConfirmInvoice, useSubmitInvoice, useSettleInvoice, useOverview,
} from "@/hooks/waterline";
import { InvoiceCard, InvoiceListSkeleton, EmptyState } from "@/components/waterline/invoice-card";
import { FeeBreakdown, DateSlider, type FeeModel } from "@/components/waterline/fee-breakdown";
import { DecisionReceipt } from "@/components/waterline/decision-receipt";
import { OutcomeCard } from "@/components/waterline/outcome-card";
import { StageTracker } from "@/components/waterline/stage-tracker";
import { Money } from "@/components/waterline/money";
import { SectionLabel, StatusDot, TierChip } from "@/components/waterline/primitives";
import { WlIcon } from "@/components/waterline/icons";
import { t } from "@/lib/i18n";
import { useUi } from "@/stores/ui";
import { parseAedToFils } from "@/lib/money";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { PayoutDto, QuoteResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "ready" | "pending" | "disputed" | "all";

/* ── Submit invoice dialog ─────────────────────────────────────────────── */
function SubmitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const T = t(useUi((s) => s.lang));
  const { data: overview } = useOverview();
  const submit = useSubmitInvoice();
  const [buyer, setBuyer] = useState("");
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const buyers = overview?.buyers ?? [];
  const grossFils = parseAedToFils(amount);

  const doSubmit = async () => {
    setErr(null);
    if (!buyer || !ref || !grossFils || !due) return setErr(T.errors.generic);
    if (!grossFils) return setErr(T.invoices.amount);
    try {
      await submit.mutateAsync({
        buyerLinkId: buyer,
        externalRef: ref,
        grossFils,
        dueDate: new Date(due + "T12:00:00").toISOString(),
      });
      toast.success(T.invoices.created);
      onOpenChange(false);
      setBuyer(""); setRef(""); setAmount(""); setDue("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : T.errors.generic;
      setErr(msg);
      if (msg.includes("uplicate")) toast(T.invoices.duplicate);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="type-title">{T.invoices.submitTitle}</DialogTitle>
          <p className="type-caption text-ink-400">{T.invoices.submitHint}</p>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="type-label text-ink-400 block mb-1.5">{T.invoices.buyer}</label>
            <div className="grid gap-1.5 max-h-40 overflow-y-auto wl-scroll">
              {buyers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBuyer(b.id)}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-start transition-colors",
                    buyer === b.id ? "border-accent-w bg-accent-w-soft/60" : "border-border hover:border-ink-200 dark:hover:border-ink-600"
                  )}
                >
                  <span className="type-body-strong truncate">{b.buyerName}</span>
                  <TierChip tier={b.tier} />
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="type-label text-ink-400 block mb-1.5">{T.invoices.invoiceRef}</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ESS-INV-2230" className="w-full h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w" />
            </div>
            <div>
              <label className="type-label text-ink-400 block mb-1.5">{T.invoices.amount}</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="18,500" dir="ltr" className="w-full h-10 rounded-md border border-border bg-card px-3 type-body money outline-none focus:border-accent-w" />
            </div>
          </div>
          <div>
            <label className="type-label text-ink-400 block mb-1.5">{T.invoices.dueDate}</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} dir="ltr" className="w-full h-10 rounded-md border border-border bg-card px-3 type-body outline-none focus:border-accent-w" />
          </div>
          {err && <div className="type-caption text-danger-w">{err}</div>}
          <button
            type="button"
            onClick={doSubmit}
            disabled={submit.isPending}
            className="w-full h-12 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1 disabled:opacity-50"
          >
            {submit.isPending ? T.common.loading : T.invoices.create}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Funding confirmation choreography (PRD 11.12) ─────────────────────── */
function SettledCelebration({ payout }: { payout: PayoutDto }) {
  const T = t(useUi((s) => s.lang));
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0, 0, 0, 1], delay: 0.24 }}
      className="rounded-[10px] border border-success-w/40 bg-success-w/10 p-4"
    >
      <div className="flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="var(--wl-success)" fillOpacity="0.15" stroke="var(--wl-success)" strokeWidth="1.75" />
          <path d="M13 20.5l4.5 4.5L27 15.5" fill="none" stroke="var(--wl-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-draw" />
        </svg>
        <div>
          <motion.div
            initial={{ y: 8, scale: 0.96 }}
            animate={{ y: 0, scale: 1.04 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
          >
            <div className="type-title">{T.invoices.settledTitle}</div>
          </motion.div>
          <div className="type-caption text-ink-600">{T.invoices.settledTo(payout.destinationRef)}</div>
        </div>
      </div>
      <div className="mt-2 flex justify-between items-baseline">
        <span className="type-label text-ink-400">{T.invoices.netProceeds}</span>
        <Money fils={payout.amountFils} size="amount" colorize="success" whole={false} />
      </div>
    </motion.div>
  );
}

function PayoutDialog({ payout, onClose }: { payout: PayoutDto | null; onClose: () => void }) {
  const T = t(useUi((s) => s.lang));
  const { data: live } = usePayout(payout?.id ?? null, !!payout && payout.state !== "settled");
  const p = live ?? payout;
  if (!p) return null;
  const settled = p.state === "settled";

  return (
    <Dialog open={!!payout} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[480px]" onPointerDown={(e) => settled && e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="type-title">{settled ? T.invoices.settledTitle : T.invoices.processing}</DialogTitle>
        </DialogHeader>
        {settled ? <SettledCelebration payout={p} /> : <StageTracker payout={p} amountFils={p.amountFils} />}
        {settled && (
          <button type="button" onClick={onClose} className="w-full h-11 rounded-md bg-surface-2 type-body-strong press-scale">
            {T.common.close}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Quote flow (inside detail panel) ──────────────────────────────────── */
function QuoteFlow({ invoiceId }: { invoiceId: string }) {
  const T = t(useUi((s) => s.lang));
  const quote = useQuote();
  const accept = useAcceptOffer();
  const { data: detail } = useInvoiceDetail(invoiceId);
  const [quoteData, setQuoteData] = useState<QuoteResponse | null>(null);
  const [daysEarly, setDaysEarly] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payout, setPayout] = useState<PayoutDto | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  const invoice = detail?.invoice;
  const offer = quoteData?.offer ?? null;
  const decision = quoteData?.decision ?? null;

  useEffect(() => {
    // auto-fetch a fresh quote when the panel opens on a fundable invoice —
    // the route expires prior offered offers and re-prices deterministically
    if (invoice && !quoteData && invoice.verificationState === "verified" && invoice.dueInDays > 0 && (invoice.fundingState === "none" || invoice.fundingState === "quoted")) {
      quote.mutate(invoiceId, {
        onSuccess: (d) => {
          setQuoteData(d);
          if (d.offer) setDaysEarly(Math.min(invoice.dueInDays, 14));
        },
      });
    }
  }, [invoice?.id, invoice?.verificationState, invoice?.fundingState, quoteData]);

  // expiry countdown
  useEffect(() => {
    if (!offer) return;
    const tick = () => setExpiresIn(Math.max(0, Math.floor((new Date(offer.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [offer?.expiresAt]);

  const model: FeeModel | null = useMemo(() => {
    if (!offer || !invoice) return null;
    return { principalFils: offer.principalFils, rateMilliBps: offer.rateMilliBps, maxDaysEarly: Math.max(1, invoice.dueInDays) };
  }, [offer, invoice]);

  const doAccept = async () => {
    if (!offer) return;
    try {
      const res = await accept.mutateAsync({ offerId: offer.id, daysEarly });
      setConfirmOpen(false);
      setPayout(res.payout);
    } catch (e) {
      setConfirmOpen(false);
      const msg = e instanceof Error ? e.message : "";
      if (msg.toLowerCase().includes("expire") || msg.toLowerCase().includes("price") || msg.toLowerCase().includes("lapsed")) {
        toast.error(T.errors.offerExpired);
        setQuoteData(null);
      } else {
        toast.error(msg || T.errors.generic);
      }
    }
  };

  if (invoice?.fundingState === "accepted" || invoice?.fundingState === "settled") {
    const p = detail?.payout ?? payout;
    return (
      <div className="space-y-3">
        <div className="rounded-[10px] border border-success-w/40 bg-success-w/10 p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="success" />
            <span className="type-body-strong">
              {invoice.fundingState === "settled" ? T.invoices.settled : T.invoices.funded}
            </span>
          </div>
          {invoice.latestOffer?.netProceedsFils != null && (
            <div className="mt-2 flex justify-between items-baseline">
              <span className="type-label text-ink-400">{T.invoices.netProceeds}</span>
              <Money fils={invoice.latestOffer.netProceedsFils} size="heading" colorize="success" whole={false} />
            </div>
          )}
        </div>
        {p && p.state !== "settled" && <StageTracker payout={p as PayoutDto} amountFils={(p as PayoutDto).amountFils} />}
        {invoice.fundingState === "accepted" && <SettleButton invoiceId={invoiceId} />}
      </div>
    );
  }

  const unquotable = invoice && (invoice.verificationState !== "verified" || invoice.dueInDays <= 0);
  if (unquotable && !quoteData) {
    return (
      <div className="space-y-3">
        <div className="rounded-[10px] border border-border bg-surface-2/60 p-4">
          <div className="flex items-start gap-2.5">
            <WlIcon name={invoice!.dueInDays <= 0 ? "invoice-disputed" : "invoice"} size={18} className="text-ink-400 mt-0.5" />
            <div>
              <div className="type-body-strong">{T.invoices.rejectedTitle}</div>
              <div className="type-caption text-ink-400 mt-0.5">
                {invoice!.verificationState !== "verified" ? T.invoices.waitingBuyer : T.invoices.overdue(-invoice!.dueInDays)}
              </div>
            </div>
          </div>
          {invoice!.verificationState === "deduped" && <ConfirmBuyerButton invoiceId={invoiceId} />}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {quote.isPending && <div className="shimmer rounded-[10px] h-40" />}

      {quoteData && decision && offer && model && decision.outcome !== "rejected" && (
        <>
          <div>
            <div className="type-heading mb-0.5">{T.invoices.quoteTitle}</div>
            {expiresIn !== null && (
              <div className="type-caption text-ink-400 flex items-center gap-1.5">
                <StatusDot tone={expiresIn > 30 ? "accent" : "caution"} pulse={expiresIn <= 30} />
                {expiresIn > 0 ? `${T.common.expires} ${expiresIn}s` : T.common.expired}
              </div>
            )}
          </div>

          <div className="flex items-baseline justify-between">
            <span className="type-label text-ink-400">{T.invoices.principal}</span>
            <Money fils={offer.principalFils} size="amount" colorize="accent" whole={false} />
          </div>

          <DateSlider model={model} daysEarly={daysEarly || 1} onChange={setDaysEarly} />
          <FeeBreakdown model={model} daysEarly={daysEarly || 1} />

          {expiresIn !== null && expiresIn > 0 ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="w-full h-12 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1"
            >
              {T.common.accept}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setQuoteData(null); quote.mutate(invoiceId, { onSuccess: (d) => { setQuoteData(d); if (d.offer && invoice) setDaysEarly(Math.min(invoice.dueInDays, 14)); } }); }}
              className="w-full h-12 rounded-md bg-accent-w-soft text-accent-w-dark border border-accent-w/40 type-body-strong press-scale"
            >
              {T.invoices.requote}
            </button>
          )}

          <DecisionReceipt decision={decision} compact />
        </>
      )}

      {quoteData && decision && !offer && <OutcomeCard decision={decision} />}

      {/* Acceptance modal — blocking, for irreversible confirmation only */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="type-title">{T.invoices.acceptTitle}</DialogTitle>
          </DialogHeader>
          <p className="type-body text-ink-600">{T.invoices.acceptBody}</p>
          {model && <FeeBreakdown model={model} daysEarly={daysEarly || 1} />}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="flex-1 h-12 rounded-md bg-surface-2 type-body-strong press-scale"
            >
              {T.common.cancel}
            </button>
            <button
              type="button"
              onClick={doAccept}
              disabled={accept.isPending}
              className="flex-1 h-12 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1 disabled:opacity-50"
            >
              {accept.isPending ? T.common.loading : T.common.accept}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <PayoutDialog payout={payout} onClose={() => setPayout(null)} />
    </div>
  );
}

function SettleButton({ invoiceId }: { invoiceId: string }) {
  const T = t(useUi((s) => s.lang));
  const settle = useSettleInvoice();
  return (
    <button
      type="button"
      onClick={() =>
        settle.mutate(invoiceId, {
          onSuccess: () => toast.success(T.invoices.settled),
          onError: () => toast.error(T.errors.generic),
        })
      }
      disabled={settle.isPending}
      className="w-full h-11 rounded-md border border-success-w/40 text-success-w type-body-strong press-scale flex items-center justify-center gap-2 disabled:opacity-50"
    >
      <WlIcon name="buyer" size={15} />
      {settle.isPending ? T.common.loading : T.common.settle}
    </button>
  );
}

function ConfirmBuyerButton({ invoiceId }: { invoiceId: string }) {
  const T = t(useUi((s) => s.lang));
  const confirm = useConfirmInvoice();
  return (
    <button
      type="button"
      onClick={() => confirm.mutate(invoiceId, { onSuccess: () => toast.success(T.invoices.confirmed) })}
      disabled={confirm.isPending}
      className="mt-3 w-full h-11 rounded-md bg-accent-w-soft text-accent-w-dark border border-accent-w/40 type-body-strong press-scale disabled:opacity-50"
    >
      {confirm.isPending ? T.common.loading : T.invoices.confirmBuyer}
      <div className="type-caption text-ink-400 mt-0.5 font-normal">{T.invoices.confirmBuyerHint}</div>
    </button>
  );
}

/* ── Invoice detail panel body ─────────────────────────────────────────── */
function DetailBody({ invoiceId }: { invoiceId: string }) {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const { data, isLoading } = useInvoiceDetail(invoiceId);

  if (isLoading || !data) return <div className="shimmer rounded-[10px] h-64" />;
  const { invoice, buyer } = data;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="type-body-strong">{buyer?.buyerName}</span>
          {buyer && <TierChip tier={buyer.tier} />}
        </div>
        <div className="type-mono text-[12px] text-ink-400 mt-0.5">{invoice.externalRef}</div>
        <div className="mt-2">
          <Money fils={invoice.grossFils} size="amount" />
          <div className="type-caption text-ink-400 money mt-0.5">
            {invoice.dueInDays >= 0 ? T.invoices.dueIn(invoice.dueInDays) : T.invoices.overdue(-invoice.dueInDays)}{" "}
            · {new Date(invoice.dueDate).toLocaleDateString(lang === "ar" ? "ar-AE" : "en-AE", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
      </div>

      <div className="rounded-[10px] border border-border bg-card p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="type-body-strong text-ink-600 flex items-center gap-1.5">
            <StatusDot
              tone={invoice.verificationState === "verified" ? "success" : invoice.verificationState === "disputed" ? "danger" : "caution"}
              pulse={invoice.verificationState === "deduped"}
            />
            {T.invoices.stateLabels[invoice.verificationState] ?? invoice.verificationState}
          </span>
          {invoice.verifiedVia && (
            <span className="type-caption text-ink-400">
              {T.invoices.verifiedVia[invoice.verifiedVia as keyof typeof T.invoices.verifiedVia]}
            </span>
          )}
        </div>
        {invoice.verificationState === "deduped" && <ConfirmBuyerButton invoiceId={invoice.id} />}
      </div>

      <QuoteFlow key={invoice.id} invoiceId={invoice.id} />
    </div>
  );
}

/* ── The view ──────────────────────────────────────────────────────────── */
export function InvoicesView() {
  const T = t(useUi((s) => s.lang));
  const lang = useUi((s) => s.lang);
  const { selectedInvoiceId, selectInvoice, setQuoteInvoice } = useUi();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>("ready");
  const [submitOpen, setSubmitOpen] = useState(false);
  const { data, isLoading } = useInvoices(filter);
  const invoices = data?.invoices ?? [];

  const filters: { key: Filter; label: string }[] = [
    { key: "ready", label: T.invoices.filterReady },
    { key: "pending", label: T.invoices.filterPending },
    { key: "disputed", label: T.invoices.filterDisputed },
    { key: "all", label: T.invoices.filterAll },
  ];

  const openDetail = (id: string) => { selectInvoice(id); setQuoteInvoice(id); };
  const closeDetail = () => { selectInvoice(null); setQuoteInvoice(null); };

  return (
    <div className={cn("grid gap-6", selectedInvoiceId ? "lg:grid-cols-[1fr_420px]" : "grid-cols-1")}>
      {/* List column */}
      <div className="min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="type-title">{T.invoices.title}</h1>
          </div>
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            className="h-11 px-4 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1 flex items-center gap-2"
          >
            <WlIcon name="plus" size={16} />
            <span className="hidden sm:inline">{T.invoices.newInvoice}</span>
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-4 overflow-x-auto wl-scroll pb-1" role="tablist">
          {filters.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3.5 h-9 rounded-full border type-caption whitespace-nowrap transition-colors press-scale",
                filter === f.key
                  ? "border-accent-w bg-accent-w-soft text-accent-w-dark font-semibold"
                  : "border-border text-ink-600 hover:border-ink-200 dark:hover:border-ink-600"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <InvoiceListSkeleton />
        ) : invoices.length === 0 ? (
          <EmptyState title={filter === "ready" ? T.invoices.emptyReady : T.invoices.emptyPending} />
        ) : (
          <div className="space-y-3">
            {invoices.map((inv, i) => (
              <InvoiceCard key={inv.id} invoice={inv} index={i} onOpen={openDetail} />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel — desktop side panel, mobile bottom sheet.
          Mobile sheet only mounts below lg so its overlay never blocks the
          desktop panel (one blocking layer at a time — PRD 11.9). */}
      <AnimatePresence>
        {selectedInvoiceId && isDesktop && (
          <motion.aside
            key="panel"
            initial={{ opacity: 0, x: lang === "ar" ? -24 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: lang === "ar" ? -24 : 24 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
            className="hidden lg:block sticky top-6 self-start max-h-[calc(100vh-6rem)] overflow-y-auto wl-scroll"
          >
            <div className="rounded-[16px] border border-border bg-card p-5 elev-2">
              <div className="flex items-center justify-between mb-4">
                <SectionLabel>{T.common.details}</SectionLabel>
                <button type="button" onClick={closeDetail} aria-label={T.common.close} className="h-9 w-9 flex items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 press-scale">
                  <WlIcon name="close" size={16} />
                </button>
              </div>
              <DetailBody invoiceId={selectedInvoiceId} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {!isDesktop && selectedInvoiceId && (
        <Drawer key="sheet" open={!!selectedInvoiceId} onOpenChange={(v) => !v && closeDetail()}>
          <DrawerContent>
            <DrawerTitle className="sr-only">{T.common.details}</DrawerTitle>
            <div className="mx-auto w-full max-w-md px-4 pb-8 pt-2">
              <div className="flex items-center justify-between mb-4">
                <SectionLabel>{T.common.details}</SectionLabel>
                <button type="button" onClick={closeDetail} aria-label={T.common.close} className="h-9 w-9 flex items-center justify-center rounded-md text-ink-400 press-scale">
                  <WlIcon name="close" size={16} />
                </button>
              </div>
              <DetailBody invoiceId={selectedInvoiceId} />
            </div>
          </DrawerContent>
        </Drawer>
      )}

      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} />
    </div>
  );
}
