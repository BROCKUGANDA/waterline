import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging is a development aid. Left on unconditionally it floods the
// hot path (PRD 2.2) and writes tenant-identifying rows to stdout in any
// environment that inherits NODE_ENV=development, so it is opt-in via DEBUG_SQL.
const log = process.env.DEBUG_SQL === '1' ? ['query' as const] : ['error' as const]

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// The client Prisma passes into a $transaction callback omits connection
// management methods, but keeps every model operation plus $queryRaw /
// $executeRaw — exactly what tenant-scoped access needs.
type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>

/**
 * Run `fn` inside a transaction with `app.tenant_id` set for its duration, so
 * Postgres row-level security (prisma/migrations/0001_init) scopes every
 * read/write to the given tenant.
 *
 * Fails closed: without a tenant context, RLS returns zero rows for every
 * tenant-keyed table — so a forgotten `withTenant` call surfaces as missing
 * data rather than a cross-tenant leak.
 *
 * All tenant-scoped data access must go through this helper (or explicitly set
 * `SET LOCAL app.tenant_id = ...` inside `$transaction`). Never call `db.*`
 * directly for tenant data.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.tenant_id = ${tenantId}`
    return fn(tx)
  })
}
