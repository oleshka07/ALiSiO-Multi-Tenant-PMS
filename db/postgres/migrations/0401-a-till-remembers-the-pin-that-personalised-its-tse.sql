-- 0401: PIN і PUK адміністратора TSE — на рядку обʼєкта, під seal().
--
-- Блок «Застосунки» 3.8. Картка fiskaly вміє ПІДКЛЮЧИТИ TSE (quickstart,
-- кроки 2–3), а не лише прийняти ключі: до цього `fin_fiscal_settings` не
-- писав ніхто в продукті, і картка з полями ключів без способу отримати TSS
-- була б перемикачем-обманкою (П5). Підключення повертає `admin_puk` (від
-- fiskaly) і `admin_pin` (наш, випадковий) — це секрети, потрібні для
-- наступних адміністративних дій із TSS (вимкнення, зміна клієнта).
--
-- Куди їх класти. `channel_credentials` має рівно три колонки, і дві з них у
-- fiskaly зайняті ключами API (З17); а PIN/PUK — атрибут TSS, тобто ОБʼЄКТА,
-- не організації (закон З11). Тому — на рядку `fin_fiscal_settings`, у тому
-- самому вигляді, що й секрети `channel_credentials`: `enc1:` + AES-256-GCM
-- через `seal()` з `core/integration-credentials.ts`. Відкритим текстом ці
-- колонки не пишуться ніколи — писач відмовляє без APP_SECRET_KEY.
--
-- Наявних даних не чіпає: у рядках без підключення — NULL.
-- SQLite-дзеркало — `src/lib/db.ts`, `migrateApps()`.

ALTER TABLE fin_fiscal_settings ADD COLUMN IF NOT EXISTS tse_admin_pin TEXT;
ALTER TABLE fin_fiscal_settings ADD COLUMN IF NOT EXISTS tse_admin_puk TEXT;
