-- Шаблони ваучерів переїжджають із коду в базу.
--
-- ── Що було ───────────────────────────────────────────────────────────────
--
-- `GIFT_CARD_TEMPLATES` у `src/modules/widget/domain/gift-card-builder.ts` —
-- шість шаблонів із цінами (4900 і 8500 Kč, 580, 220, 190 і 95 €) та
-- продуктами одного кемпінгу: глемпінг, фінська сауна, карпатський чан,
-- будиночок на двох. Константа в коді платформи, тобто СПІЛЬНА: екран
-- «Пропозиції» показував ці шість карток кожному готелю на сервері, і будь-хто
-- міг видати ваучер «АКЦІЯ 1+1+1» за 220 € з чужого прайса.
--
-- Це дефект ізоляції, а не косметика: дані одного орендаря, доступні всім.
--
-- ── Чому це безпечно перенести ────────────────────────────────────────────
--
-- Уже ВИДАНІ ваучери самодостатні. `POST /api/gift-cards` копіює в рядок
-- `gift_cards` усе, що взяв із шаблону — `name`, `type`, `value_type`,
-- `face_value`, `currency`, `config_json`, — тож ваучер на руках у гостя не
-- залежить від того, чи існує шаблон. Шаблон потрібен лише щоб ВИДАТИ новий.
--
-- Отже перенесення нічого не ламає в жодного клієнта, а тому, хто цими
-- шаблонами користується, вони лишаються на місці — вже як його власні рядки,
-- які він може змінити чи видалити.
--
-- ── Кому саме вони дістаються ─────────────────────────────────────────────
--
-- НЕ за назвою готелю. Ім'я клієнта в міграції — це той самий хардкод, лише
-- в SQL; наступний аудит знайшов би його тут. Тому адресат визначається
-- ДАНИМИ: рядки отримують ті організації, які цими шаблонами вже
-- користувались — тобто мають хоч один виданий ваучер із таким `template_id`.
--
-- Готель, який жодного такого ваучера не видавав, не отримує нічого. Порожній
-- список шаблонів — правильний стан для нового клієнта: він заведе свої.
--
-- Хто скористався ХОЧ ОДНИМ — отримує всі шість, а не лише продані. Шаблон це
-- пропозиція на вітрині, і продажів у неї могло ще не бути: перенести тільки
-- те, за чим уже видали ваучер, означало б тихо зняти з продажу решту. Готель
-- сам вирішить, що лишити — тепер це його рядки.

CREATE TABLE IF NOT EXISTS "gift_card_templates" (
  "id"              TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT NOT NULL,
  -- Ключ, яким шаблон називають екрани й `gift_cards.template_id`.
  -- Унікальний У МЕЖАХ організації — інваріант 3: UNIQUE на значенні, яке
  -- обирає людина, включає організацію.
  "template_key"    TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "description"     TEXT NOT NULL DEFAULT '',
  "type"            TEXT NOT NULL DEFAULT 'open_date',
  "value_type"      TEXT NOT NULL DEFAULT 'fixed_czk',
  "face_value"      NUMERIC(14,2) NOT NULL DEFAULT 0,
  "currency"        TEXT NOT NULL,
  "config_json"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "emoji"           TEXT NOT NULL DEFAULT '🎁',
  "badge"           TEXT NOT NULL DEFAULT '',
  "validity_months" BIGINT NOT NULL DEFAULT 12,
  "sort_order"      BIGINT NOT NULL DEFAULT 0,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("organization_id", "template_key")
);

CREATE INDEX IF NOT EXISTS "idx_gift_card_templates_org"
  ON "gift_card_templates" ("organization_id");

ALTER TABLE "gift_card_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gift_card_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gift_card_templates_tenant" ON "gift_card_templates";
CREATE POLICY "gift_card_templates_tenant" ON "gift_card_templates"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));

-- ── Перенесення ───────────────────────────────────────────────────────────
--
-- `ON CONFLICT DO NOTHING`: перезапускна, і не затирає змін, які готель уже
-- зробив своєму шаблону.
INSERT INTO "gift_card_templates"
  ("organization_id", "template_key", "name", "description", "type", "value_type",
   "face_value", "currency", "config_json", "emoji", "badge", "validity_months", "sort_order")
SELECT o.organization_id, t.template_key, t.name, t.description, t.type, t.value_type,
       t.face_value, t.currency, t.config_json, t.emoji, t.badge, t.validity_months, t.sort_order
FROM (
  SELECT DISTINCT "organization_id"
    FROM "gift_cards"
   WHERE "template_id" IN ('forest_weekend_gift', 'couple_vip', 'workcation',
                           'birthday_nature', 'one_plus_one_plus_one', 'solo_escape')
) o
CROSS JOIN (VALUES
  ('forest_weekend_gift',
   'ПОДАРУЙ ВІКЕНД В ЛІСІ',
   'Ваучер на будиночок з відкритою датою — ідеально на подарунок. Гість сам обирає зручний час.',
   'open_date', 'fixed_czk', 4900::numeric, 'CZK',
   '{"unit_type":"tiny","nights":2,"max_guests":2,"days_any":true}'::jsonb,
   '🌲', '~4 900 CZK', 12::bigint, 1::bigint),
  ('couple_vip',
   'БУДИНОЧОК ДЛЯ ДВОХ',
   'VIP ваучер — Романтичний вікенд у лісі: 2 ночі + сесія сауни + чан + сніданки.',
   'package', 'fixed_czk', 8500::numeric, 'CZK',
   '{"unit_type":"tiny","nights":2,"max_guests":2,"includes":["sauna_1session","chan_1session","breakfast_2days"],"price_czk":8500}'::jsonb,
   '💑', '8 500 CZK', 12::bigint, 2::bigint),
  ('workcation',
   'ЛІСОВИЙ WORKCATION',
   '5 ночей (Нд–Пт) за ціною 4 + 50% знижка на всі сесії сауни. Ідеально для фокусу та продуктивності.',
   'package', 'fixed_eur', 580::numeric, 'EUR',
   '{"unit_type":"tiny","nights_paid":4,"nights_total":5,"days_allowed":["Sun","Mon","Tue","Wed","Thu"],"sauna_discount_percent":50,"original_price_eur":725,"discount_eur":145}'::jsonb,
   '💻', '580 EUR', 12::bigint, 3::bigint),
  ('birthday_nature',
   'ДЕНЬ НАРОДЖЕННЯ НА ПРИРОДІ',
   'Бронюй будиночок у місяць свого ДН — отримуй сесію сауни безкоштовно + 50% знижку на решту сесій.',
   'discount', 'fixed_eur', 190::numeric, 'EUR',
   '{"condition":"birthday_month","max_nights":2,"sauna_included_sessions":1,"sauna_discount_percent":50}'::jsonb,
   '🎂', '~€190 / 2 ночі', 12::bigint, 4::bigint),
  ('one_plus_one_plus_one',
   'АКЦІЯ 1+1+1',
   'Заброньовуй ніч у глемпінгу — друга ніч за 50% + безкоштовна сауна + 50% знижка на решту сесій. Нд–Чт.',
   'discount', 'fixed_eur', 220::numeric, 'EUR',
   '{"days_allowed":["Sun","Mon","Tue","Wed","Thu"],"second_night_discount_percent":50,"sauna_included_sessions":1,"sauna_discount_percent":50}'::jsonb,
   '🎯', '~€220 / 2 ночі', 6::bigint, 5::bigint),
  ('solo_escape',
   'СОЛО-ВТЕЧА В ЛІС',
   'Будиночок для одного. Час виключно для себе. Спеціальний тариф з неділі по четвер.',
   'discount', 'fixed_eur', 95::numeric, 'EUR',
   '{"days_allowed":["Sun","Mon","Tue","Wed","Thu"],"max_guests":1,"price_eur_per_night":95}'::jsonb,
   '🧘', '~€95/ніч', 12::bigint, 6::bigint)
) AS t(template_key, name, description, type, value_type, face_value, currency,
       config_json, emoji, badge, validity_months, sort_order)
ON CONFLICT ("organization_id", "template_key") DO NOTHING;
