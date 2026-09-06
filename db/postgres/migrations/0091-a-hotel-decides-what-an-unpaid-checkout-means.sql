-- Що робить виселення з несплаченим залишком — вирішує обʼєкт.
--
-- Блок 4 «День готелю» §2.1 (docs/tasks/2026-09-06-block-4-hotel-day.md);
-- джерело форми — Hoteliera, General settings: «перевірка балансу при
-- виїзді». Досі `checked_out` не мав жодної варти: бронь із боргом
-- виселялась мовчки, і борг лишався в номері, якого вже ніхто не відкриє.
--
-- Три значення, і жодне з них не дефолт коду:
--
--   none      виселення не дивиться на баланс (апартаменти з передплатою);
--   warning   проходить, але відповідь несе прапорець `unpaid_balance` —
--             рецепція бачить суму на екрані. ДЕФОЛТ: попередження не зупиняє
--             сімʼю з валізами о сьомій ранку і не мовчить;
--   blocking  422 із назвою причини — готель, у якого борг на виїзді це
--             помилка процесу, а не звичайний випадок.
--
-- Баланс рахує `bookings/domain/checkout-balance.ts` з фоліо броні (нараховане
-- мінус оплачене) або, коли фоліо ще немає, зі статусу оплати самої броні.
-- Обидві осі — політика × борг — тримає `checkout-balance.check.ts`.
--
-- CHECK за зразком 0067: на SQLite його не додати до наявної таблиці, тож
-- у свіжій базі він у CREATE, а тут — окремим кроком, якщо ще немає. Писач
-- (`properties.repo`) звіряє значення сам, до бази.
--
-- SQLite-дзеркало — `src/lib/db.ts`: колонка в CREATE properties і в ALTER
-- у кінці runMigrations.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS checkout_balance_policy TEXT DEFAULT 'warning' NOT NULL;

UPDATE properties SET checkout_balance_policy = 'warning'
 WHERE checkout_balance_policy IS NULL
    OR checkout_balance_policy NOT IN ('none', 'warning', 'blocking');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'properties'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%checkout_balance_policy%'
  ) THEN
    ALTER TABLE properties ADD CONSTRAINT properties_checkout_balance_policy_check
      CHECK (checkout_balance_policy IN ('none', 'warning', 'blocking'));
  END IF;
END $$;
