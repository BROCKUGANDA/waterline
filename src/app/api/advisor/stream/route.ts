// WATERLINE — POST /api/advisor/stream  (AI advisory copilot — SSE).
// Identical semantics to POST /api/advisor (same validation, same derived
// context, same system voice, same M4 pause, same append-only audit) but the
// answer streams token-by-token as Server-Sent Events so the SME watches the
// explanation arrive instead of staring at a spinner:
//
//   data: {"delta":"..."}   — incremental answer text
//   data: {"done":true,"answer":"...","mode":"M0"}
//   data: {"error":"..."}   — honest failure mid-stream
//
// Invariants preserved: money pre-formatted server-side (the model never sees
// fils); the audit event is written AFTER the stream completes with the true
// final length; the rule pack decides everything — this only explains faster.

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { problem } from "@/lib/api";
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
    const stream = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        ...history,
        { role: "user", content: question },
      ],
      thinking: { type: "disabled" },
      stream: true,
    });

    const encoder = new TextEncoder();
    const mode = status?.mode ?? "M0";

    // The SDK yields the RAW SSE wire bytes as Uint8Array chunks. Chunk
    // boundaries do NOT align with `data:` line boundaries — a line (or a
    // multi-byte UTF-8 character) can be split across two chunks. So: ONE
    // stateful TextDecoder ({stream:true} keeps split characters intact) plus
    // a line buffer that carries the partial tail across chunks. Re-emit each
    // content delta as our own SSE event — nothing is ever dropped silently.
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };
        const decoder = new TextDecoder();
        let lineBuffer = "";
        let answer = "";

        const processLine = (line: string) => {
          if (!line.startsWith("data:")) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          try {
            const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
            const delta = j?.choices?.[0]?.delta?.content;
            if (delta) {
              answer += delta;
              send({ delta });
            }
          } catch {
            // A malformed line never breaks the stream.
          }
        };

        try {
          for await (const raw of stream as AsyncIterable<Uint8Array>) {
            lineBuffer += decoder.decode(raw, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? ""; // the partial tail waits for more bytes
            for (const line of lines) processLine(line);
          }
          // Flush: the decoder's held bytes + the final buffered line.
          lineBuffer += decoder.decode();
          if (lineBuffer) processLine(lineBuffer);

          const trimmed = answer.trim();
          if (!trimmed) {
            send({ error: "advisor_empty", detail: "The advisor returned an empty answer — try rephrasing." });
          } else {
            // Append-only audit AFTER completion, with the true final length.
            await auditAdvisorQa(question, lang, trimmed.length);
            send({ done: true, answer: trimmed, mode });
          }
        } catch (e) {
          console.error("advisor stream error", e);
          send({ error: "advisor_failed", detail: "The advisor couldn’t finish the answer — try again." });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error("advisor stream route error", e);
    return problem(500, "internal", "The advisor could not start.");
  }
}
