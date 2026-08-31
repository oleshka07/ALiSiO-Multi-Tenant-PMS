-- Перейменування фічі `widget` у `booking_engine` з новим дефолтом, і `events` у OFF.
--
-- Рішення власника — продавати конструктор сайту окремим ключем `site_builder`
-- — чинне, але сюди не входить: конструктора в коді ще немає, і прапорець,
-- який нічого не стереже, це перемикач-обманка в налаштуваннях. Він прийде
-- разом зі своєю вартою (див. коментар у src/core/features.ts).
--
-- Чому не перейменування. У organization_features рядок сильніший за дефолт
-- (src/core/features.ts, hasFeature). Готель із явним рядком `widget`
-- лишився б без рядка на новий ключ і поїхав би на дефолт. Тому копіюємо
-- значення, і лише потім видаляємо старий рядок.
--
-- `enabled = FALSE` копіюється так само: хто вимкнув віджет свідомо, не має
-- отримати його назад через новий дефолт `booking_engine: ON`.

INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
SELECT organization_id, 'booking_engine', enabled, now()
  FROM organization_features WHERE feature = 'widget'
ON CONFLICT (organization_id, feature) DO NOTHING;

DELETE FROM organization_features WHERE feature = 'widget';

-- `events` ON → OFF. Без цього рядка кожен наявний готель мовчки втратив би
-- розділ «Зали» в день зміни дефолту.
INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
SELECT id, 'events', TRUE, now() FROM organizations
ON CONFLICT (organization_id, feature) DO NOTHING;
