// WATERLINE — POST /api/ops/canary (Round 10, PRD 3.3 promotion lifecycle).
// The CANARY phase operator controls: promote the candidate pack to the
// deterministic 5% traffic bucket, or withdraw it. Two-person discipline —
// a reason of at least 3 characters is mandatory, every action lands in the
// append-only OperatorAction store, and an AppEvent narrates it for the
// activity feed. NOT blocked by any degrade mode: withdrawing a canary must
// itself be possible in any state (the same recovery principle as /api/status
// POST).
//
// Promotion is honest about preconditions:
//   - only from M0 (M1's cautious delta is its own experiment — conflating
//     the two would be dishonest);
//   - the candidate pack must exist in this build's registry.
// Any automatic guardrail escalation withdraws the canary by itself
// (src/lib/canary.ts autoRollbackCanary) — this route is the human side.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { CANDIDATE_PACK_VERSION, PACK_REGISTRY } from "@/lib/rulepacks";
import { canaryState, setCanary, CANARY_TRAFFIC_PERMYRIAD, type CanaryState } from "@/lib/canary";

export const dynamic = "force-dynamic";

interface CanaryBody {
  action?: unknown;
  reason?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const body = await readJson<CanaryBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    const action = body.action;
    if (action !== "promote" && action !== "withdraw") {
      return errors.invalidRequest("action must be 'promote' or 'withdraw'.");
    }
    const reason = body.reason;
    if (typeof reason !== "string" || reason.trim().length < 3) {
      return errors.invalidRequest("reason is mandatory — canary transitions are two-person actions, audited with who, when and why.");
    }

    const st = await db.statusState.findUnique({ where: { id: "singleton" } });
    const current = await canaryState();

    // ── Idempotent replay: re-sending the same action is a no-op read. ──────
    if (action === "promote" && current !== null) {
      return ok({ canary: current, alreadyPromoted: true });
    }
    if (action === "withdraw" && current === null) {
      return ok({ canary: null, alreadyWithdrawn: true });
    }

    if (action === "promote") {
      // Preconditions, surfaced honestly.
      if (st && st.mode !== "M0") {
        return errors.invalidRequest(
          `The canary can only be promoted while the platform is in M0 (currently ${st.mode}) — M1's cautious delta is its own experiment; conflating the two would be dishonest.`,
        );
      }
      if (PACK_REGISTRY[CANDIDATE_PACK_VERSION] === undefined) {
        return errors.invalidRequest(
          `The candidate pack ${CANDIDATE_PACK_VERSION} is not present in this build's registry — nothing to canary.`,
        );
      }
      const next: CanaryState = {
        since: new Date().toISOString(),
        trafficPermyriad: CANARY_TRAFFIC_PERMYRIAD,
        promotedBy: "operator@du",
        reason: reason.trim(),
      };
      await setCanary(next, "operator@du", "canary_promote", reason.trim(), { idempotencyKey: idemKey });
      await db.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "canary.promoted",
          subjectRef: "rulepack:candidate",
          payloadJson: JSON.stringify({
            trafficPermyriad: CANARY_TRAFFIC_PERMYRIAD,
            candidateVersion: CANDIDATE_PACK_VERSION,
            reason: reason.trim(),
          }),
        },
      });
      return ok({
        canary: next,
        candidateVersion: CANDIDATE_PACK_VERSION,
        trafficPercent: CANARY_TRAFFIC_PERMYRIAD / 100,
      });
    }

    // withdraw
    await setCanary(null, "operator@du", "canary_withdraw", reason.trim(), {
      idempotencyKey: idemKey,
      previous: current,
    });
    await db.appEvent.create({
      data: {
        tenantId: DEMO_TENANT,
        type: "canary.withdrawn",
        subjectRef: "rulepack:candidate",
        payloadJson: JSON.stringify({
          reason: reason.trim(),
          previousSince: current?.since ?? null,
          note: "The base pack serves all traffic again. Offers quoted under the candidate re-quote at the base price — never applied silently.",
        }),
      },
    });
    return ok({ canary: null, candidateVersion: CANDIDATE_PACK_VERSION });
  } catch (e) {
    console.error("[api/ops/canary]", e);
    return errors.internal();
  }
}
