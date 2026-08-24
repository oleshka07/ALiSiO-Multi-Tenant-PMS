-- Somebody has to be able to open the door from outside.
--
-- Until now a person belonged to exactly one hotel: `app_users.organization_id`
-- is where a session gets its tenant, and every policy in this schema compares
-- against it. That is right for the people who work in a hotel and wrong for
-- the one who sells them the product. Onboarding ten customers meant ten
-- accounts, each created from inside the customer's own organization — and the
-- only way in was the owner password printed once at provisioning. Hand it over,
-- the customer changes it, and the supplier is locked out of a system they are
-- responsible for.
--
-- So: a second kind of account that lives OUTSIDE tenancy, and can step into
-- one organization at a time.
--
-- `platform_users` and `platform_sessions` deliberately carry no
-- organization_id. They follow `organizations` and `sessions`, which are global
-- for the same reason: they are what the request consults BEFORE it knows which
-- tenant it belongs to. Row-level security cannot help a table whose whole job
-- is to answer that question, and pretending otherwise by bolting a policy on
-- would only make the protection look stronger than it is.
--
-- `platform_audit` is the opposite: it IS tenant-scoped, on purpose. A record
-- of the supplier entering a customer's data belongs to that customer, shows up
-- in their own change log, and is covered by the same policy as everything else
-- of theirs. The email is frozen into the row rather than joined, because the
-- record must survive the account that made it.
--
-- What this does NOT do: it does not widen what an ordinary user can reach.
-- A platform session is a different cookie, a different table and a different
-- code path; `app_users` still means one person, one hotel.
CREATE TABLE IF NOT EXISTS "platform_users" (
  "id"            TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "email"         TEXT NOT NULL UNIQUE,
  "full_name"     TEXT,
  "password_hash" TEXT NOT NULL,
  "is_active"     BOOLEAN NOT NULL DEFAULT TRUE,
  "last_login"    TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per browser, holding which hotel is currently being acted in.
-- NULL = signed in to the platform but standing outside every customer, which
-- is where a session starts and where it returns on "leave".
CREATE TABLE IF NOT EXISTS "platform_sessions" (
  "id"                     TEXT PRIMARY KEY,
  "platform_user_id"       TEXT NOT NULL
                             CONSTRAINT "fk_platform_sessions_platform_user_id_1"
                             REFERENCES "platform_users"("id") ON DELETE CASCADE,
  "acting_organization_id" TEXT
                             CONSTRAINT "fk_platform_sessions_acting_organization_id_2"
                             REFERENCES "organizations"("id") ON DELETE SET NULL,
  "expires_at"             TIMESTAMPTZ NOT NULL,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_platform_sessions_user"
  ON "platform_sessions" ("platform_user_id");

CREATE TABLE IF NOT EXISTS "platform_audit" (
  "id"               TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id"  TEXT NOT NULL
                       CONSTRAINT "fk_platform_audit_organization_id_1"
                       REFERENCES "organizations"("id") ON DELETE CASCADE,
  "platform_user_id" TEXT
                       CONSTRAINT "fk_platform_audit_platform_user_id_2"
                       REFERENCES "platform_users"("id") ON DELETE SET NULL,
  -- Frozen, not joined: the record of who was in here must outlive the account.
  "platform_email"   TEXT NOT NULL,
  "action"           TEXT NOT NULL,
  "ip"               TEXT,
  "at"               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (action IN ('enter', 'leave'))
);
CREATE INDEX IF NOT EXISTS "idx_platform_audit_org"
  ON "platform_audit" ("organization_id", "at");

DO $$
DECLARE r text;
BEGIN
  EXECUTE 'ALTER TABLE platform_audit ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')';
  EXECUTE 'ALTER TABLE platform_audit ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE platform_audit FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS platform_audit_tenant ON platform_audit';
  EXECUTE 'CREATE POLICY platform_audit_tenant ON platform_audit
    USING ("organization_id" = current_setting(''app.organization_id''))
    WITH CHECK ("organization_id" = current_setting(''app.organization_id''))';

  -- The application role owns nothing, so every new table has to be granted to
  -- it explicitly. Copied from whoever can already read reservations, which is
  -- how every table added since 0005 has found the right grantee.
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON platform_users TO %I', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON platform_sessions TO %I', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON platform_audit TO %I', r);
  END LOOP;
END $$;
