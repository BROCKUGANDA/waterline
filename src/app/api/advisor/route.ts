// WATERLINE — POST /api/advisor  (AI advisory copilot — non-streaming).
// An explainer, never a decider: pricing, limits and eligibility are decided
// by the deterministic versioned rule pack (PRD 2.1) — the advisor answers
// questions ABOUT that machinery using the tenant's live, derived facts.
// The context builder and system prompt live in src/lib/advisor.ts and are
// shared byte-identically with /api/advisor/stream (SSE) so both endpoints
// answer from the same facts with the same voice.

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { errors, ok, problem } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { buildContext, buildSystemPrompt, parseAdvisorBody, auditAdvisorQa } from "@/lib/advisor";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const raw = await req.json().catch(() => null);
    const parsed = parseAdvisorBody(raw);
    if ("error" in parsed) {
      return problem(400, "invalid_request", parsed.error);
    }
    const { question, lang, history } = parsed;

    // M4 disables advisory on possibly-stale data — honest degradation (PRD 8).
    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    if (status?.mode === "M4") {
      return problem(503, "degraded", "The advisor is paused in read-only mode — balances may be stale.");
    }

    const context = await buildContext();
    const system = buildSystemPrompt(lang, context, status?.mode ?? null);

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        ...history,
        { role: "user", content: question },
      ],
      thinking: { type: "disabled" },
    });
    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      return problem(502, "advisor_empty", "The advisor returned an empty answer — try rephrasing.");
    }

    await auditAdvisorQa(question, lang, answer.length);

    return ok({ answer, lang, mode: status?.mode ?? "M0" });
  } catch (e) {
    console.error("advisor error", e);
    return errors.internal();
  }
}
