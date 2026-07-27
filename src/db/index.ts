import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://alisio_user:alisio_secure_password_2026@localhost:5432/alisio_pms';

export const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });

/**
 * Sets the current tenant context for PostgreSQL Row-Level Security (RLS).
 * Must be executed before tenant-scoped database operations.
 */
export async function setTenantContext(tenantId: string) {
  await db.execute(sql`SELECT set_tenant_context(${tenantId}::uuid)`);
}
