# WATERLINE — Judge's Demo Guide

**5-minute script** for evaluating the receivables-finance demo.

## Setup (one line)
```bash
npm install && npm run dev
# open http://localhost:3000
```
The demo world (`Al Marwan Technical Services LLC`, tenant `t_8821`) seeds itself on first API hit. All dates are relative to `now`.

## The story

Al Marwan is a Dubai SME (DED-7482910) with a healthy receivables book. It wants to:
1. Get an **indicative funding limit** before uploading any invoice (from du billing history alone).
2. **Quote** a verified invoice → accept → **settle** on the duPay rail.
3. Sweep idle treasury into yield instruments without breaching its absolute floor.
4. Manage an **escrow milestone** contract with staged releases.
5. Watch **rule-pack canary** promotion change live decisions.

## Walkthrough

| Step | What to do | What to observe |
|---|---|---|
| 1 | `GET /api/overview` | Entity card, indicative limit, wallet/liquidity, 4 buyers (platinum→unrated), consents, status mode. |
| 2 | `GET /api/invoices` | Invoices in `received → verified` states; `readyCount` / `readyFils`. |
| 3 | `POST /api/invoices/[id]/quote` | Decision with `priceMilliBpsPerDay`, `limitFils`, and per-rule `checks[]` trace. |
| 4 | `POST /api/offers/[id]/accept` then `settle` | Payout `accepted → reserved → sent → settled`; `Idempotency-Key` makes retries a no-op. |
| 5 | `GET /api/treasury/*` | Idle wallet swept above floor; yield accrues additive on forecast; floor never breached. |
| 6 | `GET /api/escrow` + milestone transitions | `pending → met → released`; released vs pending fils tracked separately. |
| 7 | `POST /api/ops/e07-drill` → `GET /api/ops/canary` | Canary pack promoted; live decision diff (approvals gained/lost, limit/price moves). |
| 8 | `GET /api/audit` | Ledger balances (debits = credits); every decision replayable via `inputHash` + `rulepackVersion`. |

## Key properties judges can verify

- **Fail-closed tenancy**: without `SET app.tenant_id`, every tenant-keyed table returns zero rows (RLS enforced in `prisma/migrations/0001_init`).
- **No float money**: all amounts are integer fils; balances derived from the ledger, never stored.
- **Deterministic pricing**: same inputs → same quote via the rule pack; canary shows an additive diff.
- **Idempotent payouts**: reuse an `Idempotency-Key` with the same payload → no duplicate money movement.
- **No secrets in repo**: `.env` is untracked/gotignored; `.env.example` has placeholders only.

## Repo pointers

- `README.md` — full overview, architecture, reproducibility, API map.
- `prisma/migrations/0001_init/migration.sql` — versioned schema + RLS policies.
- `src/lib/db.ts:withTenant` — app-layer tenant context (`SET LOCAL app.tenant_id`).
- `src/lib/seed.ts` — idempotent demo world (`DEMO_TENANT = t_8821`).
- `upload/WATERLINE-PRD-and-Master-Build-Specification.pdf` — full PRD + API contract.
