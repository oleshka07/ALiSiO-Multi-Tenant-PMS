-- Фактура в кожного готеля своя.
--
-- Досі це були константи в коді `invoice-rules.ts`:
--
--   INVOICE_DUE_DAYS = 14
--   BUYER_NAME_THRESHOLD_CZK = 9900
--
-- Перша — просто чуже рішення, нав'язане всім. Друга гірша: 9900 Kč це межа
-- чеського «zjednodušený daňový doklad», тобто норма ОДНІЄЇ юрисдикції; а
-- оскільки поріг у кронах, готель, який рахує в євро, порівнював суму в євро
-- з числом у кронах. Для нього поріг спрацьовував приблизно вчетверо раніше,
-- ніж мав би — тобто на документах зʼявлялось імʼя покупця там, де закон
-- цього не вимагає, і не зʼявлялось там, де вимагає.
--
-- ── Один рядок на готель, і його може не бути ─────────────────────────────
--
-- Порожня таблиця означає «всі на дефолтах», і це робочий стан: готель, який
-- нічого не налаштовував, отримує ті самі 14 днів, що й раніше. Рядок
-- зʼявляється, коли хтось уперше щось змінив.
--
-- `buyer_name_threshold` NULL = імʼя покупця друкується ЗАВЖДИ. Це безпечний
-- дефолт для юрисдикції, правил якої ми не знаємо: зайве імʼя на документі —
-- незручність, відсутнє — порушення.
CREATE TABLE IF NOT EXISTS "organization_invoicing" (
  "organization_id" TEXT PRIMARY KEY
    REFERENCES "organizations" ("id") ON DELETE CASCADE,
  -- Скільки днів на оплату. Те саме число йде і в строк, і в дату
  -- оподаткованої операції (DUZP) — так було в коді, так лишається.
  "due_days" BIGINT NOT NULL DEFAULT 14,
  -- Поріг, нижче якого покупця можна не називати, У ВАЛЮТІ ГОТЕЛЮ.
  -- NULL = називати завжди.
  "buyer_name_threshold" NUMERIC(14,2),
  -- Вигляд бланка.
  "logo_url" TEXT,
  "accent_color" TEXT,
  "footer_note" TEXT,
  "show_payment_qr" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE r text;
BEGIN
  EXECUTE 'ALTER TABLE organization_invoicing ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')';
  EXECUTE 'ALTER TABLE organization_invoicing ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE organization_invoicing FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS organization_invoicing_tenant ON organization_invoicing';
  EXECUTE 'CREATE POLICY organization_invoicing_tenant ON organization_invoicing
    USING ("organization_id" = current_setting(''app.organization_id''))
    WITH CHECK ("organization_id" = current_setting(''app.organization_id''))';

  -- Права застосунку: без цього циклу таблиця є, політика на місці, і жоден
  -- запит не проходить. Ролі беруться з `reservations` — хто читає броні,
  -- той і є застосунок.
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON organization_invoicing TO %I', r);
  END LOOP;
END $$;
