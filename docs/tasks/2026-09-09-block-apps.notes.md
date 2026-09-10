# Блок «Застосунки» — знахідки поза обсягом (сесія 4)

Не виправлено в цьому блоці: або чужа тека, або не про застосунки. Номери
`INC-` роздає сесія 1 при злитті (docs/tasks/README.md).

1. **Екран «Канали» відкритий при вимкненому модулі `channels`.**
   `src/core/navigation.ts:71` — рядок `{ label: 'Канали', href:
   '/app/settings/channel-manager', … }` без `feature: 'channels'`. Варта
   модуля стоїть у кроні (`pull-cron.handlers.ts`), не на екрані й не в
   `ModuleGate`. Знайшов гейт `apps.check.ts` тв. 2 («модуль ⇒ розділ у
   каталозі»); у гейті — названий виняток `MODULE_WITHOUT_SECTION`, який
   сам зажадає себе прибрати, щойно ключ зʼявиться. Правка — один рядок, але
   `navigation.ts` у цьому блоці лише про «Застосунки», а екран каналів — тека
   сесії 3. Чи ХОЧЕ власник ховати екран підключення від готелю без модуля
   (там можна показати «підключіть канали») — питання продукту, контролеру.

2. **Ключ менеджера каналів (`channel_manager`) не вводиться ніде в UI.**
   grep по `src/app`, `src/modules/channels/ui`, `src/components` — нуль
   згадок. Старий екран «Модулі та інтеграції» показував поля за ключем
   реєстру (`fields[channels]`) у мапі, ключованій каналом
   (`channel_manager`) — тобто не показував. Після поділу екранів
   `INTEGRATION_FIELDS.channel_manager` лишився в API, але картки для нього
   немає (не застосунок, З4). Місце йому — екран `/app/settings/channel-manager`
   (сесія 3): одне поле «API key» через той самий
   `PUT /api/settings/integration-credentials`.

3. **`fin_fiscal_settings` має `UNIQUE("property_id")` двічі** у
   `db/postgres/schema.sql` (у `CREATE TABLE` і як `idx_fin_fiscal_settings_row`).
   Слід дрейфу генератора; тека сесії 1.

4. **`scripts/provision-org.mjs` друкує «Вмикати — Налаштування → Модулі та
   інтеграції»** — екран перейменовано на «Модулі», а інтеграції тепер на
   «Застосунки». Один рядок тексту; скрипт не в моєму переліку.

5. **`fin_fiscal_settings.organization_id` — NULLable** (`schema.sql`), хоча
   таблиця тенантна з політикою. Рядок із NULL там невидимий кожному
   орендарю; писача, який кладе NULL, не знайшов, але колонку варто зробити
   `NOT NULL` міграцією сесії 1 (той самий клас, що зауваження
   `pg-schema.mjs` про `cart_events`, `finance_security`).

6. **Проба fiskaly («Перевірити звʼязок») не зроблена**: клієнт живе в
   `modules/invoicing/data/fiskaly-sign-de.ts`, а фасад `@invoicing` дверей до
   нього не має; імпорт із `app/api` — пробій межі (`check-boundaries`).
   Потрібна зміна в чужій теці: `src/modules/invoicing/api/index.ts` — один
   експорт (`fiskalyDevice` або окрема `fiskalyProbe`), після чого проба —
   двадцять рядків у `api/settings/apps/_handlers.ts`, а стеля `invoicing` у
   `check-boundaries.mjs` повертається з 5 на 3 (другий рядок — 3.8, `fiskalyConnect`).

7. **Перший живий виклик `fiskalyConnect` ключем TEST** — чекпоінт для того,
   хто матиме акаунт fiskaly (З18, інваріант 28): подивитись на тіла
   `PUT /tss` (`admin_puk`) і `PUT /client` очима, зберегти зразки як у
   `docs/vendor/channex/live/`.

8. **Фасад `@invoicing` не завантажується голим node.**
   `src/modules/invoicing/domain/invoice-pdf.ts:23` — `path.join(__dirname, …)`
   у масиві кандидатів шрифту виконується на завантаженні модуля, а в ESM
   `__dirname` немає: `ReferenceError` ще до першого запиту. У бандлі Next є
   поліфіл, тому застосунок цього не бачить; бачить будь-яка перевірка, яка
   імпортує `@invoicing` (жодна досі не імпортувала). Гейт блоку підставляє
   `globalThis.__dirname` перед імпортом (З21). Правка — один рядок:
   `path.dirname(fileURLToPath(import.meta.url))`; тека сесії 1.
