-- Досилання стану в канал після 0062/0064 — і CHECK на режим ціни тарифу.
--
-- ── Нулі, які 0062 лишила в каналі (розділ A п.1, рецензія 2.0) ──────────────
--
-- 0062 обнулила `base_price = 0` у календарі (Ц24: ціни немає — це NULL, не
-- нуль), 0064 — `weekend_price <= 0`. Але координат у чергу вони не поклали:
-- у нас ціни більше немає, а у вендора на тих датах досі лежить ціна 0 з
-- відкритим продажем — рівно та ніч за нуль, від якої обидві міграції
-- рятували. Які саме дати були нулем, після 0062 не відновити (стали NULL,
-- як і рядки, що ніколи ціни не мали), тож досилається не «де було нуль», а
-- ПОВНИЙ СТАН: один діапазон на кожну змаплену пару тип × тариф, від сьогодні
-- до горизонту (500 ночей, `OUTBOX_HORIZON_DAYS`), маска NULL = усі поля.
-- Батчер розкладе по ночах, прочитає поточні числа й стисне в тіло: ніч без
-- ціни поїде `stop_sell`, ніч із ціною — ціною і явним відкриттям (Ц34 (в)).
-- Це один раз, міграцією, а не за таймером (Ц23): два виклики на зʼєднання.
--
-- Лише зʼєднання з обʼєктом на тому боці — без нього адресувати нема куди.
-- Рядок, що вже чекає в черзі, стає «усі поля» (NULL поглинає), нового не
-- додається — тим самим `ON CONFLICT`, що тримає злиття (0054, 0066).
-- На свіжій базі дзеркало порожнє, і міграція не робить нічого.
--
-- Дзеркала в SQLite (`src/lib/db.ts`) у цієї частини НЕМАЄ навмисно: там
-- міграції бігають на кожному старті, і досилання стало б повним синком за
-- таймером; SQLite — розробка, каналу в неї немає.
--
-- Після деплою на беті: Налаштування → Канал-менеджер → «Звірити з каналом»
-- (HANDOVER §0.4).

INSERT INTO cm_outbox (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to, field_mask)
SELECT encode(gen_random_bytes(16), 'hex'), c.organization_id, c.id, 'rate', m.unit_type_id, m.local_id,
       CURRENT_DATE, CURRENT_DATE + 499, NULL
  FROM cm_mappings m
  JOIN cm_connections c ON c.id = m.connection_id
 WHERE m.entity_type = 'rate_plan'
   AND m.unit_type_id <> ''
   AND c.remote_property_id IS NOT NULL
ON CONFLICT (connection_id, kind, (COALESCE(unit_type_id, '')), (COALESCE(rate_plan_id, '')), stay_date, (COALESCE(stay_date_to, stay_date)))
  WHERE claimed_at IS NULL AND sent_at IS NULL
  DO UPDATE SET field_mask = NULL;

-- ── Режим ціни — один із двох (розділ A п.4) ─────────────────────────────────
--
-- 0063 не ставила CHECK «як 0059»: на SQLite його не додати до наявної
-- таблиці. На Postgres — можна і треба: один чужий рядок у `sell_mode` валив
-- екран «Тарифи» цілком (читач кидав на невідомому значенні). Читач тепер
-- читає невідоме як `per_person` з рядком у журналі, писач відмовляє, а база
-- більше не приймає. Наявне невідоме — у `per_person`: так заводились усі
-- тарифи, і саме так його вже читав би екран.

UPDATE rate_plans SET sell_mode = 'per_person'
 WHERE sell_mode IS NULL OR sell_mode NOT IN ('per_room', 'per_person');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rate_plans'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%sell_mode%'
  ) THEN
    ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_sell_mode_check
      CHECK (sell_mode IN ('per_room', 'per_person'));
  END IF;
END $$;
