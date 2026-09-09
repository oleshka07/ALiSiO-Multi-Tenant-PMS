-- Канал володіє тим, що ЗАБРОНЮВАЛИ. Готель — тим, що НАРАХУВАЛИ.
--
-- Рішення власника 09.09.2026 (В10, реєстр К18). `reservation_line_items` —
-- це розбивка кімнати в картці групи, набрана РЕЦЕПЦІЄЮ при поділі між
-- платниками. Ключ на рядок групи мав `ON DELETE CASCADE`, тож ревізія з боку
-- OTA, яка прибирає кімнату з бронювання, стирала ці рядки разом із рядком
-- групи — мовчки, без сліду, і рецепція дізнавалась би про це від гостя на
-- виїзді.
--
-- Уточнення виміру, щоб наступний читач не шукав більшого: фактура і
-- `fin_folio_items` (послуги, мінібар, турзбір, ночі) тримаються за
-- `folio_id`/`reservation_id`, а не за рядок групи — каскад їх НЕ чіпав, і
-- фактура ціла в будь-якому разі, бо вона копія (0013). Ціна вади менша, ніж
-- здавалось; рід той самий.
--
-- Заборона стоїть у БАЗІ, а не в писачі, і саме це головне. `releaseGroupRoom`
-- рядка з позиціями вже не чіпає — але то поведінка одного місця, а наступний
-- `DELETE`, написаний деінде, знову стирав би каскадом і не дізнався про це.
-- Тепер він відмовляє.
--
-- ── Пастка `IF NOT EXISTS` (AGENTS §4) ─────────────────────────────────────
--
-- `ADD CONSTRAINT IF NOT EXISTS` у Postgres немає, а сторож ЗА ІМЕНЕМ тут не
-- працює двічі. На свіжій базі ключ уже створив `db/postgres/schema.sql` під
-- СВОЇМ іменем, яке нумерує генератор; на мігрованій — під тим, що дала
-- попередня міграція. Тому і зняття, і перевірка йдуть за ОЗНАЧЕННЯМ
-- (`pg_get_constraintdef`), а не за `conname`: інакше сторож не знайшов би
-- нічого і додав ДРУГИЙ такий самий ключ.
--
-- Перезапускна: другий прогін не знаходить каскаду, бачить заборону і не
-- робить нічого.
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('public.reservation_line_items') IS NULL THEN
    RETURN;
  END IF;

  -- 1. Зняти КОЖЕН ключ на `sub_booking_id`, який має каскад. Цикл, а не один
  --    `DROP`: якщо колись додалось два (та сама пастка імені), приберуться
  --    обидва.
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.reservation_line_items'::regclass
       AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (sub_booking_id) REFERENCES%'
       AND pg_get_constraintdef(oid) LIKE '%ON DELETE CASCADE%'
  LOOP
    EXECUTE format('ALTER TABLE reservation_line_items DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'reservation_line_items: знято каскадний ключ %', c.conname;
  END LOOP;

  -- 2. І поставити один БЕЗ каскаду, якщо такого ще немає.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.reservation_line_items'::regclass
       AND contype = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (sub_booking_id) REFERENCES%'
       AND pg_get_constraintdef(oid) NOT LIKE '%ON DELETE%'
  ) THEN
    ALTER TABLE reservation_line_items
      ADD CONSTRAINT fk_reservation_line_items_sub_booking_id_1
      FOREIGN KEY (sub_booking_id) REFERENCES reservation_sub_bookings (id);
    RAISE NOTICE 'reservation_line_items: заборона на місці';
  END IF;
END $$;
