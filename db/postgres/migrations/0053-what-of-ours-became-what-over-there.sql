-- Дзеркало мапінгу: що з нашого чим стало на тому боці.
--
-- ── Чому дзеркало, а не наш екран мапінгу ─────────────────────────────────
--
-- Сам мапінг робить оператор в iFrame менеджера каналів (рішення §7 ТЗ).
-- Це не лінощі: у кожного OTA своя модель мапінгу — Booking.com мапить на
-- пари «room + rate», Airbnb на лістинги з власною ціновою моделлю, VRBO на
-- лістинги з іншими ідентифікаторами. Один спільний екран на всі канали тут
-- не працює, а чотири екрани — це чотири екрани.
--
-- Спільний рівень — цей: що ми взагалі завели в менеджері каналів і під
-- якими там ідентифікаторами. Він потрібен нам самим, бо бронювання
-- приїжджає з ЧУЖИМ ідентифікатором типу номера, і без дзеркала перекласти
-- його нема чим: бронь ляже без типу, наявність її не побачить, і
-- зіставляти доведеться руками на кожну броню.
--
-- ── Вісь, якої в гіпотезі не було: заселеність ────────────────────────────
--
-- Рядок буває не лише на сутність, а й на ОПЦІЮ ЗАСЕЛЕНОСТІ тарифу. Живий
-- `GET /restrictions` індексований не ідентифікатором тарифу, а
-- ідентифікатором опції (INVENTORY §4.5: три тарифи віддали вісім ключів).
-- Основна опція має той самий id, що й тариф; решта мають власні UUID, які
-- НЕ повертаються ніде, крім `options[]` самого тарифу.
--
-- Тобто без цих рядків прочитати власні ціни назад неможливо: пʼять ключів
-- із восьми не буде з чим зіставити, і екран звірки та сертифікаційний
-- тест 1 упруться саме в це.
--
-- ── Чому `occupancy NOT NULL DEFAULT 0`, а не nullable ────────────────────
--
-- Бо `UNIQUE` не обмежує `NULL` — ні в SQLite, ні в Postgres. На цьому вже
-- обпікся `price_occupancy` у цій самій кодовій базі: дублікат, який індекс
-- мав спинити, був якраз рядком із порожніми колонками. `0` — значення поза
-- доменом заселеності, тобто «не опція, а сама сутність», і воно робить
-- перший `UNIQUE` дієвим для обох родів рядків однаково.
--
-- ── Чому обидва UNIQUE включають connection_id ────────────────────────────
--
-- Зʼєднання належить організації, тож пара «наш id + чужий id» унікальна в
-- межах орендаря, а не глобально (інваріант 3). Два готелі можуть завести
-- типи номерів з однаковими нашими id лише через різні зʼєднання, і жоден із
-- них не має заважати іншому.
--
-- Імені вендора тут немає: `provider` живе в `cm_connections`, а ця таблиця
-- каже лише «наше ↔ їхнє» (інваріант И1).

CREATE TABLE IF NOT EXISTS cm_mappings (
  id              TEXT DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
  organization_id TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  local_id        TEXT NOT NULL,
  -- 0 = сама сутність, не опція заселеності.
  occupancy       INTEGER DEFAULT 0 NOT NULL,
  remote_id       TEXT NOT NULL,
  synced_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (connection_id, entity_type, local_id, occupancy),
  UNIQUE (connection_id, entity_type, remote_id),
  CHECK (entity_type IN ('property', 'unit_type', 'rate_plan', 'rate_plan_option')),
  CHECK (occupancy >= 0)
);

-- Зовнішні ключі окремо: `ADD CONSTRAINT IF NOT EXISTS` у Postgres немає,
-- тож повторний накат ловиться через каталог.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cm_mappings_organization_id_1') THEN
    ALTER TABLE cm_mappings ADD CONSTRAINT fk_cm_mappings_organization_id_1
      FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cm_mappings_connection_id_2') THEN
    ALTER TABLE cm_mappings ADD CONSTRAINT fk_cm_mappings_connection_id_2
      FOREIGN KEY (connection_id) REFERENCES cm_connections (id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cm_mappings_org ON cm_mappings (organization_id);
-- Головний запит: «переклади чужий id у наш» на кожній вхідній броні.
CREATE INDEX IF NOT EXISTS idx_cm_mappings_lookup
  ON cm_mappings (connection_id, entity_type, remote_id);

ALTER TABLE cm_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_mappings_tenant ON cm_mappings;
CREATE POLICY cm_mappings_tenant ON cm_mappings
  USING (organization_id = current_setting('app.organization_id'))
  WITH CHECK (organization_id = current_setting('app.organization_id'));
