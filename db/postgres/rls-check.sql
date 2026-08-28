--
-- Does row-level security actually isolate two tenants?
--
--   psql -d alisio -v ON_ERROR_STOP=1 -f db/postgres/schema.sql
--   psql -d alisio -v ON_ERROR_STOP=1 -f db/postgres/rls-check.sql
--
-- Same argument as scripts/check-isolation.mjs makes against the running
-- application: a policy that exists is not the same as a policy that works.
-- This one puts two organizations in the same tables and proves the second
-- cannot see, change or delete the first one's rows.
--
-- Every assertion raises on failure, so ON_ERROR_STOP=1 turns a hole into a
-- non-zero exit code.
--

\set ON_ERROR_STOP on

BEGIN;

-- The application must never connect as the table owner: RLS is not applied to
-- the owner unless FORCE is set, and relying on FORCE alone means one missed
-- table is a silent full-table read.
--
-- `rlsprobe_app`, not `alisio_app`: this file used to create and DROP a role by
-- the name a real deployment gives the application, so running the proof
-- against a live database would have dropped the role the application connects
-- as. Same prefix as the throwaway rows below, and dropped with them.
DROP ROLE IF EXISTS rlsprobe_app;
CREATE ROLE rlsprobe_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO rlsprobe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rlsprobe_app;

-- Two tenants, seeded as the owner so the policies are not in the way yet.
INSERT INTO organizations (id, name, slug) VALUES
  ('rlsprobe_a', 'Probe A', 'rlsprobe-a'),
  ('rlsprobe_b', 'Probe B', 'rlsprobe-b');

INSERT INTO properties (id, organization_id, name, slug) VALUES
  ('rlsprobe_prop_a', 'rlsprobe_a', 'A Hotel', 'rlsprobe-a-hotel'),
  ('rlsprobe_prop_b', 'rlsprobe_b', 'B Hotel', 'rlsprobe-b-hotel');

-- A child table that reaches the organization only through its property. This
-- is the case a hand-written policy forgets.
INSERT INTO categories (id, property_id, name, type) VALUES
  ('rlsprobe_cat_a', 'rlsprobe_prop_a', 'A rooms', 'resort'),
  ('rlsprobe_cat_b', 'rlsprobe_prop_b', 'B rooms', 'resort');

COMMIT;

-- ── As tenant B ─────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL ROLE rlsprobe_app;
SET LOCAL app.organization_id = 'rlsprobe_b';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM properties WHERE id = 'rlsprobe_prop_a';
  IF n <> 0 THEN RAISE EXCEPTION 'B can see A''s property (% rows)', n; END IF;

  SELECT count(*) INTO n FROM properties;
  IF n <> 1 THEN RAISE EXCEPTION 'B sees % properties, expected only its own', n; END IF;

  SELECT count(*) INTO n FROM categories WHERE id = 'rlsprobe_cat_a';
  IF n <> 0 THEN RAISE EXCEPTION 'B can see A''s category through property_id'; END IF;

  -- An UPDATE that matches nothing is not an error, it just changes nothing.
  UPDATE properties SET name = 'Hijacked' WHERE id = 'rlsprobe_prop_a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B updated % of A''s properties', n; END IF;

  DELETE FROM properties WHERE id = 'rlsprobe_prop_a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B deleted % of A''s properties', n; END IF;

  RAISE NOTICE '  ok  B cannot see, change or delete A''s rows';
END $$;

-- WITH CHECK: B must not be able to file a row under A either.
DO $$
BEGIN
  BEGIN
    INSERT INTO properties (id, organization_id, name, slug)
      VALUES ('rlsprobe_stolen', 'rlsprobe_a', 'Stolen', 'rlsprobe-stolen');
    RAISE EXCEPTION 'B inserted a row into A''s organization';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  B cannot write a row into A''s organization';
  END;
END $$;

COMMIT;

-- ── With no tenant set ──────────────────────────────────────────────────────
-- A connection that forgot to set the organization must read nothing. This is
-- the failure mode that matters: a forgotten scope has to be an error or an
-- empty result, never a full-table read.
BEGIN;
SET LOCAL ROLE rlsprobe_app;

DO $$
DECLARE n integer;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM properties;
    IF n <> 0 THEN RAISE EXCEPTION 'a connection with no tenant read % properties', n; END IF;
    RAISE NOTICE '  ok  no tenant set reads nothing';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE '  ok  no tenant set raises rather than reading';
  END;
END $$;

COMMIT;

-- ── As tenant A, to prove the policy is not simply blocking everything ──────
BEGIN;
SET LOCAL ROLE rlsprobe_app;
SET LOCAL app.organization_id = 'rlsprobe_a';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM properties WHERE id = 'rlsprobe_prop_a';
  IF n <> 1 THEN RAISE EXCEPTION 'A cannot see its own property'; END IF;

  SELECT count(*) INTO n FROM categories WHERE id = 'rlsprobe_cat_a';
  IF n <> 1 THEN RAISE EXCEPTION 'A cannot see its own category'; END IF;

  UPDATE properties SET name = 'A Hotel renamed' WHERE id = 'rlsprobe_prop_a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'A cannot rename its own property'; END IF;

  RAISE NOTICE '  ok  A still sees and changes its own rows';
END $$;

COMMIT;

-- ── Coverage: no tenant table left without a policy ─────────────────────────
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity
    AND c.relname NOT IN (
      'organizations', 'sessions', 'rate_limits', 'settings', 'content_translations',
      'email_processed', 'fin_system_state',
      -- Платформа стоїть НАД орендарями, а не всередині одного з них: це
      -- облікові записи того, хто обслуговує сервер, і їхні сесії. Політика
      -- «бачиш лише свою організацію» тут не має сенсу — організації немає.
      -- Доступ до них дає окрема варта (withPlatformAdmin), не RLS.
      --
      -- Їх бракувало в списку від початку, тож ця перевірка падала на кожній
      -- свіжій базі — і саме тому її вивід звикли читати як «ну там завжди
      -- щось червоне». Перевірка, якій не вірять, не перевіряє нічого.
      'platform_users', 'platform_sessions'
      -- `hostex_sync_log` і `hostex_property_map` звідси прибрано разом із
      -- мостом Hostex: таблиць більше немає, і рядок у списку винятків для
      -- неіснуючої таблиці мовчки прикриє майбутню таблицю з тим же іменем.
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'tables without row-level security: %', missing;
  END IF;
  RAISE NOTICE '  ok  every tenant table has row-level security enabled';
END $$;

-- ── Cleanup ─────────────────────────────────────────────────────────────────
BEGIN;
DELETE FROM categories WHERE id LIKE 'rlsprobe_%';
DELETE FROM properties WHERE id LIKE 'rlsprobe_%';
DELETE FROM organizations WHERE id LIKE 'rlsprobe_%';
COMMIT;

-- The role too, so a second run does not trip over grants left by the first.
REASSIGN OWNED BY rlsprobe_app TO CURRENT_USER;
DROP OWNED BY rlsprobe_app;
DROP ROLE IF EXISTS rlsprobe_app;

\echo 'rls: all checks passed'
