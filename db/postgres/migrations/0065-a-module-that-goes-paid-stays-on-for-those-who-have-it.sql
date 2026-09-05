-- Дефолти модулів за П15 (MASTER-PLAN §3, 05.09.2026): `tasks`, `reports`,
-- `day_sheets` переходять в OFF (платно), нові ключі `guest_page` і `sites`
-- народжуються OFF.
--
-- Рядок сильніший за дефолт (src/core/features.ts, hasFeature). Без цього
-- кроку кожен наявний готель у день зміни дефолту мовчки втратив би задачі,
-- аналітику й аркуші дня — рядків же в нього немає. Тому явний `enabled =
-- TRUE` кожній організації, яка існує на день міграції, на всі пʼять ключів:
-- наявні бачать усе, що бачили (гостьову сторінку й сайти вони мали без
-- ключа), нові отримують OFF за дефолтом і докуповують.
--
-- `ON CONFLICT DO NOTHING`: хто вже має рядок (вимкнув свідомо), лишається з
-- ним. Повторно накочується без наслідків. Зразок — 0045, 0049.

INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
SELECT o.id, f.feature, TRUE, now()
  FROM organizations o
  CROSS JOIN (VALUES ('tasks'), ('reports'), ('day_sheets'), ('guest_page'), ('sites')) AS f(feature)
ON CONFLICT (organization_id, feature) DO NOTHING;
