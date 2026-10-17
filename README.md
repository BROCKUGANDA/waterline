# WATERLINE

Receivables finance platform for UAE SMEs — invoice discounting, escrow milestone funding, treasury sweep, and multi-tenant data isolation enforced at the database layer.

```
Entity: Al Marwan Technical Services LLC (Dubai SME, DED-7482910)
Demo tenant: t_8821  (alive data, seeded on first hit)
```

## What it does

| Capability | Endpoints | What a judge sees |
|---|---|---|
| **Invoice verification & advance quotes** | `GET /api/invoices`, `POST /api/invoices/[id]/quote` | Uploaded invoices move through `received → verified`; a quote returns a principal + rate + expiry computed by the deterministic rule pack. |
| **Offer lifecycle** | `POST /api/offers/[id]/accept`, `settle` | Accept an offer → payout queued → rail (duPay / AANI) → settled. Idempotency keys make duplicate payouts structurally impossible. |
| **Escrow milestones** | `GET /api/escrow`, `POST /api/escrow/[id]/milestones/[mid]` | Milestone contracts (buyer approval / document review / time release) with state transitions and released/pending fils. |
| **Treasury sweep** | `GET /api/treasury/*` | Idle wallet swept into instruments when above floor; yield accrues additive on the forecast; floor is absolute and never breached. |
| **Obligations & forecast** | `GET /api/overview`, `GET /api/treasury/obligations` | Payroll/rent/VAT/supplier/du_bill obligations projected 14 days; sweepable balance derived from the ledger (never stored as truth). |
| **Rule packs & canary** | `GET /api/status`, `GET /api/decisions` | Deterministic rule-engine decisions with full rule check traces; 5% canary bucket routes live decisions to a candidate pack with a public diff. |
| **Activity & audit** | `GET /api/activity`, `GET /api/audit` | Immutable ledger (double-entry derived balances) and an event stream for the demo narrative. |
| **Ops / canary drill** | `GET /api/ops/canary`, `POST /api/ops/e07-drill` | Promote a canary pack, run the E07 drill outcome simulation, drain queued payouts. |

## Architecture

```
browser (Next.js App Router, pages/)
      │
      ▼
src/app/api/*/route.ts   ← server actions, RFC 9457 problem envelopes
      │
      ▼
src/lib/*.ts             ← ruleengine, ledger, payout-queue, seed, guardrails, killswitch
      │
      ▼
Prisma Client → PostgreSQL  (DATABASE_URL)
      │
      └─ row-level security: current_setting('app.tenant_id') = tenantId
         enforced on every tenant-keyed table via app_user (non-owner role)
```

### Data model (PRD Part 2.5)

- **Money**: integer fils (`1 AED = 100 fils`), never floats. All balances are **derived from the ledger** — never stored as truth (PRD 2.5).
- **Rates**: fixed-point `priceMilliBpsPerDay = bps/day × 10` (e.g. `34` = 3.4 bps/day).
- **Tenant key on every row** (`tenantId`). RLS policies in `prisma/migrations/0001_init/migration.sql` require a tenant predicate; a query without tenant context returns **zero rows** (fail-closed).
- **Portable schema**: JSON stored as `String`, no SQLite/Postgres-native types, so the datasource swaps cleanly.

### Security model (PRD Parts 2.3, 10)

1. **Row-level security**: every tenant-keyed table has `tenantId`; the `tenant_isolation` policy gates on `current_setting('app.tenant_id', true)`.
2. **App connects as `app_user`** (a non-owner role). Superusers and table owners bypass RLS by design, so the app must never connect as `postgres`.
3. **Per-request tenant context**: `withTenant(tenantId, fn)` in `src/lib/db.ts` runs `SET LOCAL app.tenant_id = ...` inside `db.$transaction`. Forgot `withTenant` → zero rows, not a leak.
4. **Field-level encryption**: envelope encryption with a dev-only KEK (`CWL_FIELD_KEK_BASE64`); production KEK lives in an HSM-backed KMS and never enters lower environments.
5. **Secret scanning + push protection** are enabled on this repository; `.env` is untracked and gitignored, `.env.example` carries placeholders.

## Repository contents

```
README.md                      ← this file (overview + demo + reproducibility)
.env.example                   ← local env template (never commit real secrets)
.gitignore                     ← .env* ignored, .env.example tracked
.gitattributes                 → LF line endings, binary images untouched
prisma/schema.prisma           ← domain model + postgresql datasource
prisma/migrations/0001_init/   ← base schema + RLS policies (versioned)
src/                           ← Next.js app (pages, API routes, lib, components)
upload/WATERLINE-PRD-and-Master-Build-Specification.pdf
```

## For judges — 5-minute demo script

1. **Start the app** (`npm run dev`), open `http://localhost:3000`.
2. **Cash view** (`/api/overview`): Al Marwan Technical Services LLC — indicative limit derived from du billing history alone (no invoice uploaded yet), wallet balance, sweepable amount, buyer tiers (Emirates Steel platinum, Emaar gold, MAF silver, Noor unrated).
3. **Quote an invoice**: `POST /api/invoices/[id]/quote` → decision with `priceMilliBpsPerDay`, `limitFils`, full rule check trace. Watch the decision change when the canary pack is active.
4. **Accept + settle**: accept the offer → payout moves `accepted → reserved → sent → settled` on the duPay rail with an idempotency key; retrying the same key is a no-op.
5. **Treasury sweep**: idle money above the floor sweeps into an instrument; yield appears on the forecast the same day; the floor is absolute.
6. **Escrow**: fund a milestone contract, transition a milestone `pending → met → released`; released fils tracked separately from pending.
7. **Canary drill**: `POST /api/ops/e07-drill` simulates the E07 outcome; `GET /api/ops/canary` shows pack promotion and the decision diff.
8. **Audit**: `GET /api/audit` proves the ledger balances (debits = credits) and every decision is replayable via `inputHash` + `rulepackVersion`.

## Reproducibility — run it yourself

### Prerequisites
- Node.js 20+
- PostgreSQL 17+ (local instance)

### 1. Environment
```bash
cp .env.example .env
# edit DATABASE_URL / CWL_FIELD_KEK_BASE64 / CWL_TOKEN_SECRET_BASE64 as needed
```

`DATABASE_URL` must point to a Postgres role that is **not** a table owner (RLS does not apply to owners/superusers). The example uses `app_user:app_dev`.

### 2. Database
```bash
# create the database + role (one time)
psql -U postgres -c "CREATE DATABASE waterline;"
psql -U postgres -c "CREATE ROLE app_user LOGIN PASSWORD 'app_dev';"
psql -U postgres -d waterline -c "GRANT CREATE ON SCHEMA public TO app_user;"

# apply versioned schema + RLS (superuser needed for DDL)
DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5432/waterline?schema=public" \
  npx prisma migrate deploy

# switch the app back to app_user so RLS is enforced at runtime
# DATABASE_URL in .env already points at app_user
```

### 3. Install & run
```bash
npm install
npm run dev          # http://localhost:3000
```

The demo world seeds itself on first API hit (`ensureSeed`): Al Marwan LLC, four buyers, invoices, consents, treasury policy, obligations, escrow contract, milestones. Data is relative to `now`, so the story stays alive.

### 4. Typecheck / lint
```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
```

### 5. Reset
```bash
npx prisma migrate reset   # drops and re-applies migrations, re-seeds on next hit
```

## Tech stack

- Next.js (App Router, TypeScript)
- Prisma ORM + PostgreSQL 17
- Tailwind CSS v4
- Row-level security for multi-tenancy
- Envelope encryption for sensitive fields
- RFC 9457 problem responses, idempotency keys, trace ids

## Related

- `upload/WATERLINE-PRD-and-Master-Build-Specification.pdf` — full product requirements (tenants, money model, rates, security, API contract).
