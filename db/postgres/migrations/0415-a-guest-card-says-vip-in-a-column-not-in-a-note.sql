-- Картка гостя: звернення, по-батькові, авто, VIP і чорний список.
--
-- ── Чому VIP став колонкою ──────────────────────────────────────────────
--
-- Екран гостей виводив корону з підрядка в примітках: гість із приміткою
-- «VIP-паркінг НЕ входить» її отримував, а справжній VIP, у чиїй примітці
-- цього слова немає, — ні. Ознака, виведена з вільного тексту, не є ознакою:
-- вона залежить від того, як портьє сформулював речення.
--
-- ── Чому чорний список — ТРИ колонки ────────────────────────────────────
--
-- Прапорець без причини й автора — це відмова живій людині, яку наступна
-- зміна не може ні пояснити гостеві, ні оскаржити перед власником. Ознакою
-- є наявність blacklisted_at; три колонки їздять разом, і писач це тримає.
--
-- Окремої таблиці історії блокувань свідомо немає: питання готелю — «чи
-- заблокований ЗАРАЗ і чому», а не «скільки разів блокували». Заводити її
-- варто тоді, коли хтось справді спитає друге.
--
-- ── Чому звернення без CHECK ────────────────────────────────────────────
--
-- Набір звертань різний у кожній мові (Herr/Frau, Pan/Paní, пан/пані), і
-- закритий словник у ЯДРІ закодував би одну юрисдикцію (інваріант 22).
ALTER TABLE guests ADD COLUMN IF NOT EXISTS salutation TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS vehicle_plate TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS blacklisted_by TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;

-- Частковий: заблокованих одиниці на тисячі рядків, і саме їх питає екран.
CREATE INDEX IF NOT EXISTS idx_guests_blacklisted
  ON guests (organization_id) WHERE blacklisted_at IS NOT NULL;

-- `guests` уже під RLS від 0005 — нових політик не треба, і саме тому тут їх
-- немає: колонки не міняють, кому видно рядок (check-migration-rls).
