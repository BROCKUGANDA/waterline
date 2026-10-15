# 2-b2 — Treasury autopilot, status/failsafe, activity, audit

Task ID: 2-b2 · Agent: backend-agent-b2 (Z.ai Code) · Status: COMPLETE

## Scope (8 files, all owned exclusively by 2-b2)

1. `src/app/api/treasury/route.ts` — GET treasury autopilot view
2. `src/app/api/treasury/policy/route.ts` — PUT policy
3. `src/app/api/treasury/sweep/route.ts` — POST sweep (money-moving)
4. `src/app/api/treasury/recall/route.ts` — POST recall (money-moving)
5. `src/app/api/treasury/obligations/route.ts` — POST manual obligation
6. `src/app/api/status/route.ts` — GET (never fails) + POST operator console
7. `src/app/api/activity/route.ts` — GET activity feed (server-rendered copy)
8. `src/app/api/audit/route.ts` — GET ops audit tab

## Context for later agents

- A predecessor 2-b run crashed mid-task (files drafted, never logged, orphaned `.smoke/` debris with a malformed import). I rewrote all 8 files to the 2-b2 binding spec and deleted the debris. **2-b1's routes (escrow / offers accept / payouts) exist on disk from that same crashed run and have NO worklog record — whoever picks up 2-b1 must review them against the contract and log them.**
- The treasury FeatureSnapshot used by both `/api/treasury` (projection) and `/api/treasury/sweep` (decision) is byte-identical to `/api/overview`'s: `portfolio.bookExposureFils = 0`, obligations = active rows with `dueDate <= now+horizonDays`, wallet = negated ledger balance of `sme.wallet.t_8821`. The three endpoints can never disagree on `sweepableFils`.
- Treasury Decision rows use `subjectRef: "treasury"`, `subjectType: "treasury"` (per 2-b2 spec) — NOT the sweep id. `limitFils` carries sweepableFils. Decision id + sweep id are deterministic from `sha256("treasury.sweep:" + Idempotency-Key)`, giving full replay semantics (rejected → sweep null; approved → self-healing posting) with zero double-money risk (ledger `(tenant, source_event_id)` unique + P2002-as-posted).
- Kill-switch semantics implemented: treasury/global → 423 for sweep AND recall; M4 → 503 for every write (policy, obligations, sweep, recall); M3 blocks nothing in treasury (sweeps/recalls are the SME's own money — PRD Part 8); status POST is never mode-blocked (recovery from M4 must be possible); policy PUT is not kill-switched (raising the floor mid-incident must stay possible).
- `/api/status` GET can never fail — any error degrades to a hardcoded M0 view. modeCatalog strings are byte-exact to the 2-b2 spec. GET upsert-reads the singleton (recreates with declared defaults).
- `/api/activity` returns exactly `{ events: [{ id, type, title, detail, subjectRef, occurredAt }] }` — all copy server-rendered, money via `formatAed`, every event type emitted by seed.ts + every agent's routes mapped, payloads parsed defensively.
- `/api/audit` returns `{ integrity: {balanced, txns, breaks}, entries[≤25 desc postedAt], counts: {decisions, payoutsSettled, offersAccepted}, roundingBalanceFils }`.

## Exact response shapes (for src/lib/types.ts)

See the FRONTEND NOTES section appended under Task 2-b2 in `/home/z/my-project/worklog.md` — full field lists for all 8 routes.

## Verification

- `bun run lint` clean; `bunx tsc --noEmit` clean for all 8 files (remaining project errors are the frontend agent's missing `@/components/waterline/providers` and pre-existing examples/skills).
- Throwaway smoke script (direct handler invocation, deleted after): ~150 assertions — exact seed figures (wallet 8,560,000 fils; obligations-in-horizon 4,080,000; safety margin 1,284,000; sweepable 696,000; seed sweep live yield 32,400), every validation branch (400/404), policy upsert create+update with changed-fields-only event payload, floor-breach neutral rejection (200, E_FLOOR) + idempotent replay, partial/full sweeps with exact ledger deltas, recall with aged stored yield (8,100 stored vs 27,000 live — proves the stored branch), earnedYieldFils, replays posting zero new ledger rows, 423/503 guards, M3-allows-treasury, status catalog byte-exact, operator-action trail, activity copy + money formatting, audit integrity/counts, and full pristine restoration (8 txns / 18 entries / 1 sweep / 1 decision / M0 / seed policy).
- DB left in pristine seed state — verified after cleanup.

## Known cross-agent state

- Dev server 500s on ALL routes (API included) until the frontend agent creates `src/components/waterline/providers` (root layout import). Not caused by backend code; routes verified by direct invocation.
- 2-a's `/api/decisions` list shows raw subjectRef `treasury` for treasury_sweep rows (their label resolver expects sweep ids) — cosmetic only.
