# WATERLINE — API Contract (binding for all agents)

All routes live under `src/app/api/`. Response envelope (src/lib/api.ts):
- Success: `{ ok: true, data: T, trace_id: string }`
- Error: `{ ok: false, error: { code, detail, trace_id, retryable } }` with proper HTTP status.

Shared helpers (already implemented — use, do not rewrite):
- `src/lib/api.ts` — ok/problem/errors, requireIdempotencyKey, readJson, DEMO_TENANT
- `src/lib/db.ts` — prisma client `db`
- `src/lib/money.ts` — fils formatting/parse, feeFils, applyPermyriad, mulDivFloor
- `src/lib/canonical.ts` — canonicalJson, sha256, hashSnapshot, shortId, payoutIdempotencyKey
- `src/lib/rulepack.ts` — rulePack (version 2026.10.3), RULEPACK_VERSION
- `src/lib/ruleengine.ts` — FeatureSnapshot, evaluateAdvance, evaluateSweep, feeFor
- `src/lib/ledger.ts` — postTransaction, accountBalance, LEDGER_ACCOUNTS, verifyLedgerIntegrity
- `src/lib/seed.ts` — ensureSeed() (idempotent; call at top of every route handler)

Rules (PRD-binding):
1. Every money-moving POST requires an `Idempotency-Key` header (≥8 chars) → else 400.
2. Decision records are written append-only BEFORE the outcome is returned.
3. Integer fils everywhere. No floats on money paths.
4. Status/degrade modes: routes that move money MUST check `db.statusState` mode — M3 (funding suspended) blocks new funding; M4 (read-only) blocks ALL writes; kill switch `dynamicDiscounting`/`escrow`/`treasury` blocks that engine. Return `errors.killSwitchActive` / `errors.degraded` with a clear detail.
5. Consents: quote requires `bank_data` or `billing_history` consent present & not revoked... (soft check for demo: warn only). Skip hard consent enforcement except on invoice submission (billing_history) — return 403 consent_required if missing.

## Task 2-a routes (agent A owns these files)

### GET /api/overview
Calls ensureSeed. Returns the whole Cash-view model:
```json
{ "entity": {...entity fields, licenceDaysRemaining, tenureMonths},
  "balance": { "walletFils": number, "asOf": ISO },
  "liquidity": { "availableFils": number, "totalApprovedFils": number, "floorFils": number, "sweepableFils": number, "investedFils": number },
  "invoices": { "readyCount": n, "readyFils": n, "pendingCount": n, "disputedCount": n, "settledCount": n },
  "buyers": [ {id, buyerName, tier, avgDaysToPay, confirmedInvoiceCount} ],
  "consents": [ {id, purpose, grantedAt, revokedAt} ],
  "status": { "mode": "M0"|"M1"..., "killSwitches": {...}, "breakers": {...}, "message": string|null } }
```
- walletFils = derived ledger balance of account `sme.wallet.t_8821` (credit-negative → wallet = -balance since wallet is a credit-normal account; compute as `-(sum)`).
- availableFils = walletFils + sum of (pending offers? no) → available liquidity = wallet + investedFils. totalApprovedFils = sum gross of verified, not-yet-funded, not-overdue invoices. sweepableFils from evaluateSweep (build treasury snapshot from policy + obligations within horizon). investedFils = sum of active instrument holdings (ledger balance of `instrument.%` accounts, sign-flipped).

### GET /api/invoices?filter=all|ready|pending|disputed|settled
Returns `{ invoices: [...] }` with joined buyer info + computed dueInDays + latest offer state + latest decision outcome. Order: ready first (dueInDays asc), then pending, then rest.

### POST /api/invoices
Body: `{ buyerLinkId, externalRef, grossFils, dueDate (ISO), issueDate? }`.
Flow: create in `received` → normalise → hash (canonical over buyerTaxId+ref+gross+issueDate) → dedupe: check `invoiceHash` (per-tenant → 409 duplicate_invoice; cross-tenant → freeze both + route to review event `fraud.review`) → if buyer tier is trusted (silver+ with confirmedInvoiceCount ≥ 3) auto-verify via the strongest available route: einvoice if source... For demo: simulate verification priority — if buyer has buyer_api capability (platinum/gold) → verified via buyer_api immediately; else stays `deduped` awaiting buyer confirmation. Write AppEvent. Return created invoice (+ `duplicate: true` info when 409).
Also requires `billing_history` consent → else 403 consent_required.

### GET /api/invoices/[id]
Invoice + buyer + offers[] + latest decision + payout (if any) + eligibility hint (reasonCode if currently not quotable, e.g. E_UNVERIFIED with plain reason).

### POST /api/invoices/[id]/confirm  (buyer confirmation portal simulation)
Transitions deduped → verified (via buyer_portal). Bumps buyerLink.confirmedInvoiceCount. AppEvent. Returns invoice.

### POST /api/invoices/[id]/settle  (demo: buyer pays at due date)
Only for fundingState=accepted. Posts collection txn (BANK_COLLECTIONS debit gross / RECEIVABLE_CONTROL credit gross) + reserve release (RESERVE_HELD debit / SME_WALLET credit reserve), invoice.fundingState=settled, payout stays settled, AppEvent `invoice.settled`. Returns invoice.

### GET /api/invoices/[id]/quote
THE decision flow. Build FeatureSnapshot (asOfDate = today ISO date; entity/invoice/buyer/portfolio exposure = sum of outstanding funded advances i.e. accepted offers' principalFils + nothing else; treasury null). Evaluate with rulePack. Write append-only Decision row (inputHash=hashSnapshot, featureSnapshot=canonicalJson). If approved/capped: create or refresh an Offer (state offered, expiresAt now+120s, principal=limit, rateMilliBps). Invoice.fundingState → quoted. AppEvent decision.recorded. Return:
```json
{ "decision": { id, outcome, limitFils, advanceRatePermyriad, priceMilliBpsPerDay, reasonCode, reasonText, bindingRule, checks[], rulepackVersion, evaluatedAt },
  "offer": { id, grossFils, principalFils, rateMilliBps, expiresAt, state } | null,
  "rateCurve": { "mbpsPerDay": number } }
```
Rejections: HTTP 200 with decision.outcome="rejected", offer=null, reasonText (the UI renders a neutral outcome card, not an error).
If fundingState=accepted → 409 with detail "already funded".

### GET /api/decisions?limit=20  and GET /api/decisions/[id]
Decision list/record. Detail includes parsed featureSnapshot.

### POST /api/decisions/[id]/replay
Re-evaluate the stored featureSnapshot against the pack version recorded on the decision (same version). Compare outcome byte-identical: return `{ matchesOriginal: boolean, original: {...}, replay: {...} }` + write AppEvent `decision.replayed`. (Replay regression — PRD 9.3.)

### POST /api/consents  { purpose }  / DELETE /api/consents/[id]
Grant/revoke. Revocation: set revokedAt, write AppEvent `consent.revoked` — dependent features are expected to disable in the UI.

## Task 2-b routes (agent B owns these files)

### POST /api/offers/[id]/accept   (Idempotency-Key REQUIRED)
Body: `{ daysEarly: number }` (settlement = dueDate - daysEarly; 1 ≤ daysEarly ≤ dueInDays).
Re-validation (PRD 4.3-03): offer.state must be offered; not expired (else 409 offer_expired); pack version on the decision must equal current (else 409); recompute price from the SAME snapshot → if rate changed → 409 offer_expired with detail "price changed — re-quote".
Then atomically: compute fee = feeFor(daysEarly, rateMilliBps, principalFils), net = principal - fee; set offer accepted fields; invoice.fundingState=accepted; create Payout (idempotencyKey = payoutIdempotencyKey(offerId) — unique; if payout exists for this offer return it with `Idempotent-Replay: true` semantics: just return the existing payout 200 with replayed:true); post funding txn via postTransaction (RECEIVABLE_CONTROL debit gross; FUNDING_POOL credit net; FEE_INCOME credit fee; RESERVE_HELD credit gross-net-fee) with sourceEventId `offer.accept:{offerId}`; AppEvent offer.accepted + payout.initiated.
Status guard: mode M3/M4 or killSwitches.dynamicDiscounting/global → 423/503.
Return `{ offer, payout }`.

### GET /api/payouts/[id]
4-stage honest pipeline (PRD 11.13): accepted → reserved after 2.5s → sent after 7s → settled after 16s (use payout.etaSeconds for the last). Compute current stage from elapsed since acceptedAt; persist new timestamps as they are crossed; providerRef = `dpay_{rand}` when sent. Returns payout + `{ stage, stageIndex (0-3), stages: [{key,label,at:ISO|null}], elapsedMs, etaSeconds }`. State `settled` also sets reconciledAt. Writes AppEvent payout.state_changed on each transition.

### GET /api/escrow
Contracts with milestones[] ordered by sequence; totals: releasedFils, pendingFils.

### POST /api/escrow  (Idempotency-Key required)
Body: `{ buyerName, description, totalFils, milestones: [{ description, amountFils, conditionType, reviewWindowDays }] }`.
Validate milestone amounts sum == totalFils (else 400). Creates contract state "active", posts award txn (BUYER_CONTRIBUTION debit total / ESCROW_CUSTODIAN credit total), AppEvent escrow.awarded.

### POST /api/escrow/[id]/milestones/[mid]  (Idempotency-Key required)
Body: `{ action: "mark_delivered" | "approve" | "dispute" | "resolve" }`
- mark_delivered: pending → in_review (metAt = now) [condition document_review] or pending→met for buyer_approval? Keep simple: mark_delivered sets metAt & in_review.
- approve: (buyer or operator) in_review|pending → met → released: posts release txn (ESCROW_CUSTODIAN debit amount / SME_WALLET credit amount), state released, approvedBy "EFG-AP portal", AppEvent escrow.released.
- dispute: → disputed (freeze only this milestone; others continue).
- resolve: disputed → released (with evidence) or back to in_review.
When all milestones released → contract state completed, completedAt. Status guard: killSwitch escrow.

### GET /api/treasury
Policy + obligations (next 30d, ordered) + projection: walletFils, floorFils, obligationsInHorizonFils, safetyMarginFils, sweepableFils (via evaluateSweep snapshot), instruments (from rulePack.treasury.instruments), sweeps (history with state), investedFils, earnedYieldFils.

### PUT /api/treasury/policy
Body: any of `{ floorFils, horizonDays, safetyMarginPermyriad, autoPilotEnabled }` (validated: floorFils ≥ 0, horizon 3-90, margin 0-5000). AppEvent treasury.policy_updated.

### POST /api/treasury/sweep  (Idempotency-Key required)
Body: `{ instrumentRef, amountFils? }` (amount defaults to full sweepable).
Flow: build treasury FeatureSnapshot → evaluateSweep (THE floor hard stop). Write append-only Decision (decisionType treasury_sweep, outcome from sweep). If approved: create Sweep, post txn (SME_WALLET debit amount / INSTRUMENT_HOLDING(instrumentRef) credit amount), AppEvent sweep.executed. If rejected: return 200 with decision + reasonText (neutral outcome card). Status guard: killSwitch treasury.
Yield accrual: on GET /api/treasury, each active sweep earns yield = mulDivFloor(amountFils, yieldMbsdPermyriad, 10_000) per day since createdAt — display only (accruedYieldFils computed live, stored on recall).

### POST /api/treasury/recall  (Idempotency-Key required)
Body: `{ sweepId }`. Posts reverse txn (INSTRUMENT_HOLDING debit amount+yield / SME_WALLET credit amount+yield), sweep state recalled, recalledAt, yieldFils stored, AppEvent sweep.recalled.

### POST /api/treasury/obligations
Body: `{ label, kind, dueDate, amountFils, cadence? }` → creates manual obligation (kind "custom"). AppEvent.

### GET /api/status
Reads StatusState singleton. Returns `{ mode, message, killSwitches, breakers, updatedAt, modeCatalog }` where modeCatalog describes M0–M4 (label, description, smeSees) for the UI. This endpoint must NEVER fail — it drives the status banner.

### POST /api/status  (operator console; Idempotency-Key required)
Body: `{ mode?, killSwitch?: { name, on }, breaker?: { name, state }, message?, reason, confirm: true }`.
Writes OperatorAction (action mode_transition/kill_switch/breaker_sim, actor "operator@du", reason) + AppEvent status.changed. Mode M2/M3 also flips breaker aani/dupay? (independent — leave breakers separate). Return new status.
Kill switch names: global, dynamicDiscounting, escrow, treasury, tenant, buyer, sector, rail.
Breaker names: dupay, aani, openfinance, einvoice, custodian, notification; states: closed | half | open.

### GET /api/activity?limit=50
AppEvents ordered desc with `title`, `detail`, `type`, `subjectRef`, `occurredAt` rendered server-side (map each type to human copy, e.g. invoice.verified → "Invoice ESS-INV-2214 confirmed by buyer"). Include money where present.

### GET /api/audit
Ledger integrity: verifyLedgerIntegrity + recent ledger entries (last 25) + decisions count + payout totals. For the Ops console audit tab.

## Cross-cutting types
The frontend imports NOTHING from these route files. Shared DTO types will be declared by the frontend in `src/lib/types.ts` (main agent) — keep JSON shapes EXACTLY as above. Dates as ISO strings. Money always `*Fils` integer fields.
