-- A published report, readable by whoever holds its link — and one name for
-- that idea instead of two.
--
-- Migration 0007 taught the `reservations` policy to recognise a guest's own
-- token on the connection, under the setting `app.guest_token`. The partner
-- report needs exactly the same thing: a document addressed by a link, opened
-- by someone with no account, no session and no organization. Adding
-- `app.report_token` beside `app.guest_token` would be two settings for one
-- idea, and every later reader of `scopeToTenant` would have to check both. So
-- the setting is renamed to what it actually is — `app.public_token` — and
-- both tables use it.
--
-- What that opens is unchanged and still bounded:
--
--   - one row, the one whose token was presented, and only on READ;
--   - NULLIF, so an unset or empty setting matches nothing — a row whose own
--     token is '' must never become world-readable;
--   - WITH CHECK untouched: no link can write a row anywhere, ever.
--
-- Apply this together with the deploy that ships `app.public_token` in
-- src/core/db/postgres.ts. Applied without it, the guest portal answers 404
-- again, exactly as it did before 0007 — scripts/check-deployed-db.mjs looks
-- for this and will say so.
--
-- Re-runnable.

BEGIN;

-- ── The report ──────────────────────────────────────────────────────────────
--
-- The HTML lives in the row. The server is rebuilt from its image on every
-- deploy, so a file written next to the application is gone with the next one;
-- a report a partner was sent in July must still open in December. It also
-- means the report is covered by the same pg_dump that backs up everything
-- else, rather than by a second thing someone has to remember.
CREATE TABLE IF NOT EXISTS "partner_reports" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT REFERENCES "properties"("id") ON DELETE SET NULL,
  "token"           TEXT NOT NULL UNIQUE,
  "slug"            TEXT,
  "title"           TEXT NOT NULL,
  "period"          TEXT,
  "html"            TEXT NOT NULL,
  "published_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "revoked_at"      TIMESTAMPTZ,
  "views"           BIGINT NOT NULL DEFAULT 0,
  "last_viewed_at"  TIMESTAMPTZ
);

-- `token` is already UNIQUE on the column, which is an index.
CREATE INDEX IF NOT EXISTS "idx_partner_reports_period" ON "partner_reports" ("organization_id", "period");
CREATE INDEX IF NOT EXISTS "idx_partner_reports_org" ON "partner_reports" ("organization_id");

-- Like every other directly scoped table (migration 0005), a row takes the
-- tenant of the statement that writes it.
ALTER TABLE "partner_reports" ALTER COLUMN "organization_id"
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE "partner_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_reports" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_reports_tenant" ON "partner_reports";
CREATE POLICY "partner_reports_tenant" ON "partner_reports"
  USING ("organization_id" = current_setting('app.organization_id')
         OR "token" = NULLIF(current_setting('app.public_token', true), ''))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

-- The application connects as a role that owns nothing, so a table created
-- here is unreachable to it until granted. deploy/to-postgres.sh sets ALTER
-- DEFAULT PRIVILEGES, which covers this — but only when the migration is run
-- by the same role that set them, and that is an assumption, not a guarantee.
-- Rather than hard-code a role name that is configurable, grant to whoever can
-- already read `reservations`: that is the application role, whatever it is
-- called here.
DO $$
DECLARE r text;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "partner_reports" TO %I', r);
  END LOOP;
END $$;

-- ── The rename ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reservations_tenant" ON "reservations";
CREATE POLICY "reservations_tenant" ON "reservations"
  USING ("organization_id" = current_setting('app.organization_id')
         OR "guest_page_token" = NULLIF(current_setting('app.public_token', true), ''))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

COMMIT;
