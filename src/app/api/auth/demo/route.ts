// WATERLINE — POST /api/auth/demo — judge demo sign-in.
// Validates the requested persona and returns the tenant identity the
// session will display (legal name, emirate, KYB state, du Pay suffix, the
// live mode and rule-pack version). READ-ONLY by design: authentication is
// not a money event and never writes to the ledger or the audit trail —
// the append-only decision record stays reserved for product decisions.
// Real du Business SSO would live here in production; the demo path is
// the honest stand-in (same response shape, no credentials checked).

import { db } from "@/lib/db";
import { ok, errors, DEMO_TENANT } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import { packForMode } from "@/lib/rulepacks";

export const dynamic = "force-dynamic";

const PERSONAS = new Set(["sme", "operator"]);

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { persona?: string };
    const persona = body.persona ?? "sme";
    if (!PERSONAS.has(persona)) {
      return errors.invalidRequest("Unknown persona — expected 'sme' or 'operator'");
    }

    await ensureSeed();
    const t = DEMO_TENANT;
    const entity = await db.entity.findFirst({ where: { tenantId: t, role: "sme" } });
    if (entity === null) return errors.notFound("SME entity");

    const status = await db.statusState.findUnique({ where: { id: "singleton" } });
    const mode = status?.mode ?? "M0";
    const pack = packForMode(mode);

    return ok({
      persona,
      // The identity the session displays — the seeded demo tenant.
      entity: {
        id: entity.id,
        legalName: entity.legalName,
        tradeLicence: entity.tradeLicence,
        emirate: entity.emirate,
        kybState: entity.kybState,
        duPaySuffix: entity.duPaySuffix,
        licenceDaysRemaining: Math.ceil(
          (entity.licenceExpiry.getTime() - Date.now()) / 86_400_000,
        ),
      },
      // The platform state at sign-in — the same published facts the app
      // shell reads from /api/status (never guessed, PRD Part 8).
      platform: {
        mode,
        rulePackVersion: pack.version,
      },
      // Honest framing: this is a demo, no real money moves.
      demo: true,
    });
  } catch (e) {
    console.error("[api/auth/demo]", e);
    return errors.internal();
  }
}
