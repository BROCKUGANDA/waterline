# WATERLINE — Project Worklog

Shared worklog for all agents. Append sections; never overwrite.

---
Task ID: 0
Agent: main-orchestrator (Z.ai Code)
Task: Parse WATERLINE PRD (37 pages, uploaded PDF), plan the build, initialize project worklog.

Work Log:
- Extracted full text from /home/z/my-project/upload/WATERLINE-PRD-and-Master-Build-Specification.pdf (37 pages) to /tmp/waterline-prd.txt and read all of it.
- Product: WATERLINE liquidity layer for du Business (UAE SMEs). Phase-1 scope: dynamic discounting on buyer-approved invoices, milestone escrow, treasury autopilot, cash-flow forecasting, buyer confirmation, operator console, Arabic/RTL.
- Key non-negotiables to honour in this build:
  1. Deterministic versioned rule pack decides eligibility/limits/prices (no model decides).
  2. Append-only decision record BEFORE outcome shown (input hash, pack version, reason).
  3. Integer minor units (fils) everywhere; no float on money paths.
  4. Idempotency-Key on money-moving endpoints; duplicate payout impossible.
  5. Treasury floor absolute (hard stop).
  6. Degrade modes M0–M4 published on status endpoint, UI reads it, never guesses.
  7. Show the arithmetic: days early × rate × principal in dirhams, always expanded.
- Design system (PRD Part 11): ink/paper/accent palette, dark re-pairing (#0B1420 paper, #4D9BE8 accent), 5 gradients (liquidity.fill, surface.lift, waterline.horizon, skeleton.shimmer, escrow.lock), Inter + IBM Plex Sans Arabic + JetBrains Mono, type scale 34/28/20/17/15/13/11, 4px spacing scale, radius 6/10/16, 4 elevation levels, signature glyphs (waterline rule, vertical gauge), mobile 4-tab bottom bar (Cash/Invoices/Escrow/Activity), desktop 240px collapsible rail, motion table (90/160/240/420/640ms), funding confirmation macro-choreography (<1.1s), 4-stage processing (Accepted/Reserved/Sent/Settled), honest indeterminate states.
- Sandbox constraints: single Next.js 16 app, only `/` route user-visible, Prisma+SQLite, API routes (no server actions), shadcn/ui, Tailwind 4, port 3000.
- Adaptation decision: 12-service topology maps to modular API route groups + lib layer (ruleengine pure, ledger service, etc.) in one Next.js app. All domain rules preserved.

Stage Summary:
- PRD fully parsed; build plan set. Next: domain foundation (prisma schema + rule pack + money libs + API contract), then two parallel backend subagents (2-a invoices/decisions, 2-b money movement/engines/status), then frontend design-system shell + views by main agent, then verification + cron.

---
Task ID: 2-a
Agent: backend-agent-a (Z.ai Code)
Task: Build all Task-2-a API routes: overview (Cash-view aggregate), invoices (list/submit/detail/confirm/settle/quote — the deterministic decision flow), decisions (list/detail/replay), consents (list/grant/revoke). Contract: WATERLINE-API-CONTRACT.md §Task 2-a routes.

Work Log:
- Read PRD (Parts 1–6 in detail: rule pack, core flows, API behaviour), the binding API contract, all shared libs (api/db/money/canonical/rulepack/ruleengine/ledger/seed), prisma schema, and worklog task 0.
- Created 11 route files (only files owned by 2-a; nothing else touched):
  1. src/app/api/overview/route.ts — GET: entity (incl. licenceDaysRemaining/tenureMonths), balance.walletFils (derived ledger balance of sme.wallet.t_8821, sign-flipped: credit-normal), liquidity (availableFils = wallet + invested; totalApprovedFils = verified/unfunded/not-overdue gross; floorFils from policy; sweepableFils via evaluateSweep on a treasury snapshot built from policy + obligations within horizon; investedFils = sign-flipped instrument.* balances), invoice counts (ready/readyFils/pending/disputed/settled), buyers, consents, status (parsed killSwitches/breakers).
  2. src/app/api/invoices/route.ts — GET with filter=all|ready|pending|disputed|settled; items carry dueInDays (Math.ceil), joined buyer, latest offer, latest decision; order ready-first (dueInDays asc) → pending → rest. POST: manual body validation → billing_history consent gate (403) → canonical hash (buyerTaxId+ref+gross+issueDate YYYY-MM-DD) → dedupe (per-tenant 409 surfacing original; cross-tenant freeze both + fraud.review event) → secondary (buyer,ref,gross) per-tenant guard for seeded rows → state machine received→parsed→deduped→(verified via strongest route: einvoice/du_ap for trusted silver+ buyers w/ ≥3 confirmations, buyer_api for platinum/gold, else deduped awaiting confirm). M4 guard. P2002 race → 409.
  3. src/app/api/invoices/[id]/route.ts — GET: invoice + buyer + offers[] + latestDecision + payout + eligibilityHint. The hint is ENGINE-derived (builds the same snapshot quote would, runs evaluateAdvance, surfaces the binding rejection reasonCode/reasonText); special-cases funded/settled/disputed for honest display.
  4. src/app/api/invoices/[id]/confirm/route.ts — POST: deduped→verified via buyer_portal, bumps buyerLink.confirmedInvoiceCount, invoice.verified event, all in one $transaction.
  5. src/app/api/invoices/[id]/settle/route.ts — POST: money-moving (Idempotency-Key REQUIRED, ≥8 chars → else 400). Guards: M4 → 503; killSwitches global/dynamicDiscounting → 423 (M3 allowed: settlement unwinds, doesn't fund). Only fundingState=accepted (already-settled → idempotent 200 alreadySettled). Posts collection txn (BANK_COLLECTIONS dr gross / RECEIVABLE_CONTROL cr gross, sourceEventId invoice.settled:{id}, event invoice.settled) + reserve release (RESERVE_HELD dr / SME_WALLET cr reserve = gross−net−fee, sourceEventId reserve.release:{id}, event reserve.released). Invoice→settled; payout→settled+settledAt+reconciledAt.
  6. src/app/api/invoices/[id]/quote/route.ts — GET: THE decision flow. Snapshot (asOfDate today, bookExposureFils = principalFils of accepted offers on non-settled invoices, treasury null) → evaluateAdvance → append-only Decision (inputHash=hashSnapshot, featureSnapshot=canonicalJson) written BEFORE any outcome → approved/capped: expire prior offered offers, create Offer (offered, expiresAt now+120_000ms, principalFils=limit, rateMilliBps=price), invoice.fundingState=quoted, decision.recorded event — all in one $transaction. Rejected: HTTP 200, offer null, rateCurve.mbpsPerDay null. accepted → 409 already_funded; settled → 409 already_settled. Guards: M4 → 503, global/dynamicDiscounting kill → 423.
  7. src/app/api/decisions/route.ts — GET: latest 25 by default (?limit=1..100), ordered evaluatedAt desc, with subjectRef + resolved subjectLabel (invoice ref — buyer name / sweep instrument).
  8. src/app/api/decisions/[id]/route.ts — GET: full record incl. parsed featureSnapshot JSON + checks re-derived by re-evaluating the stored snapshot.
  9. src/app/api/decisions/[id]/replay/route.ts — POST: re-evaluates stored snapshot with the same pack, compares byte-identical outcome fields (advance: outcome/limitFils/advanceRatePermyriad/priceMilliBpsPerDay/reasonCode/bindingRule; treasury_sweep: outcome/reasonCode/bindingRule), returns { matchesOriginal, original, replay, rulepackVersion, versionDrift }, writes decision.replayed event. Original row never modified.
  10. src/app/api/consents/route.ts — GET list (+ purpose registry) / POST grant { purpose } (validated against registry; one row per purpose; re-grant clears revokedAt; idempotent when already active; consent.granted event).
  11. src/app/api/consents/[id]/route.ts — DELETE: revoke (revokedAt + consent.revoked event; idempotent alreadyRevoked).
- All handlers: `await ensureSeed()` first, try/catch → errors.internal(), envelope via ok()/problem() only, ISO dates, integer fils only, `export const dynamic = "force-dynamic"`, Next 16 Promise params.
- Validated with a throwaway smoke script (direct handler invocation; deleted afterwards — no test files kept): ~90 assertions covering derivation correctness (wallet/sweepable recomputed from DB), filters/order, hints, quote rejections at 200, approval arithmetic (inv_steel_a 4,365,000 @ 38 mbps, ratePermyriad 9000, TTL ~120s, re-quote expiry), unrated cap (720,000 @ 64 mbps incl. slow-pay adj), POST dedupe 409s + buyer_api auto-verify, confirm + counter, consent 403/revoke/regrant, settle guards + full money flow (reserve 100,000 released to wallet exactly; idempotent re-settle; ledger balanced), replay matchesOriginal on fresh + seeded decision. DB restored to pristine seed state after testing. `bun run lint` clean; `tsc --noEmit` clean for all 2-a files.

FRONTEND NOTES (from 2-a):
- POST /api/invoices/[id]/settle (and 2-b money routes) REQUIRE header Idempotency-Key ≥8 chars → else 400.
- POST /api/invoices returns 201; quote rejections are HTTP 200 with offer:null (neutral card); rateCurve.mbpsPerDay is the flat rate anchor (fee = days × mbps × principal ÷ 100,000, fils).
- AppEvent types 2-a emits: invoice.submitted, invoice.verified, invoice.settled, reserve.released, decision.recorded, decision.replayed, consent.granted, consent.revoked, fraud.review.

ISSUES FOUND IN SHARED CODE (not modified, needs owner attention):
- src/lib/ledger.ts: postTransaction's alreadyPosted lookup queries the UNSUFFIXED sourceEventId while rows store `${sourceEventId}:${accountCode}` — the idempotency check never matches; only the DB unique constraint prevents double-posting (a true repeat throws P2002 instead of no-op). Routes guard around it via state checks.
- src/lib/api.ts: pre-existing TS error — problem() declares NextResponse<ApiErr> but the JSON body lacks ApiErr.status (it is passed to NextResponse.json options instead). Runtime correct; typing cosmetic.
- Seed invoice hashes use a different formula than the contract hash (buyerId+ref+gross+issuedAgo vs buyerTaxId+ref+gross+issueDate) — 2-a compensates with a secondary (buyer,ref,gross) per-tenant document guard.
- src/app/layout.tsx (frontend WIP) imports not-yet-created @/components/waterline/providers → dev server currently 500s on ALL routes (API included) until that file exists. 2-a routes are verified via direct invocation and will serve normally once the layout compiles.

Stage Summary:
- Task 2-a complete: 11 routes implemented, lint/TS clean, smoke-verified end-to-end (quote→offer arithmetic, dedupe, consent gates, settle ledger flow, replay determinism), demo DB left in pristine seed state. Cross-agent record in agent-ctx/2-a-backend-invoices-decisions.md. Remaining for others: 2-b routes (already appearing in parallel), frontend shell (must create src/components/waterline/providers to unblock dev server), DTO types in src/lib/types.ts matching the documented shapes.

---
Task ID: 2-b1
Agent: backend-agent-b1 (Z.ai Code)
Task: Finalise Task 2-b1 money-movement routes: POST /api/offers/[id]/accept (offer acceptance + funding txn + payout creation), GET /api/payouts/[id] (4-stage honest pipeline), GET+POST /api/escrow (contract award), POST /api/escrow/[id]/milestones/[mid] (milestone state machine). Contract: WATERLINE-API-CONTRACT.md §Task 2-b routes; PRD 4.3-4.4, 11.13, Part 5.

Work Log:
- Read worklog (tasks 0 + 2-a), the API contract, PRD pages 10/12-13 (flows 4.3-4.4, API Part 5) and every shared lib (api/db/money/canonical/rulepack/ruleengine/ledger/seed) + prisma schema before touching code.
- Found the 4 target files already present on disk from the parallel/interrupted 2-b agent (never logged, no agent-ctx record). Took ownership and audited them line-by-line against the 2-b1 binding spec, then brought them into exact compliance with 8 targeted fixes (no rewrites, no files outside the 4 touched):
  1. offers/accept: P2002 race-recovery now re-fetches the FRESH offer and self-heals the funding txn with the winner's stored fee/net/daysEarly (was: current request's values); payout.initiated event now also self-heals on the replay and race paths (payoutId passed); serialized offer now includes acceptedIdempotencyKey; added error logging.
  2. payouts/[id]: added error logging.
  3. escrow POST: conditionType is now REQUIRED (was silently defaulted to buyer_approval); sum-mismatch 400 detail now carries the spec phrase "Milestone amounts must sum to the contract total"; status guard moved AFTER payload validation (malformed bodies 400 regardless of switch state, guard still precedes every write); added error logging.
  4. escrow milestones: body evidence field renamed from `note` to `evidence` per spec; approve now backfills metAt if null; already-released approve/resolve replays return 200 `{ alreadyReleased: true }` (plus replayed:true); contract completion now propagated into the replay response; added error logging; `export const dynamic = "force-dynamic"` added to all 4 files (escrow GET takes no Request — prevents prerender/caching surprises; consistent with 2-a convention).
- Verification: direct handler invocation of all 4 routes (2-a's precedent) against an ISOLATED /tmp copy of the demo DB (real db/custom.db untouched — mtime proof; no test files kept: throwaway script + scratch DB deleted after). 59/59 checks passed: accept happy-path arithmetic (fee=feeFor(14,38,4365000)=23221 fils, net, settlementDate=due−14d, payout key/shape, funding txn 4 entries balanced, exact ledger account deltas, wallet untouched by accept), replay semantics (no dup payout/txn/events), re-validation (expired offer 409, pack-drift 409, price/limit drift 409, daysEarly bounds 400), guards (M3/dynamicDiscounting/global→423, M4→503, offer untouched by blocked accepts), payout pipeline (stages at 2.5s/7s/16s with exact persisted timestamps, providerRef dpay_+last6, reconciledAt, 3 transition events with stage payloads, terminal settled, seeded payout intact, 404), escrow GET (ordered milestones, per-contract + global totals), escrow POST (6 validation 400s incl. contract-total phrase, active contract + ADCB-ESC-##### custodianRef, award txn + event, idempotent replay), milestones (mark_delivered→in_review+metAt+evidence, approve→released EFG-AP portal + custodian→wallet txn + not-completed-until-all, alreadyReleased replay without dup txn, dispute freeze + event, resolve requires evidence → released + contract completed + escrow.completed, invalid action 400, cross-contract 404), final ledger integrity balanced + custodian/wallet nets exact.
- `bun run lint` exit 0; `bunx tsc --noEmit` clean for all 4 files (only pre-existing errors remain in examples/, skills/ and the frontend-WIP layout.tsx). Dev server still 500s on ALL routes because layout.tsx imports the not-yet-created @/components/waterline/providers (frontend agent's file) — same blocker 2-a documented; routes verified by direct invocation.
- Cross-agent record written to agent-ctx/2-b1-backend-accept-payouts-escrow.md (contract shapes for the frontend: Idempotency-Key headers, payout polling shape, escrow action semantics, events emitted).

Stage Summary:
- Task 2-b1 complete: accept → payout → escrow money paths implemented to the PRD's idempotency/re-validation/honesty standards, lint/TS clean, 59/59 smoke checks green on an isolated DB, demo DB left pristine. Frontend unblocker still outstanding: src/components/waterline/providers (layout.tsx import) breaks every route in dev until created. Treasury/status/activity/audit routes (2-b remainder) were not part of 2-b1's file set and were not touched.

---
Task ID: 2-b2
Agent: backend-agent-b2 (Z.ai Code)
Task: Build the 2-b2 API routes: treasury autopilot (GET /api/treasury, PUT policy, POST sweep/recall/obligations), status (GET/POST, failsafe modes M0–M4), activity feed, audit. Contract: WATERLINE-API-CONTRACT.md §Task 2-b routes (treasury/status/activity/audit portion); PRD 4.5, Part 8, Part 5.

Work Log:
- Found a crashed predecessor run had already drafted these 8 files (never logged in worklog, no agent-ctx record) with deviations from the 2-b2 binding spec. Rewrote all 8 files to spec; left 2-a's and 2-b1's files (invoices/decisions/consents/overview, escrow/offers/payouts) untouched; deleted the crashed run's orphaned .smoke debris (broken import, unrunnable).
- 1. src/app/api/treasury/route.ts — GET: policy, obligations (next 30d, active, dueDate asc), projection { walletFils (=-accountBalance sme.wallet.t_8821, asOf), floorFils, obligationsInHorizonFils, safetyMarginFils (applyPermyriad), sweepableFils (evaluateSweep on the treasury FeatureSnapshot: asOfDate today, seeded entity, invoice/buyer null, portfolio.bookExposureFils 0 — byte-identical to /api/overview's snapshot so the two endpoints can never disagree), instruments (rulePack.treasury.instruments), sweeps (desc createdAt; accruedYieldFils = per-day mulDivFloor × floor(days) live for state 'swept', else STORED yieldFils), investedFils (Σ amountFils state 'swept'), earnedYieldFils (Σ stored yieldFils state 'recalled') }. Extra read-only fields: sweepOutcome/sweepReasonCode/sweepReasonText, instrumentName, dueInDays, confidencePermyriad.
- 2. src/app/api/treasury/policy/route.ts — PUT: validates floorFils int ≥0, horizonDays 3–90, safetyMarginPermyriad 0–5000, autoPilotEnabled bool (else 400, ≥1 field required); UPSERTS on tenantId (create path tested by deleting the row); policy update + AppEvent 'treasury.policy_updated' (payload = changed fields only) in one $transaction; M4 → 503 (policy is the SME's own guardrail — deliberately NOT kill-switched so the floor can be raised mid-incident). Returns { policy }.
- 3. src/app/api/treasury/sweep/route.ts — POST, Idempotency-Key ≥8 (400). Guard: killSwitches.treasury/.global → 423, M4 → 503 (M3 allowed — sweeps are the SME's own money, not funding). instrumentRef must exist in rulePack.treasury.instruments (400). Builds the SAME snapshot as route 1 (wallet derived NOW), evaluateSweep → append-only Decision written BEFORE any outcome: subjectRef/subjectType 'treasury', decisionType 'treasury_sweep', inputHash=hashSnapshot, featureSnapshot=canonicalJson, rulepackVersion, outcome/bindingRule/reasonCode/reasonText, actor 'system' (+limitFils stores sweepableFils). Rejected → HTTP 200 { decision, sweep: null } (neutral card). Approved → amount = amountFils ?? sweepableFils; > sweepable → 400; < rulePack minSweepFils → 400; Sweep { direction 'out', state 'swept', floorAtDecisionFils from snapshot } + postTransaction [SME_WALLET debit / INSTRUMENT_HOLDING(ref) credit] sourceEventId `treasury.sweep:{sweepId}` eventType 'sweep.executed' (transactional outbox). Idempotency: decision id + sweep id derived from sha256(idemKey) — a retry replays the original outcome (rejected → sweep null; approved → self-heals a crash between decision and posting) and can never double-move money; P2002 races treated as already-posted.
- 4. src/app/api/treasury/recall/route.ts — POST, Idempotency-Key (400). 404 unknown sweep; 400 non-'swept' state (already-recalled → 200 replayed:true). yield = mulDivFloor(amountFils, yieldMbsdPermyriad, 10_000) × floor(days since createdAt); postTransaction [INSTRUMENT_HOLDING debit amount+yield / SME_WALLET credit amount+yield] sourceEventId `treasury.recall:{sweepId}` eventType 'sweep.recalled'; sweep { state 'recalled', recalledAt, yieldFils }; AppEvent via outbox. Crash recovery reads the actually-posted wallet credit so the stored yield matches the ledger to the fil. Recalls continue in M3 (PRD Part 8); treasury/global kill switch → 423; M4 → 503.
- 5. src/app/api/treasury/obligations/route.ts — POST: label non-empty ≤120, amountFils positive int, dueDate parseable AND future (forward-looking calendar), kind ∈ {payroll,rent,vat,supplier,du_bill,custom} default custom, cadence ∈ {once,weekly,monthly} default once; created with confidencePermyriad 10,000 (manual = certain); AppEvent 'treasury.obligation_added'; row + event in one $transaction; M4 → 503.
- 6. src/app/api/status/route.ts — GET NEVER fails: try → ensureSeed → upsert-read singleton (recreates with declared defaults if missing) → ok({ mode, message, killSwitches (8 keys, defaults merged), breakers (6 keys), updatedAt, modeCatalog }) ; catch → ok(hardcoded M0). modeCatalog uses the EXACT 2-b2 spec strings for M0–M4 (label/description/smeSees). POST: Idempotency-Key (400), confirm:true (400), reason ≥3 chars (400); validates mode M0–M4, killSwitch.name ∈ 8 names + on bool, breaker.name ∈ 6 names + state ∈ closed/half/open; upserts state, writes OperatorAction { actor 'operator@du', action mode_transition|kill_switch|breaker_sim (+ 'status_message' for message-only — schema's action column is an open string list), targetRef, reason, detailJson } + AppEvent 'status.changed' in one $transaction; returns the same view as GET. Deliberately NOT mode-guarded so recovery FROM M4 is possible.
- 7. src/app/api/activity/route.ts — GET ?limit=50 (clamp 1–200): AppEvents desc occurredAt, tenant-scoped (DEMO_TENANT OR null), server-rendered copy for every type used by seed + all agents: onboarding.completed, invoice.submitted/verified/disputed/settled, decision.recorded/replayed, offer.accepted, payout.initiated/state_changed/settled/failed, escrow.awarded/condition_met/released/disputed/completed, sweep.executed/recalled, treasury.policy_updated/obligation_added, status.changed, consent.granted/revoked, reserve.released, fraud.review, ledger.opened (+ title-case default). Payloads parsed defensively; money via formatAed; invoice ids → externalRef, milestone ids → descriptions, contracts enriched in 3 batch queries (never per event); exact-duplicate dedup (type+subject+ms+payload). Returns EXACTLY { events: [{ id, type, title, detail, subjectRef, occurredAt }] }.
- 8. src/app/api/audit/route.ts — GET: integrity (verifyLedgerIntegrity pass-through: balanced/txns/breaks), entries (last 25, desc postedAt, serialized accountCode/direction/amountFils/txnId/memo/postedAt/sourceEventId), counts { decisions, payoutsSettled, offersAccepted }, roundingBalanceFils (derived balance of rounding.residual — visible, never absorbed).
- All handlers: `await ensureSeed()` first, try/catch → errors.internal() (status GET excepted by design), ok()/problem() envelopes, `export const dynamic = "force-dynamic"`, integer fils only, ISO dates, TS strict with zero `any`.
- Verified with a throwaway smoke script (direct handler invocation; deleted afterwards — no test files kept): ~150 assertions covering exact seed-derived figures (wallet 8,560,000; obligations-in-horizon 4,080,000; margin 1,284,000; sweepable 696,000; seed sweep accrued yield 5,400×6 days), every 400/404/409-free validation branch, policy upsert create+update, floor-breach neutral rejection (200 E_FLOOR) + replay, amount>headroom 400, below-pack-minimum 400, partial + full sweeps with ledger equality (instrument holdings, wallet deltas to the fil), recall with 3-day aged yield (8,100 fils stored vs 27,000 live — proves stored-yield branch), earnedYieldFils, idempotent replays posting ZERO new ledger rows, kill-switch 423s, M3-allows-treasury, M4-blocks-all-writes, status catalog byte-exact, operator-action audit trail, activity copy for all 13 live event types + money formatting, audit integrity/counts, and full pristine restoration afterwards (8 txns/18 entries/1 sweep/1 decision, M0, seed policy). `bun run lint` clean; `tsc --noEmit` clean for all 8 files. DB left in pristine seed state.

FRONTEND NOTES (from 2-b2) — exact response shapes:
- GET /api/treasury → { policy{floorFils,horizonDays,safetyMarginPermyriad,autoPilotEnabled,updatedAt}, obligations[{id,label,kind,dueDate,dueInDays,amountFils,cadence,confidencePermyriad}], projection{walletFils,asOf,floorFils,obligationsInHorizonFils,safetyMarginFils,sweepableFils,sweepOutcome,sweepReasonCode,sweepReasonText}, instruments[{ref,name,yieldMbsdPermyriad,maturityDays,liquidityDays}], sweeps[{id,direction,amountFils,instrumentRef,instrumentName,yieldMbsdPermyriad,floorAtDecisionFils,state,yieldFils,accruedYieldFils,createdAt,recalledAt}], investedFils, earnedYieldFils }.
- PUT /api/treasury/policy → { policy{…} } (no idempotency key required).
- POST /api/treasury/sweep (Idempotency-Key REQUIRED) → { decision{id,…,outcome,sweepableFils,reasonCode,reasonText,bindingRule,checks[],rulepackVersion,inputHash,evaluatedAt}, sweep{…}|null, replayed } — rejections are HTTP 200 with sweep null (neutral card); amountFils optional (defaults to full sweepable).
- POST /api/treasury/recall (Idempotency-Key REQUIRED) → { sweep{…}, replayed }.
- POST /api/treasury/obligations → { obligation{…} } (no key required).
- GET/POST /api/status → { mode, message, killSwitches{8}, breakers{6}, updatedAt, modeCatalog[5] }; POST needs Idempotency-Key + confirm:true + reason.
- GET /api/activity?limit=50 → { events[{id,type,title,detail,subjectRef,occurredAt}] } — titles/details are server-rendered, money pre-formatted.
- GET /api/audit → { integrity{balanced,txns,breaks}, entries[≤25], counts{decisions,payoutsSettled,offersAccepted}, roundingBalanceFils }.

ISSUES FOUND (not modified, for the owning agents):
- src/app/layout.tsx still imports the not-yet-created @/components/waterline/providers → the dev server 500s on EVERY route (API included) until the frontend agent creates it. 2-b2 routes are verified via direct handler invocation and will serve normally once the layout compiles.
- The crashed predecessor 2-b run had left .smoke/ debris (smoke-2b.ts with a malformed import path `escrow/[id]/milestones/id]`) — deleted as orphaned crash artifacts; the DB it left was already pristine.
- src/lib/ledger.ts postTransaction idempotency check NOW correctly queries by `sourceEventId: { startsWith: base + ':' }` — 2-a's earlier worklog note about the unsuffixed lookup is stale; the shared lib is fixed and my routes rely on it.
- 2-a's /api/decisions resolves subject labels for subjectType 'sweep' by sweep id; my treasury decisions use subjectRef 'treasury' (per 2-b2 spec) so their list shows the raw ref 'treasury' for treasury_sweep rows — cosmetic only, detail view + replay unaffected (replay compares outcome/reasonCode/bindingRule).

DEVIATIONS from the 2-b2 letter (all additive or documented):
- Sweep POST enforces amountFils ≥ rulePack.treasury.minSweepFils in addition to ≤ sweepableFils (rule-pack T04 intent); adds deterministic ids from the Idempotency-Key and a `replayed` flag (PRD 6.2 replay semantics); stores sweepableFils in Decision.limitFils.
- Status POST message-only changes write OperatorAction action 'status_message' (4th label beyond the spec's 3 — the schema's action column is an open string; document for the ops console).
- Treasury/policy/obligations return rows wrapped ({ policy } / { obligation } / { sweep }); projection and serialized rows carry extra read-only fields listed above.

Stage Summary:
- Task 2-b2 complete: 8 routes implemented to the binding contract, lint + typecheck clean, ~150-assertion smoke verified end-to-end (money arithmetic to the fil, idempotency, guards, audit, catalog strings), demo DB restored to pristine seed state. Cross-agent record in agent-ctx/2-b2-treasury-status-activity-audit.md. Remaining for others: 2-b1 worklog record (its escrow/offers/payouts routes exist on disk from the crashed unified run but are unlogged — 2-b1 should review/re-log them), frontend shell (providers file blocks the whole dev server), DTO types in src/lib/types.ts.

---
Task ID: 3 (main agent)
Agent: main-orchestrator (Z.ai Code)
Task: Frontend — design system, app shell, widgets, all five views; browser verification; fixes.

Work Log:
- Design tokens in globals.css: full WATERLINE palette (ink/accent/paper + semantic), dark-mode RE-PAIRING (#0B1420 paper, #4D9BE8 accent), 5 permitted gradients (liquidity.fill, surface.lift, waterline.horizon, skeleton.shimmer, escrow.lock), type scale (34/28/20/17/15/13/11 + mono), tnum/lnum tabular figures, 4 elevation levels, motion tokens (90/160/240/420/640ms + easing table), waterline-rule signature glyph, shimmer RTL mirror, wl-slider range styling, reduced-motion handling, custom scrollbars.
- Fonts: Inter + IBM Plex Sans Arabic + JetBrains Mono via next/font; layout.tsx rewritten; providers.tsx (ThemeProvider + QueryClient + sonner Toaster + RTL dir bootstrap).
- Libs: types.ts (all DTOs), i18n.ts (full EN/AR dictionaries — designed mirror, not machine translation), stores/ui.ts (zustand persist), client.ts (envelope + stable idempotency-key registry), hooks/waterline.ts (23 query/mutation hooks), use-media-query.ts.
- Components (components/waterline/): icons.tsx (custom 24px/1.75px stroke icon set incl. waterline + gauge signature glyphs), money.tsx (digit-roll animation), primitives (StatusDot always paired with label, CopyRef glyph→tick 1.2s morph, SkeletonCard, TierChip), liquidity-gauge.tsx (vertical gauge + waterline floor mark, 420ms spring, never on mount), runway-strip.tsx (90-day strip + tappable obligation markers with confidence), fee-breakdown.tsx (always expanded + local recompute DateSlider), decision-receipt.tsx, outcome-card.tsx (rejections as neutral cards), stage-tracker.tsx (4 named stages, honest elapsed/eta, no-duplicate reassurance), invoice-card.tsx, status-banner.tsx (driven by /api/status only).
- Views: cash-view.tsx (collapsing balance header 180→56px interpolated to scroll, gauge, runway, treasury autopilot: floor slider + sweep/recall + obligations + instrument picker), invoices-view.tsx (filters, invoice cards, desktop 420px side panel + mobile vaul sheet, SubmitDialog, quote auto-flow, accept confirmation modal 480px, PayoutDialog with 4-stage pipeline, settle simulation), escrow-view.tsx (escrow.lock gradient header, milestone tracker w/ approve/dispute/resolve + evidence), activity-view.tsx (grouped timeline, sticky section labels), ops-view.tsx (mode catalog M0–M4 with two-person arm+confirm, kill switches, breaker toggles, decision records + replay, ledger audit, consents PDPL controls).
- page.tsx: view switching w/ 160ms directional crossfade, skip-link.
- app-shell.tsx: desktop 240px collapsible rail + mobile 4-tab bottom bar with labels, footer sticky via min-h-screen flex + mt-auto.

Bugs found via agent-browser and fixed:
- vaul Drawer overlay blocked desktop clicks (mounted at all breakpoints) → mount mobile sheet only below lg (useIsDesktop).
- StageTracker crashed on raw payout from accept (no stages array) → derive stages from record fields.
- DecisionReceipt crashed when decision.inputHash missing in quote response → added inputHash to quote response + defensive render.
- QuoteFlow skipped auto-quote when a prior offered offer existed → always re-quote on panel open (route expires stale offers).
- DialogTitle a11y warnings on mobile sheet → sr-only DrawerTitle.
- Money digit-roll setState-in-effect lint error → adjust-state-during-render pattern.

Verification (agent-browser, all passed):
- All 5 views render; no console errors; ledger balanced (15 txns, 0 breaks).
- Golden path in UI: open invoice → auto-quote (AED 21,375 @ 4.2bps, expiry countdown) → date slider recomputes locally → accept modal → 4-stage payout (Accepted→Reserved→Sent→Settled w/ real timestamps + providerRef) → settlement simulation → invoice Settled.
- E_MIN_SIZE rejection renders as neutral outcome card with receipt; E06 unrated-buyer 60% cap verified in UI (AED 9,000 on AED 15,000 invoice) with plain-language reason.
- Buyer-portal confirm simulation; new invoice submission via dialog (lands in Pending for unrated buyer).
- Escrow: milestone approve → released, 62% progress, evidence + actor shown; ledger posts custodian release.
- Treasury: floor slider, sweep executed (AED 33,820 → MMF), recall buttons, sweep history with yield.
- Ops: M2 mode applied with reason (two-person confirm) → status banner propagated across views ("Prices are locked — accept now, payouts queue"); reverted to M0.
- Arabic RTL full mirror verified; dark mode re-pairing verified; mobile 375px bottom tabs + sheet verified.
- 8 screenshots saved to /home/z/my-project/download/.

Stage Summary:
- WATERLINE is feature-complete for Phase-1 demo scope: dynamic discounting golden path, escrow, treasury autopilot, operator console, bilingual RTL, dark mode, degrade modes driving the UI, deterministic rule pack with replay, balanced double-entry ledger.
- Dev server runs on :3000 (nohup+disown pattern — plain & dies with the shell call).
- Remaining polish candidates: localize modeCatalog copy server-side; M2 payout queueing semantics; portfolio ceiling E07 demo scenario; onboarding/consent first-run flow; AI advisory copilot via z-ai-web-dev-sdk.

---
Task ID: 4 (main agent)
Agent: main-orchestrator (Z.ai Code)
Task: Round 4 — QA re-assessment via agent-browser, bug fixes (fee-precision display, Arabic localization gaps, consents labels, hydration mismatch, TS debt), and new features (AI advisory copilot, API discovery endpoint) with VLM-driven styling polish.

Work Log:
- Read worklog (tasks 0/2-a/2-b1/2-b2/3); dev server verified up on :3000 (nohup pattern), lint clean, all API routes 200, ledger balanced (15 txns).
- QA sweep with agent-browser (named session, snapshot/read/errors/console): all 5 views render, mobile 375px bottom bar verified fixed+visible, no console errors. Golden-path re-check: ESS-INV-2199 E_MIN_SIZE neutral card; NTZ-0101 E06 60% cap (AED 9,000 advance).
- BUGS FOUND & FIXED:
  1. Fee-precision display (PRD invariant violation): Money component defaulted whole=true — fee card showed "AED 81" instead of exact "AED 80.64" (8,064 fils), net "AED 8,919" instead of "AED 8,919.36". Flipped whole={false} on every fils-precision figure: fee-breakdown (fee/net/settle-on/principal), invoices-view (advance, net proceeds, payout amount), stage-tracker, invoice-card gross, escrow amounts (milestone/total/released/pending/aggregate), cash-view (sweep amounts, yield figures, ready total), runway obligation amounts. Verified in UI: 9,000.00 − 80.64 = 8,919.36 exact.
  2. Arabic modeCatalog leak: ops console + status-banner smeSees rendered English in AR. Added client-side modeCopy map (EN mirrors server strings byte-identically, AR designed mirror) to i18n; ops-view + status-banner use it with server-string fallback.
  3. Arabic activity feed leak: server-rendered EN copy shown in AR. Activity API now returns additive `params` {ref, milestone, description, payload} per event (additive, contract-compatible); new src/lib/activity-ar.ts renders the AR mirror client-side (formatAedAr, Eastern Arabic numerals, defensive fallbacks to server copy); activity-view EventRow uses it when lang=ar. Also mapped outcome enums (approved/rejected/capped) to Arabic.
  4. Obligation labels English in AR runway: added localized kind chip (الرواتب/الإيجار/…) to marker popover + aria-labels; kind stays metadata, label stays user data.
  5. Arabic treasury terminology: "اكتساب" (acquisition — wrong) → "توظيف" family (المتاح للتوظيف اليوم/وظّف الآن/سجل التوظيف/وُظّف).
  6. Arabic balance header: formatAed → formatAedAr (د.إ with Arabic numerals), plus sweep/recall toasts.
  7. Consents rows rendered EMPTY titles at runtime (dict values are strings, code read .title/.hint off them — masked by an invalid `as` cast): proper string lookup with `_hint` keys; verified in UI ("Bank data (Open Finance) / Read-only balances for forecasting" etc.).
  8. Hydration mismatch on dark-mode load (server renders moon icon, dark client renders sun): mounted-guard on theme buttons in app-shell (isDark = mounted && theme === "dark", timeout-effect pattern to satisfy react-hooks/set-state-in-effect). Verified: fresh session + dark reload = 0 page errors.
  9. Pre-existing TS debt cleared to zero project-wide: PayoutStage import, colorize "treasury" union (added + color mapping), escrow redundant state comparison, InvoiceDto.latestOffer.netProceedsFils, mobile Drawer null-guard, ops consents cast. `bunx tsc --noEmit` now clean (only examples/skills excluded); `bun run lint` clean.
- NEW FEATURES:
  1. AI ADVISOR COPILOT (PRD-polish item): POST /api/advisor (z-ai-web-dev-sdk, backend only) — builds live tenant context from the same derived balances as /api/overview (wallet, invested, floor, sweepable via evaluateSweep, invoice pipeline, top buyers, escrow totals derived from milestone states, recent decisions, mode) with money pre-formatted server-side so the model never computes on fils; system prompt encodes WATERLINE voice + "explains, never decides" + cite-only-context + reply-in-user-language. Guards: question 1–500 chars (400), history sanitized ≤6 turns, M4 → 503 honest pause; every Q&A append-only audited as advisor.qa AppEvent (renders in activity feed EN+AR). Frontend: advisor.tsx — FAB (grad-liquidity, compass glyph, above mobile tab bar / corner on desktop, side-aware RTL), Sheet chat panel with suggestion chips (4, localized), thread bubbles, composer (Enter to send, 500 counter), clear conversation, M4 honest absence; wired into app-shell; "advisor" icon added to icon set. Verified end-to-end in EN + AR (correct 60% cap explanation; correct tier rates 2.6–4.8 bps/day; correct fee worked example).
  2. API DISCOVERY/HEALTH: GET /api (replaced scaffold "Hello, world!") — 28-route map (method/purpose/money-moving), envelope+money conventions, live health probe (database/seeded/ledger balanced). Never throws: failures reported in body.
  3. Runway header label "cash today" (نقد اليوم) clarifies the wallet figure.
- STYLING POLISH (VLM-driven review of screenshots):
  - ink-400 light-mode #767F8C (~4.06:1) → #66707D (≥4.7:1) — muted copy now WCAG-AA.
  - Rail utilities separated from navigation by border-t divider.
  - Invoice detail verification row: StatusDot paired with strong state label (was scattered muted caption + dot on the wrong side).
  - Sidebar tagline wraps instead of truncating.
- Ops console localized mode catalog verified in AR (طبيعي/حذر/تسعير فقط/التمويل موقوف/قراءة فقط with full descriptions + smeSees).
- DB left in demo state: M0, no kill switches, ledger balanced 15 txns, wallet AED 83,380, 2 ready invoices. M4-guard test events (status.changed M4→M0 round trip + advisor.qa rows) remain in the activity feed as honest audit records.
- Verified via agent-browser after all changes: fee card exact, advisor EN+AR flow, AR mode catalog/activity/runway/balance, consents titles, dark-mode hydration (fresh session 0 errors), mobile FAB placement; screenshots saved to download/qa-round5-*.png.
- Dev server restarted once this round (stale Prisma connection caused SQLITE_READONLY on writes after long uptime — restart re-opened the connection; if it recurs, restart dev server).

Stage Summary:
- Round 4 complete: 9 bugs fixed (1 PRD-invariant violation, 4 localization gaps, 1 runtime-empty-label bug, 1 hydration mismatch, TS debt), 2 new features (AI advisor copilot end-to-end bilingual; API discovery/health), AA contrast + VLM-driven polish. Lint + typecheck fully clean; all flows browser-verified; demo DB healthy.
- Remaining candidates for next round: onboarding/consent first-run flow (the last unclaimed PRD-polish item); M2 payout queueing semantics; E07 portfolio-ceiling demo scenario; streaming advisor responses; advisor suggested-question personalization from live data; night-mode screenshots pass with VLM.
