// WATERLINE — /api/status  (Task 2-b2; PRD Part 8 Failsafe modes).
// GET: the published degrade-mode state — mode, message, kill switches,
// breakers and the full M0–M4 catalog. This endpoint drives the status
// banner and MUST NEVER FAIL: any error degrades to a hardcoded M0 read,
// because the UI reads the mode from here and never guesses.
// POST: the operator console — mode transitions, kill switches and breaker
// simulation, each written to the append-only OperatorAction store with the
// operator's identity and a mandatory reason (PRD 8.2). Deliberately NOT
// blocked by any mode: recovery from M4 must itself be possible.

import { db } from "@/lib/db";
import { DEMO_TENANT, errors, ok, readJson, requireIdempotencyKey } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import type { StatusState } from "@prisma/client";

export const dynamic = "force-dynamic";

const MODES = ["M0", "M1", "M2", "M3", "M4"] as const;
const KILL_SWITCH_NAMES = ["global", "dynamicDiscounting", "escrow", "treasury", "tenant", "buyer", "sector", "rail"] as const;
const BREAKER_NAMES = ["dupay", "aani", "openfinance", "einvoice", "custodian", "notification"] as const;
const BREAKER_STATES = ["closed", "half", "open"] as const;

const DEFAULT_SWITCHES: Record<string, boolean> = {
  global: false,
  dynamicDiscounting: false,
  escrow: false,
  treasury: false,
  tenant: false,
  buyer: false,
  sector: false,
  rail: false,
};

const DEFAULT_BREAKERS: Record<string, string> = {
  dupay: "closed",
  aani: "closed",
  openfinance: "closed",
  einvoice: "closed",
  custodian: "closed",
  notification: "closed",
};

/** The five declared modes, published for the UI (PRD Part 8). What the SME
 *  sees is derived from this declared state — never guessed. */
const MODE_CATALOG = [
  {
    mode: "M0",
    label: "Normal",
    description: "All engines active, straight-through processing.",
    smeSees: "Full product.",
  },
  {
    mode: "M1",
    label: "Cautious",
    description: "Loss/dispute/forecast guardrail crossed — advance rates reduced via rule-pack delta.",
    smeSees: "Normal product with slightly lower limits and an honest note explaining the temporary tightening.",
  },
  {
    mode: "M2",
    label: "Quote-only",
    description: "Payout rail unavailable or reconciliation break unresolved — quotes honoured at quoted price, acceptances queue.",
    smeSees: "We can price this now and pay as soon as the rail is back — with a live status and the price locked.",
  },
  {
    mode: "M3",
    label: "Funding suspended",
    description: "Integrity breach, portfolio ceiling breach or regulatory instruction — no new funding.",
    smeSees: "Clear suspension notice with expected review time. Existing money keeps working.",
  },
  {
    mode: "M4",
    label: "Read-only",
    description: "Primary datastore degraded or zone failover in progress.",
    smeSees: 'Balances and history with a visible "as of" timestamp. No silent staleness.',
  },
] as const;

interface StatusView {
  mode: string;
  message: string | null;
  killSwitches: Record<string, boolean>;
  breakers: Record<string, string>;
  updatedAt: string;
  modeCatalog: {
    mode: string;
    label: string;
    description: string;
    smeSees: string;
  }[];
}

function safeRecord(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function viewFrom(st: StatusState): StatusView {
  return {
    mode: st.mode,
    message: st.message,
    killSwitches: { ...DEFAULT_SWITCHES, ...(safeRecord(st.killSwitchesJson) as Record<string, boolean>) },
    breakers: { ...DEFAULT_BREAKERS, ...(safeRecord(st.breakersJson) as Record<string, string>) },
    updatedAt: st.updatedAt.toISOString(),
    modeCatalog: MODE_CATALOG.map((m) => ({ ...m })),
  };
}

function hardcodedM0(): StatusView {
  return {
    mode: "M0",
    message: null,
    killSwitches: { ...DEFAULT_SWITCHES },
    breakers: { ...DEFAULT_BREAKERS },
    updatedAt: new Date().toISOString(),
    modeCatalog: MODE_CATALOG.map((m) => ({ ...m })),
  };
}

/** Upsert-read: guarantee the singleton exists (create with declared
 *  defaults on first read) and return it. Never throws past the caller's
 *  try/catch — the status banner must always have an answer. */
async function upsertReadStatus(): Promise<StatusState | null> {
  const existing = await db.statusState.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  try {
    return await db.statusState.create({ data: { id: "singleton" } });
  } catch {
    // A racing writer created it first — read what landed.
    return db.statusState.findUnique({ where: { id: "singleton" } });
  }
}

export async function GET(): Promise<Response> {
  // This endpoint must NEVER fail — it drives the status banner. On any
  // error we fall back to the declared hardcoded M0 state.
  try {
    await ensureSeed();
    const st = await upsertReadStatus();
    if (st) return ok(viewFrom(st));
    return ok(hardcodedM0());
  } catch {
    return ok(hardcodedM0());
  }
}

interface StatusPostBody {
  mode?: unknown;
  killSwitch?: { name?: unknown; on?: unknown };
  breaker?: { name?: unknown; state?: unknown };
  message?: unknown;
  reason?: unknown;
  confirm?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSeed();

    const idemKey = requireIdempotencyKey(req);
    if (!idemKey) {
      return errors.invalidRequest("Idempotency-Key header of at least 8 characters is required on this request.");
    }

    const body = await readJson<StatusPostBody>(req);
    if (!body) return errors.invalidRequest("Request body must be JSON.");

    if (body.confirm !== true) {
      return errors.invalidRequest("Operator transitions require confirm:true — a switch that has not been exercised is treated as broken.");
    }
    const reason = body.reason;
    if (typeof reason !== "string" || reason.trim().length < 3) {
      return errors.invalidRequest("reason is mandatory — every switch and transition is audited with who, when and why.");
    }

    // ── Validate the requested transition ──
    let mode: string | null = null;
    if (body.mode !== undefined) {
      if (typeof body.mode !== "string" || !MODES.includes(body.mode as (typeof MODES)[number])) {
        return errors.invalidRequest(`mode must be one of ${MODES.join(", ")}.`);
      }
      mode = body.mode;
    }

    let killSwitch: { name: string; on: boolean } | null = null;
    if (body.killSwitch !== undefined) {
      const ks = body.killSwitch;
      if (!ks || typeof ks !== "object") return errors.invalidRequest("killSwitch must be { name, on }.");
      if (typeof ks.name !== "string" || !KILL_SWITCH_NAMES.includes(ks.name as (typeof KILL_SWITCH_NAMES)[number])) {
        return errors.invalidRequest(`killSwitch.name must be one of ${KILL_SWITCH_NAMES.join(", ")}.`);
      }
      if (typeof ks.on !== "boolean") return errors.invalidRequest("killSwitch.on must be a boolean.");
      killSwitch = { name: ks.name, on: ks.on };
    }

    let breaker: { name: string; state: string } | null = null;
    if (body.breaker !== undefined) {
      const br = body.breaker;
      if (!br || typeof br !== "object") return errors.invalidRequest("breaker must be { name, state }.");
      if (typeof br.name !== "string" || !BREAKER_NAMES.includes(br.name as (typeof BREAKER_NAMES)[number])) {
        return errors.invalidRequest(`breaker.name must be one of ${BREAKER_NAMES.join(", ")}.`);
      }
      if (typeof br.state !== "string" || !BREAKER_STATES.includes(br.state as (typeof BREAKER_STATES)[number])) {
        return errors.invalidRequest(`breaker.state must be one of ${BREAKER_STATES.join(", ")}.`);
      }
      breaker = { name: br.name, state: br.state };
    }

    let message: string | null | undefined = undefined;
    if (body.message !== undefined) {
      if (body.message !== null && (typeof body.message !== "string" || body.message.length > 300)) {
        return errors.invalidRequest("message must be a string of at most 300 characters, or null to clear the banner.");
      }
      message = body.message as string | null;
    }

    if (mode === null && !killSwitch && !breaker && message === undefined) {
      return errors.invalidRequest("Provide at least one of mode, killSwitch, breaker or message.");
    }

    const current = await upsertReadStatus();
    if (!current) return errors.internal();

    const switches = { ...DEFAULT_SWITCHES, ...safeRecord(current.killSwitchesJson) } as Record<string, boolean>;
    const breakers = { ...DEFAULT_BREAKERS, ...safeRecord(current.breakersJson) } as Record<string, string>;
    const before = { mode: current.mode, message: current.message, killSwitches: { ...switches }, breakers: { ...breakers } };

    if (killSwitch) switches[killSwitch.name] = killSwitch.on;
    if (breaker) breakers[breaker.name] = breaker.state;

    const action =
      mode !== null ? "mode_transition"
      : killSwitch ? "kill_switch"
      : breaker ? "breaker_sim"
      : "status_message";

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.statusState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          mode: mode ?? "M0",
          message: message === undefined ? null : message,
          killSwitchesJson: JSON.stringify(switches),
          breakersJson: JSON.stringify(breakers),
        },
        update: {
          mode: mode ?? current.mode,
          message: message === undefined ? current.message : message,
          killSwitchesJson: JSON.stringify(switches),
          breakersJson: JSON.stringify(breakers),
        },
      });
      // Append-only operator audit — the same store every other decision
      // lands in, with identity and reason attached (PRD 8.2).
      await tx.operatorAction.create({
        data: {
          actor: "operator@du",
          action,
          targetRef: mode ?? killSwitch?.name ?? breaker?.name ?? "banner",
          reason: reason.trim(),
          detailJson: JSON.stringify({
            mode,
            killSwitch,
            breaker,
            message: message === undefined ? current.message : message,
            before,
            idempotencyKey: idemKey,
          }),
        },
      });
      await tx.appEvent.create({
        data: {
          tenantId: DEMO_TENANT,
          type: "status.changed",
          subjectRef: "status",
          payloadJson: JSON.stringify({
            mode: next.mode,
            message: next.message,
            killSwitches: switches,
            breakers,
            action,
            reason: reason.trim(),
            actor: "operator@du",
          }),
        },
      });
      return next;
    });

    return ok(viewFrom(updated));
  } catch {
    return errors.internal();
  }
}
