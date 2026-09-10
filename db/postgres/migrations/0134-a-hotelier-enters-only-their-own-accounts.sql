-- Готельєр входить лише у свої рахунки. Перелік членства — і рід входу.
--
-- Рішення власника 10.09.2026 (П21): новий готель — це нова ОРГАНІЗАЦІЯ, а не
-- другий обʼєкт наявної. Звідси й задача: дати готельєру те, що для нас уже
-- працює — вибір, у який готель увійти.
--
-- ── Чому саме тут, а не в новій машинерії ─────────────────────────────────
--
-- `platform_sessions.acting_organization_id` уже тримає рівно один рахунок;
-- поза ним кожен тенантний маршрут відмовляє як чужому; вхід і вихід уже
-- пишуться в аудит РАХУНКУ. П21 називає це прямо: «не нова машинерія, а зняте
-- обмеження з наявної». Бракувало одного — переліку.
--
-- ── Діра, яку ця міграція закриває ────────────────────────────────────────
--
-- `enterOrganization` перевіряла ЛИШЕ що організація існує, а список віддавав
-- УСІ організації сервера. Доти безпечно рівно тому, що платформний вхід мали
-- тільки ми: постачальникові й треба входити в кожен рахунок, який він
-- обслуговує. Віддати той самий вхід готельєру без переліку означало б дати
-- йому доступ до всіх готелів на сервері.
--
-- ── Рід користувача: чому дефолт САМЕ 'hotelier' ──────────────────────────
--
-- Слабший рід за замовчуванням. Рядок, створений без назви роду (скриптом,
-- міграцією, чиєюсь правкою), дістає перелік — тобто НІЧОГО, поки членство не
-- заведено, — а не ключі від сервера. Наявні рядки це наші власні облікові
-- записи підтримки, і вони названі постачальниками ЯВНО, окремим UPDATE нижче:
-- те, що дає доступ до всіх рахунків, пишеться руками, а не успадковується
-- дефолтом (інваріанти 8 і 13).
--
-- ── Чому `app_user_id` NOT NULL ───────────────────────────────────────────
--
-- Членство мусить називати, КИМ людина є в тому рахунку: без рядка `app_users`
-- у неї немає ні ролі, ні прав, ні імені для аудиту — і код мусив би щось
-- підставити. Саме те підставлене й було б вадою: рахунок бачив би в своєму
-- журналі змін «Підтримка ALiSiO» замість власного власника, а права
-- виявились би повними. Членство без відповіді на це питання не існує.
--
-- Перезапускна: другий прогін нічого не знаходить і нічого не робить.

BEGIN;

ALTER TABLE "platform_users"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'hotelier';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"platform_users"'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kind%supplier%hotelier%'
  ) THEN
    ALTER TABLE "platform_users"
      ADD CONSTRAINT "platform_users_kind_check" CHECK (kind IN ('supplier', 'hotelier'));
  END IF;
END $$;

-- Наявні рядки — наші, і вони постачальники. Названо явно, один раз: колонка
-- щойно зʼявилась, тож інших рядків, ніж наші, тут бути не може.
UPDATE "platform_users" SET "kind" = 'supplier' WHERE "created_at" < now();

CREATE TABLE IF NOT EXISTS "platform_memberships" (
  "id" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL REFERENCES "platform_users"("id") ON DELETE CASCADE,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "app_user_id" TEXT NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("platform_user_id", "organization_id")
);

CREATE INDEX IF NOT EXISTS "idx_platform_memberships_user"
  ON "platform_memberships" ("platform_user_id");

COMMIT;
