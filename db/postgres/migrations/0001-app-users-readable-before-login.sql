-- Login could not read the table it authenticates against.
--
-- app_users had the standard tenant policy:
--
--   USING (organization_id = current_setting('app.organization_id'))
--
-- but finding the row is HOW the organization is discovered. Login looks a
-- user up by email; every authenticated request joins app_users through a
-- session id. Neither caller can name an organization yet, so postgres.ts
-- sets app.organization_id to '' — and '' matches no row. Every login on the
-- Postgres beta returned 401, which is also what a wrong password returns,
-- which is why the deploy health check called it healthy.
--
-- This replaces the policy with one that opens the READ side only while no
-- tenant is set. WITH CHECK is unchanged and still strict: no row can be
-- written into another organization, and a request that has a tenant still
-- sees only its own users. Row-level security stays enabled and forced.
--
-- db/postgres/schema.sql already generates this form (see READ_BEFORE_TENANT
-- in scripts/pg-schema.mjs); the statements below bring a database created
-- before it into line. Safe to re-run.

BEGIN;

DROP POLICY IF EXISTS "app_users_tenant" ON "app_users";

CREATE POLICY "app_users_tenant" ON "app_users"
  USING ("organization_id" = current_setting('app.organization_id') OR current_setting('app.organization_id') = '')
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

COMMIT;
