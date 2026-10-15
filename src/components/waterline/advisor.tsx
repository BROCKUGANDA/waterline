"use client";

// WATERLINE — the advisor copilot. A floating entry point that opens a chat
// panel: the backend builds the tenant's live, derived facts (money
// pre-formatted server-side) and the LLM explains them. The advisor never
// decides — pricing, limits and eligibility belong to the deterministic rule
// pack; the subtitle and disclaimer say so in plain language (PRD 2.1).
// In M4 the entry point disappears — no advisory on possibly-stale data,
// and the UI never guesses system state (PRD 11.8).

import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAdvisor, type AdvisorTurn } from "@/hooks/waterline";
import { useStatus, useOverview, useTreasury } from "@/hooks/waterline";
import { useUi } from "@/stores/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WlIcon } from "./icons";
import { StatusDot } from "./primitives";

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[10px] px-3.5 py-2.5 whitespace-pre-wrap break-words",
          isUser
            ? "bg-accent-w-soft text-foreground rounded-ee-sm border border-accent-w/25"
            : "bg-card border border-border text-foreground rounded-es-sm"
        )}
      >
        <span className="type-body">{text}</span>
      </div>
    </div>
  );
}

export function AdvisorPanel() {
  const lang = useUi((s) => s.lang);
  const T = t(lang);
  const { data: status } = useStatus();
  const advisor = useAdvisor();

  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<AdvisorTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const m4 = status?.mode === "M4";

  // Live suggestions from the same cached queries the views use — the chips
  // meet the SME where they actually are (pending invoices, idle surplus,
  // earned yield, thin buyer history) instead of a static list.
  const { data: overview } = useOverview();
  const { data: treasury } = useTreasury();
  const suggestions = (() => {
    const live: string[] = [];
    if ((overview?.invoices.pendingCount ?? 0) > 0) live.push(T.advisor.suggestionsLive.pending);
    if ((treasury?.projection.sweepableFils ?? 0) > 0) live.push(T.advisor.suggestionsLive.sweepable);
    if ((treasury?.investedFils ?? 0) > 0) live.push(T.advisor.suggestionsLive.yield);
    if ((overview?.buyers ?? []).some((b) => b.tier === "unrated")) live.push(T.advisor.suggestionsLive.unrated);
    return live.length > 0 ? live.slice(0, 4) : (T.advisor.suggestions as readonly string[]);
  })();

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, advisor.isPending, open]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // The advisor does not exist in read-only mode — honest absence.
  if (m4 && !open) return null;

  const ask = (raw: string) => {
    const q = raw.trim();
    if (!q || advisor.isPending) return;
    setError(null);
    const history = thread.slice(-6);
    setThread((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    advisor.mutate(
      { question: q, lang, history },
      {
        onSuccess: (d) => {
          setThread((prev) => [...prev, { role: "assistant", content: d.answer }]);
        },
        onError: () => {
          setThread((prev) => prev.slice(0, -1)); // roll back the optimistic user bubble
          setError(T.advisor.error);
        },
      }
    );
  };

  const side = lang === "ar" ? "left" : "right";

  return (
    <>
      {/* Floating entry point — above the mobile tab bar, corner on desktop */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={T.advisor.title}
        className={cn(
          "fixed z-40 h-14 w-14 rounded-full grad-liquidity text-white elev-2 press-scale",
          "flex items-center justify-center",
          "bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] md:bottom-6",
          lang === "ar" ? "left-4 md:left-6" : "right-4 md:right-6",
          "transition-transform hover:scale-105 focus-visible:scale-105"
        )}
      >
        <WlIcon name="advisor" size={24} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={side}
          className={cn(
            "w-full sm:max-w-[440px] p-0 flex flex-col h-dvh sm:h-dvh sm:border-s",
            "bg-background"
          )}
        >
          <SheetHeader className="p-4 pb-3 border-b border-border shrink-0">
            <SheetTitle className="type-title flex items-center gap-2.5">
              <span className="h-9 w-9 rounded-full grad-liquidity text-white flex items-center justify-center shrink-0">
                <WlIcon name="advisor" size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate">{T.advisor.title}</span>
                <span className="block type-caption text-ink-400 font-normal truncate">{T.advisor.subtitle}</span>
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">{T.advisor.subtitle}</SheetDescription>
            <div className="flex items-center gap-2 mt-1">
              <StatusDot tone={status?.mode === "M0" ? "success" : "caution"} pulse={status?.mode !== "M0"} />
              <span className="type-caption text-ink-400">
                {status ? `${status.mode}` : "…"} · {T.advisor.disclaimer}
              </span>
            </div>
          </SheetHeader>

          {/* conversation thread */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto wl-scroll p-4 space-y-3">
            {thread.length === 0 && (
              <div className="space-y-2.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="w-full text-start rounded-[10px] border border-border bg-card px-3.5 py-3 type-body text-ink-600 hover:border-accent-w/40 hover:text-foreground press-scale transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {thread.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.content} />
            ))}
            {advisor.isPending && (
              <Bubble role="assistant" text={T.advisor.thinking} />
            )}
            {error && (
              <div className="type-caption text-danger-w text-center py-1">{error}</div>
            )}
          </div>

          {/* composer */}
          <div className="p-3 border-t border-border shrink-0 bg-background">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(question);
                  }
                }}
                placeholder={T.advisor.placeholder}
                aria-label={T.advisor.placeholder}
                rows={2}
                className="flex-1 resize-none min-h-[44px] max-h-32 type-body"
                dir="auto"
              />
              <button
                type="button"
                onClick={() => ask(question)}
                disabled={advisor.isPending || !question.trim()}
                className="h-11 px-4 rounded-md grad-liquidity text-white type-body-strong press-scale elev-1 disabled:opacity-40 shrink-0"
              >
                {T.advisor.send}
              </button>
            </div>
            {thread.length > 0 && (
              <div className="flex justify-between items-center mt-1.5">
                <span className="type-label text-ink-400">{question.length}/500</span>
                <button
                  type="button"
                  onClick={() => { setThread([]); setError(null); }}
                  className="type-label text-ink-400 hover:text-danger-w press-scale"
                >
                  {T.advisor.clear}
                </button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
