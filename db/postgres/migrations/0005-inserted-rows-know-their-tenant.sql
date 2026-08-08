-- An inserted row belongs to the tenant the statement is running as.
--
-- Reading did not have to name the organization: the policy adds it. Writing
-- did, in every column list, and fourteen INSERT statements in the application
-- did not — so on Postgres they were refused, always:
--
--   INSERT INTO widget_handshakes (token, site_id, expires_at) VALUES (…)
--
-- organization_id is absent, so it is NULL, and the policy asks
-- `NULL = 'org_…'` — NULL, not true. Refused. Setting the tenant context
-- correctly does not help: the context is what the policy compares the column
-- against, it is not what fills the column. The error names row-level security
-- and not the missing column, and every one of these statements looked right.
--
-- What that cost while it was live: the booking handshake, so no guest could
-- start a reservation at all; the booking activity log and the finance
-- operation audit, so the audit trails recorded nothing; coupons, gift cards
-- and gift-card bundles could not be created; Hostex availability blocks were
-- dropped on every sync; the Teya payment webhook logged nothing.
--
-- The fix is symmetry — the column defaults to the tenant the connection
-- already established, exactly as the read side already worked.
--
-- NULLIF, not the bare setting: with no tenant the setting is '', and an empty
-- organization id would satisfy `'' = ''` and write a row into no hotel at all
-- — belonging to nothing, visible to nobody, and impossible to find later. NULL
-- fails the check, so a write that forgot to establish a tenant stays an error.
--
-- The `true` is current_setting's missing_ok: without it the function RAISES on
-- a connection that never set the variable, and a psql session doing
-- maintenance has not — the default would make the table unusable by hand.
--
-- Applies to tables whose own organization_id is what the policy checks. A
-- table scoped through a parent (site_id, reservation_id, user_id) has no such
-- column and needs nothing here. Read from the target database's own policies
-- rather than a list written out here, so this cannot drift from the schema.
--
-- Re-runnable: SET DEFAULT is idempotent.

BEGIN;

DO $$
DECLARE
  t text;
  n int := 0;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_attribute a ON a.attrelid = c.oid
                         AND a.attname = 'organization_id'
                         AND a.attnum > 0 AND NOT a.attisdropped
     WHERE pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%organization_id = current_setting%'
       -- A derived policy names organization_id too, inside a subquery on the
       -- parent. Those tables have no column of their own to default.
       AND pg_get_expr(p.polwithcheck, p.polrelid) NOT LIKE '%SELECT%'
     ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(%L, true), %L)',
      t, 'app.organization_id', ''
    );
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'organization_id defaults to the current tenant on % table(s)', n;
END $$;

COMMIT;
