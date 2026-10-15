# Task 2-a — Backend: invoices, decisions, consents, overview (API routes)

**Task ID:** 2-a
**Agent:** backend-agent-a (Z.ai Code)
**Status:** COMPLETE — all 11 route files written, lint clean, TypeScript strict clean, full smoke suite passed.

## Files owned (do not edit without coordination)

1. `src/app/api/overview/route.ts` — GET: Cash-view aggregate
2. `src/app/api/invoices/route.ts` — GET (filter=all|ready|pending|disputed|settled) + POST (submit)
3. `src/app/api/invoices/[id]/route.ts` — GET detail (invoice + buyer + offers + latest decision + payout + eligibility hint)
4. `src/app/api/invoices/[id]/confirm/route.ts` — POST: buyer-portal confirmation (deduped → verified)
5. `src/app/api/invoices/[id]/settle/route.ts` — POST: demo buyer settlement (money-moving, Idempotency-Key REQUIRED)
6. `src/app/api/invoices/[id]/quote/route.ts` — GET: THE deterministic decision flow
7. `src/app/api/decisions/route.ts` — GET list (default 25, ?limit=1..100)
8. `src/app/api/decisions/[id]/route.ts` — GET full record + parsed featureSnapshot
9. `src/app/api/decisions/[id]/replay/route.ts` — POST: replay regression
10. `src/app/api/consents/route.ts` — GET list + POST grant
11. `src/app/api/consents/[id]/route.ts` — DELETE revoke

## Contract-shape notes for the frontend agent

- Envelope everywhere: `{ ok: true, data, trace_id }` / `{ ok: false, error: { code, detail, trace_id, retryable } }`.
- **POST /api/invoices/[id]/settle requires header `Idempotency-Key` (≥8 chars)** → else 400. (Same for 2-b's accept/sweep/escrow routes.)
- POST /api/invoices returns 201; duplicate → 409 `duplicate_invoice` with the original surfaced in `error.detail`.
- Quote rejections are HTTP **200** with `decision.outcome="rejected"`, `offer: null`, `rateCurve.mbpsPerDay: null` — render the neutral outcome card, not an error.
- Quote on funded invoice → 409 code `already_funded` (settled → `already_settled`).
- `rateCurve.mbpsPerDay` is the flat mbps/day anchor for the local date-slider model (fee = days × mbps × principal ÷ 100,000, integer fils).
- Invoice list item carries `dueInDays`, `buyer{}`, `latestOffer{}`, `latestDecision{}`.
- Invoice detail carries `eligibilityHint: { reasonCode, reasonText } | null` (engine-derived; `E_DISPUTED`/`ALREADY_FUNDED`/`ALREADY_SETTLED` special-cased for display).
- Overview: `liquidity.sweepableFils` comes from the same `evaluateSweep` snapshot the treasury route uses.
- AppEvents emitted by 2-a: `invoice.submitted`, `invoice.verified`, `invoice.settled`, `reserve.released`, `decision.recorded`, `decision.replayed`, `consent.granted`, `consent.revoked`, `fraud.review`.

## Key implementation decisions

- **Hash formula (POST /api/invoices):** `hashSnapshot({ buyerTaxId (uppercased/trimmed), ref, gross, issueDate: "YYYY-MM-DD" })`. Seed hashes use a different formula (`{ buyer, ref, gross, issued: daysAgo }`), so seeded rows can never collide by hash — a secondary per-tenant guard on `(buyerLinkId, externalRef, grossFils)` catches resubmissions of seeded invoices → 409. Cross-tenant collisions (hash-based) freeze both copies + `fraud.review` event, per PRD 4.2.
- **Verification priority:** einvoice/du_ap source + trusted buyer (silver+, ≥3 confirmed invoices) → instant verify; platinum/gold buyer → `buyer_api` instant verify; else stays `deduped` awaiting POST confirm (buyer_portal). POST accepts optional `source` (validated, default `upload`).
- **Book exposure (quote):** sum of `principalFils` of accepted offers on invoices with `fundingState !== "settled"` (contract wording: "outstanding funded advances").
- **Status guards:** every write route blocks M4 (`errors.degraded("M4")`). Quote + settle also block kill switches `global`/`dynamicDiscounting` (423). M3 does NOT block quotes or settlements (it suspends new funding = acceptance).
- **Settle money path:** collection txn (`invoice.settled:{id}`) + reserve release (`reserve.release:{id}`) via `postTransaction`; reserve = gross − net − fee mirroring the funding txn's RESERVE_HELD credit exactly; repeat settle is idempotent (`alreadySettled: true`), ledger dedupes on (tenant, sourceEventId).
- **Replay:** compares the six contract fields byte-identically for advance decisions (outcome, limitFils, advanceRatePermyriad, priceMilliBpsPerDay, reasonCode, bindingRule); treasury_sweep decisions compare outcome/reasonCode/bindingRule (the fields persisted on the row). Original row never modified.
- **Consents:** one row per purpose; re-grant after revocation clears `revokedAt` (history in events). POST /api/invoices hard-requires active `billing_history` consent (403).

## Issues found in shared code (reported, NOT modified)

1. **`src/lib/ledger.ts` idempotency check is broken:** `postTransaction` looks up `findFirst({ where: { tenantId, sourceEventId } })` with the UNSUFFIXED sourceEventId, but rows are stored with `${sourceEventId}:${accountCode}` suffixes — the lookup never matches, so `alreadyPosted` never returns true; DB unique constraint on the suffixed id is the only real protection (a genuine repeat with identical entries throws P2002 inside the transaction instead of no-op). My routes are safe because state guards prevent repeat postings.
2. **`src/lib/api.ts` type error (pre-existing):** `problem()` declares `NextResponse<ApiErr>` but the JSON body lacks the `status` field that `ApiErr` requires (status is passed to `NextResponse.json()` options). Cosmetic typing bug; runtime behaviour is correct.
3. **Seed hash formula** differs from the contract hash formula (noted above) — handled with the secondary document guard.
4. **`src/app/layout.tsx`** (frontend WIP) currently imports a not-yet-created `@/components/waterline/providers`, which makes the dev server return 500 for ALL routes (API included) until that file exists. All 2-a routes were validated by direct handler invocation (throwaway smoke script, deleted afterwards).

## Smoke-test coverage (all passed, DB restored to pristine seed state afterwards)

Overview derivation (wallet from ledger, sweepable matches engine on same inputs, ready counts), list filters + ordering, detail + hints + 404, quote rejections (E_MIN_SIZE/E_OVERDUE/E_UNVERIFIED at HTTP 200), approval arithmetic (inv_steel_a: limit 4,365,000 @ 38 mbps, ratePermyriad 9000, offer TTL ~120 s, re-quote expires prior offer), unrated cap (720,000 = 0.60 × 1,200,000 @ 64 mbps incl. slow-pay adj), POST dedupe 409s, auto-verify via buyer_api, confirm transition + counter bump, consent gate 403, grant/revoke/regrant, settle guards, full settle flow (reserve 100,000 released to wallet exactly, idempotent re-settle, ledger balanced), decisions list/detail/replay (`matchesOriginal: true` on fresh and seeded decisions).
