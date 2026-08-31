-- Розкол фічі `widget` на `booking_engine` + `site_builder`, і `events` у OFF.
--
-- Чому не перейменування. У organization_features рядок сильніший за дефолт
-- (src/core/features.ts, hasFeature). Готель із явним рядком `widget`
-- лишився б із нулем рядків на обидва нові ключі й поїхав би на дефолти —
-- тобто той, хто `widget` КУПИВ, тихо втратив би конструктор сайту, бо
-- `site_builder` за замовчуванням вимкнений. Тому копіюємо в обидва ключі
-- зі збереженням значення, і лише потім видаляємо старий рядок.
--
-- `enabled = FALSE` копіюється так само: хто вимкнув віджет свідомо, не має
-- отримати його назад через новий дефолт `booking_engine: ON`.

INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
SELECT organization_id, 'booking_engine', enabled, now()
  FROM organization_features WHERE feature = 'widget'
ON CONFLICT (organization_id, feature) DO NOTHING;

INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
SELECT organization_id, 'site_builder', enabled, now()
  FROM organization_features WHERE feature = 'widget'
ON CONFLICT (organization_id, feature) DO NOTHING;

DELETE FROM organization_features WHERE feature = 'widget';

-- `events` ON → OFF. Без цього рядка кожен наявний готель мовчки втратив би
-- розділ «Зали» в день зміни дефолту.
INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
SELECT id, 'events', TRUE, now() FROM organizations
ON CONFLICT (organization_id, feature) DO NOTHING;
