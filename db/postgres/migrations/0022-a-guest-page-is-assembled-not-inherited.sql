-- A guest page is assembled, not inherited.
--
-- Every hotel served the same guest page: the first customer's layout, with
-- emptiness as the only off switch. A hotel that wanted no Explore tab left
-- useful_info blank and hoped; a hotel that wanted the restaurant card gone
-- could not have that, because the card renders whenever the config row —
-- created with the first customer's defaults — has a restaurant name in it.
--
-- The page's sections are now named in code (guest-page-sections.ts) and this
-- table stores one thing only: how THIS property differs from the registry —
-- switched off, reordered, or given per-section settings. No rows = the page
-- exactly as it was, for every existing hotel; introducing the mechanism must
-- not move a pixel on anyone's page.
--
-- Section keys are free text on purpose. The registry in code decides what
-- exists and silently drops unknown keys on read, so a row surviving from a
-- removed section is inert, not an error — and adding a section never needs
-- a migration.
CREATE TABLE IF NOT EXISTS "guest_page_sections" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  -- Named constraints, not inline REFERENCES: schema.sql adds the same two by
  -- ALTER TABLE (its tables are created alphabetically, before organizations
  -- exists), and an environment born from the migration must carry the same
  -- constraint names as one born from schema.sql, or the two drift apart in a
  -- way scripts/check-schema-drift.mjs cannot see.
  "organization_id" TEXT CONSTRAINT "fk_guest_page_sections_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT NOT NULL CONSTRAINT "fk_guest_page_sections_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "section"         TEXT NOT NULL,
  "enabled"         BOOLEAN NOT NULL DEFAULT true,
  "sort_order"      BIGINT,
  -- Per-section knobs the section's component reads. JSON text, same as every
  -- other free-form config in this schema.
  "config"          TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per section per property: two rows for one section would make the
-- page depend on which row was read first.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_guest_page_sections_row"
  ON "guest_page_sections" ("property_id", "section");
CREATE INDEX IF NOT EXISTS "idx_guest_page_sections_org"
  ON "guest_page_sections" ("organization_id");

DO $$
DECLARE r text;
BEGIN
  ALTER TABLE "guest_page_sections" ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');
  ALTER TABLE "guest_page_sections" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "guest_page_sections" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "guest_page_sections_tenant" ON "guest_page_sections";
  CREATE POLICY "guest_page_sections_tenant" ON "guest_page_sections"
    USING ("organization_id" = current_setting('app.organization_id'))
    WITH CHECK ("organization_id" = current_setting('app.organization_id'));

  -- Granted to whoever can already read reservations: that is the application
  -- role, whatever it is called in this installation.
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_page_sections" TO %I', r);
  END LOOP;
END $$;
