-- Дзеркало мапінгу отримує вісь ПАРИ: `cm_mappings.unit_type_id`.
--
-- ── Навіщо ────────────────────────────────────────────────────────────────
--
-- У нас тариф належить ОБʼЄКТУ, а вісь заселеності — типу номера
-- (інваріант 15). У менеджера каналів навпаки: тариф належить ТИПУ НОМЕРА
-- (`room_type_id` обовʼязковий при створенні — INVENTORY §3). Тому наш тариф
-- із цінами на трьох типах стає ТРЬОМА тарифами на тому боці; це рішення Ц6,
-- і воно було записане раніше, ніж знайшлося, що дзеркало його не вміє.
--
-- Старий ключ `(connection_id, entity_type, local_id, occupancy)` розрізняв
-- тарифи, але не пари. Наслідків два, і обидва тихі:
--
--   * `putMapping` видаляє перед вставкою — другий тип номера ЗАТИРАВ би
--     рядок першого, і в дзеркалі лишався б один тариф із трьох;
--   * а якби не затирав — вставка впала б на цьому ж UNIQUE.
--
-- В обох випадках дві третини номерного фонду лишаються без обміну: ARI туди
-- не їде, бронювання звідти не перекладається. Жодної помилки при цьому не
-- видно — саме тому це окрема міграція, а не рядок у чужій.
--
-- ── Порожній рядок, а не NULL ─────────────────────────────────────────────
--
-- `UNIQUE` не обмежує NULL ні в Postgres, ні в SQLite. Обʼєкт і тип номера
-- пари не мають, тож NULL зробив би ключ недієвим саме для них — тобто для
-- рядків, яких найбільше. Той самий прийом і з тієї ж причини, що
-- `occupancy = 0` (0053) і `COALESCE(…, '')` в `idx_cm_outbox_coord` (0054).
--
-- ── Старий ключ знімається за ОЗНАЧЕННЯМ, не за іменем ────────────────────
--
-- `UNIQUE(...)` у `CREATE TABLE` дає констрейнт із іменем, яке вигадує сервер
-- (`cm_mappings_connection_id_entity_type_local_id_occupancy_key` тут,
-- власне ім'я генератора — у `db/postgres/schema.sql`). Сторож за іменем на
-- одній базі знайшов би його, на іншій — ні, і залишив би стару заборону
-- поруч із новою. Тому питаємо каталог про ОЗНАЧЕННЯ (AGENTS §4).

ALTER TABLE cm_mappings ADD COLUMN IF NOT EXISTS unit_type_id TEXT NOT NULL DEFAULT '';

DO $$
DECLARE
  old_name text;
BEGIN
  -- Старий ключ: рівно ті чотири колонки, у тому порядку, без типу номера.
  SELECT conname INTO old_name
    FROM pg_constraint
   WHERE conrelid = 'cm_mappings'::regclass AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (connection_id, entity_type, local_id, occupancy)';
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cm_mappings DROP CONSTRAINT %I', old_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cm_mappings'::regclass AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (connection_id, entity_type, local_id, unit_type_id, occupancy)'
  ) THEN
    -- Ім'я коротке навмисно: Postgres обрізає ідентифікатор на 63 символах і
    -- каже про це NOTICE-ом на кожному деплої. Ім'я тут усе одно ні на що не
    -- впливає — і цей сторож, і генератор схеми звіряються з ОЗНАЧЕННЯМ.
    ALTER TABLE cm_mappings
      ADD CONSTRAINT cm_mappings_pair_key
      UNIQUE (connection_id, entity_type, local_id, unit_type_id, occupancy);
  END IF;
END $$;
