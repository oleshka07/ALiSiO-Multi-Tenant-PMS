-- 0405: денна дельта Winhotel, памʼять про час знімка, і оплата, перенесена
-- з попередньої системи, називає своє походження.
--
-- Задача 8 сесії 5 (docs/tasks/2026-09-10-block-winhotel-import.md, рецензія Б):
--
-- 1. `fin_folio_payments.source` / `origin` (З34). Історична оплата з Winhotel
--    уже підписана ТІЄЮ касою і в нашій не відбувалась: вона лягає у фоліо повз
--    фіскальну варту, але лише з `source = 'import'` і походженням
--    `winhotel:<LNR>`. NULL у `source` — наша каса, варта як була.
-- 2. `winhotel_snapshots.mode` дістає `delta`: агент кожні 15 хв шле не базу, а
--    вивід isql за вікном дат; правило «один знімок на добу» — лише для повних.
-- 3. `winhotel_refs.source_taken_at` — час знімка, який останнім писав рядок:
--    повний знімок, узятий РАНІШЕ за дельту, не перепише її (кіоск бачить
--    сьогоднішній стан, а не нічний).
--
-- SQLite-дзеркало — `src/lib/db.ts` (fin_folio_payments catch-up, migrateWinhotelImport).

ALTER TABLE fin_folio_payments ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE fin_folio_payments ADD COLUMN IF NOT EXISTS origin TEXT;

ALTER TABLE winhotel_refs ADD COLUMN IF NOT EXISTS source_taken_at TIMESTAMPTZ;

-- CHECK на mode — за ОЗНАЧЕННЯМ, не за імʼям (генератор нумерує імена по-своєму).
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'winhotel_snapshots'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%mode%'
  LOOP
    EXECUTE format('ALTER TABLE winhotel_snapshots DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE winhotel_snapshots
    ADD CONSTRAINT winhotel_snapshots_mode_check CHECK (mode IN ('backup', 'gbak', 'copy', 'delta'));
END $$;
