-- INC-045. Заборону подвійного бронювання тримає БАЗА, а не уважність коду.
--
-- До цієї міграції в усьому `db/` і `src/` було НУЛЬ входжень `EXCLUDE USING`,
-- `btree_gist`, `FOR UPDATE` і `pg_advisory`. Скрізь стояв один візерунок:
-- прочитали, подумали, записали. У `reservations.handlers.ts` між перевіркою
-- і вставкою стоять дедуплікація гостя і запит комісії — кілька походів у
-- базу, і транзакції немає взагалі. Писачів у `reservations` щонайменше
-- шість. Два одночасні запити на останній номер проходили обидва.
--
-- Це К18 ще раз: правило, яке має тримати база, не можна лишати уважності
-- коду. Перевірка до запису лишається — вона дає людський текст у 99 %
-- випадків; обмеження тримає останній відсоток, у якому й живуть гроші.
--
-- ── Пастка перша: службовий фонд ────────────────────────────────────────
--
-- `units.is_pool` існує САМЕ для того, щоб тримати багато броней на одному
-- рядку навмисно (кемпінг, спільні номери, «місце в наметі»). Але `is_pool`
-- лежить на `units`, обмеження ставиться на `reservations`, а `EXCLUDE` не
-- вміє джойнитись. Пряме обмеження зробило б кемпінг непродаваним, і це була б
-- відмова, якої оператор не зрозуміє.
--
-- Вибір зроблено на користь ТРИГЕРА, а не «писач сам проставить колонку»: увесь
-- сенс INC-045 у тому, щоб не покладатися на шість писачів. Писач, який забуде
-- прапорець, отримав би заборону на pool-юніті — тобто ту саму «функцію, яка
-- зникла», лише з іншого боку. Тригер копіює ознаку з `units` на кожен
-- `INSERT`/`UPDATE` броні, і другий тригер оновлює вже наявні броні, коли
-- ознаку міняють на самому номері.
--
-- ── Пастка друга: список статусів ───────────────────────────────────────
--
-- `FREES_THE_ROOM = "('cancelled', 'no_show')"` живе в
-- `src/modules/bookings/data/conflicts.repo.ts` рядком TypeScript. Тут стоїть
-- ДРУГА копія того самого списку, і копії розійшлися б при першому ж новому
-- статусі: код почав би вважати кімнату вільною, база — зайнятою, і поведінка
-- залежала б від того, який шлях запису спрацював.
--
-- Тому разом із обмеженням заведено гейт `check-overlap-statuses.mjs`: він
-- читає список із коду і список із `pg_get_constraintdef` і червоніє, коли
-- вони різні. Без гейта ця міграція була б дев'ятим підвидом «гейт
-- винагороджує ваду».
--
-- ── `unit_id IS NOT NULL`: ВИМІРЯНО, і не те, що очікувалось ────────────
--
-- Смуга «Без номера» мусить лишитись робочою: бронь із каналу, яку OTA вже
-- продала, відхиляти НЕ МОЖНА — її саджають без номера.
--
-- Але тримає її НЕ ця умова. Перевірено прямо на стенді, тимчасовою таблицею
-- з обмеженням БЕЗ жодного предиката: дві броні з `unit_id IS NULL` на ті самі
-- дати пройшли ОБИДВІ. Причина в тому, що gist-рівність `NULL = NULL` не
-- істинна, тож рядки без номера не конфліктують ні з чим за означенням.
--
-- Тобто ця умова лише не пускає такі рядки в індекс — це розмір і чистота, а
-- не правильність. Записано саме так, бо доводом «умова тримає смугу» ми
-- пояснювали б поведінку не тією причиною, і перший, хто спростить умову,
-- вирішив би, що ламає смугу, — а він її не ламає. Злом №5 у прогоні
-- червоності це підтвердив: сцена лишилась ЗЕЛЕНОЮ, і це правильно.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ознака службового фонду — копією на самій броні, бо EXCLUDE не джойниться.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "is_pool_unit" BOOLEAN NOT NULL DEFAULT FALSE;

-- Бекфіл для вже наявних рядків: без нього обмеження відхилило б другу бронь
-- на pool-юніті, який продавали роками.
UPDATE "reservations" r
   SET "is_pool_unit" = TRUE
  FROM "units" u
 WHERE u."id" = r."unit_id" AND u."is_pool" = TRUE AND r."is_pool_unit" = FALSE;

CREATE OR REPLACE FUNCTION reservations_copy_pool_flag() RETURNS trigger AS $$
BEGIN
  NEW."is_pool_unit" := COALESCE(
    (SELECT u."is_pool" FROM "units" u WHERE u."id" = NEW."unit_id"), FALSE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_pool_flag ON "reservations";
CREATE TRIGGER trg_reservations_pool_flag
  BEFORE INSERT OR UPDATE OF "unit_id" ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION reservations_copy_pool_flag();

-- Ознаку міняють і на самому номері — тоді її треба рознести по бронях, які
-- вже стоять. Інакше номер, який щойно став службовим, і далі забороняв би
-- другу бронь; або навпаки — колишній службовий пускав би дублі.
CREATE OR REPLACE FUNCTION units_spread_pool_flag() RETURNS trigger AS $$
BEGIN
  IF NEW."is_pool" IS DISTINCT FROM OLD."is_pool" THEN
    UPDATE "reservations" SET "is_pool_unit" = COALESCE(NEW."is_pool", FALSE)
     WHERE "unit_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_units_spread_pool_flag ON "units";
CREATE TRIGGER trg_units_spread_pool_flag
  AFTER UPDATE OF "is_pool" ON "units"
  FOR EACH ROW EXECUTE FUNCTION units_spread_pool_flag();

-- Наявність обмеження перевіряється за ОЗНАЧЕННЯМ, а не за іменем (AGENTS §4):
-- `ADD CONSTRAINT IF NOT EXISTS` у Postgres немає, а сторож за іменем на свіжій
-- базі не знайшов би ключа, створеного генератором під СВОЇМ іменем, і додав би
-- другий такий самий.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'reservations'::regclass
       AND pg_get_constraintdef(oid) LIKE 'EXCLUDE USING gist%unit_id%'
  ) THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "no_double_booking"
      EXCLUDE USING gist (
        "unit_id" WITH =,
        daterange("check_in", "check_out") WITH &&
      )
      WHERE ("unit_id" IS NOT NULL
             AND NOT "is_pool_unit"
             AND "status" NOT IN ('cancelled', 'no_show'));
  END IF;
END $$;
