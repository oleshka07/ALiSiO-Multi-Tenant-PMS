-- 0413: чотири слова обʼєкта, за якими живе термінал.
--
-- Блок «Кіоск», частина В (§3.3): картка застосунку дає готелю політики, а не
-- лише вимикач. Три з них — правила, четверте — година.
--
-- ── `kiosk_auto_assign`: чи вільно терміналу обирати кімнату ────────────
--
-- `assignUnit` бере вільний чистий номер потрібного типу сам. Готелю, який
-- розподіляє номери руками (вид із вікна, поверх, постійний гість), це не
-- підходить: там кімнату називає рецепція ввечері, а термінал має лише
-- видати ключ від уже призначеної. `FALSE` означає «номера немає — по
-- рецепцію», а не «візьми будь-який».
--
-- Дефолт `TRUE` — бо це поведінка, з якою кіоск має сенс: без
-- автопризначення половина гостей упреться в порожній екран.
--
-- ── `kiosk_signature`: чий підпис і коли ────────────────────────────────
--
-- КІ3: підписують іноземці, громадяни країни обʼєкта — ні. Це ПРАВИЛО
-- юрисдикції, і дефолт `foreigners` його й означає. Але юрисдикція буває
-- інша: готель поза BMG-контуром не збирає Meldeschein узагалі (`never`), а
-- готель, який хоче підпис від кожного (внутрішнє правило, не закон), — `always`.
--
-- Свідомо НЕ прапорець: `TRUE/FALSE` не вміє сказати «за законом», і третій
-- стан довелося б вигадувати наступною міграцією.
--
-- ── Години: `kiosk_earliest_checkin`, `kiosk_latest_checkout` ───────────
--
-- Термінал працює цілодобово, а готель — ні. Гість, який приїхав о 6:00 на
-- заїзд о 15:00, має почути «кімната буде о 15:00», а не отримати ключ від
-- кімнати, у якій ще спить попередній.
--
-- NULL означає «як в обʼєкта» (`check_in_time` / `check_out_time`), а не
-- «будь-коли»: окреме поле тут потрібне саме тому, що на терміналі година
-- буває інша, ніж на стійці — рецепція може поселити раніше, подивившись у
-- журнал, а екран у холі дивитись нікуди.
--
-- SQLite-дзеркало — `src/lib/db.ts` (CREATE properties + ALTER).
-- Перезапускна: другий прогін нічого не змінює.

BEGIN;

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "kiosk_auto_assign" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "kiosk_signature" TEXT NOT NULL DEFAULT 'foreigners';
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "kiosk_earliest_checkin" TEXT;
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "kiosk_latest_checkout" TEXT;

-- Обмеження за ОЗНАЧЕННЯМ, не за іменем (0052, AGENTS §4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"properties"'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kiosk_signature%foreigners%'
  ) THEN
    ALTER TABLE "properties"
      ADD CONSTRAINT "properties_kiosk_signature_check"
      CHECK (kiosk_signature IN ('foreigners', 'always', 'never'));
  END IF;
END $$;

COMMIT;
