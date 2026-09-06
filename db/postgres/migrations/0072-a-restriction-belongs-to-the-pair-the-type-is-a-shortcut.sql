-- Обмеження на ТАРИФІ (Ц32 переглянуто власником 07.09.2026; задача
-- docs/tasks/2026-09-07-restrictions-per-rate-plan.md).
--
-- Тести 5, 7, 8 сертифікації Channex ставлять РІЗНІ обмеження на різні тарифи
-- одного типу; Hoteliera тримає min/max stay на тарифі, Channex — на тарифі за
-- означенням. Рядок `price_calendar` з `rate_plan_id` (пара) тепер може нести
-- обмеження: ефективне обмеження пари = значення на рядку пари, якщо воно
-- задане (NOT NULL), інакше базовий рядок типу. «Закрито» — тип АБО пара:
-- пара може бути закрита при відкритому типі; тип закритий → усі пари закриті.
--
-- Тому колонки обмежень стають nullable і без дефолту: NULL на парі означає
-- «як у типу», і дефолт колонки поставив би на новий рядок пари ВЛАСНЕ
-- значення, якого ніхто не називав. Базовий рядок писачі й далі заповнюють
-- явно (мінімум 1, прапорці 0).
--
-- Один раз, і лише тоді, коли колонки ще NOT NULL (тобто до цієї міграції):
-- рядки пар несуть у цих колонках дефолти таблиці (рядок тарифу «лише ціну»
-- вставлявся без них), їх ніхто не читав (Блок 0.6 A1) і вони НЕ є значеннями
-- готелю — обнуляються. Повторний накат (`schema_migrations` веде журнал,
-- але міграції тут написані як повторювані) власних значень пар не чіпає.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'price_calendar' AND column_name = 'min_stay' AND is_nullable = 'NO') THEN
    ALTER TABLE price_calendar ALTER COLUMN min_stay DROP NOT NULL;
    ALTER TABLE price_calendar ALTER COLUMN min_stay DROP DEFAULT;
    ALTER TABLE price_calendar ALTER COLUMN closed DROP NOT NULL;
    ALTER TABLE price_calendar ALTER COLUMN closed DROP DEFAULT;
    ALTER TABLE price_calendar ALTER COLUMN cta DROP NOT NULL;
    ALTER TABLE price_calendar ALTER COLUMN cta DROP DEFAULT;
    ALTER TABLE price_calendar ALTER COLUMN ctd DROP NOT NULL;
    ALTER TABLE price_calendar ALTER COLUMN ctd DROP DEFAULT;
    UPDATE price_calendar
       SET min_stay = NULL, max_stay = NULL, closed = NULL, cta = NULL, ctd = NULL
     WHERE rate_plan_id IS NOT NULL;
  END IF;
END $$;

-- Базовий рядок без значення (його не мало бути) дістає дефолти — читачі не гадають.
UPDATE price_calendar
   SET min_stay = COALESCE(min_stay, 1), closed = COALESCE(closed, 0), cta = COALESCE(cta, 0), ctd = COALESCE(ctd, 0)
 WHERE rate_plan_id IS NULL
   AND (min_stay IS NULL OR closed IS NULL OR cta IS NULL OR ctd IS NULL);
