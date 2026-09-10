TASK: 3

# Сесія 4 (застосунки) — задача 3 (= задача 2, яку ти не бачила, + рецензія 2)

Гілка та сама: `claude/block-apps`, від голови `19e7ccb2`. §3.8 ти вже зробила за задачею 1 —
прийнято (`docs/tasks/2026-09-09-review-apps-2.md`). Розділ А нижче — виконаний, лишається Б і В. Не пушити в гілку робіт і в
`main`. Протокол — `docs/tasks/AUTOLOOP.md` (злиття, не перебазування; історію не
переписувати; пушити свою гілку щойно зелено; задача — БЛОК). **Твій inbox — на гілці
`origin/claude/controller-2`**, не на гілці робіт; команда очікування наприкінці.

Рецензії 1 і 2 — `docs/tasks/2026-09-09-review-apps-{1,2}.md` на `origin/claude/controller-2`:
блок прийнято по суті; злиття після `beta → main` (З5). Один блок, без зупинок між пунктами.

## А. §3.8 — ЗРОБЛЕНО (`8b0e7dbe`), лишаються два зауваження рецензії 2

А1. **Сирітська TSS при частковій відмові:** `PUT /tss` пройшов, наступний крок упав —
TSS у fiskaly існує і коштує, у нас нічого, наступний натиск створить другу. Мінімум —
`tssId` у тексті `reportError`; краще — при повторному натиску догравати кроки на тій
самій TSS (за `tssId` з `last_error` або з рядка «підключається»), а не створювати нову.
Гейт: відмова на `PATCH /admin` → `last_error` містить `tssId`; другий натиск — без
другого `PUT /tss`.
А2. **Два одночасні натиски** → дві TSS (`existing?.tss_id` читається до вендора). Замок:
перед вендором рядок `fin_fiscal_settings` зі станом «підключається», другий запит бачить
його → 409; після успіху — справжній `tss_id`, після відмови — NULL (або лишити `tssId`
для А1). Гейт: два паралельні виклики → один `PUT /tss`.

## А0. Що було в §3.8 (для довідки; зроблено)

Пункт §3.8 у `docs/tasks/2026-09-09-block-apps.md` приїхав до тебе комітом `44c5a222`
після відгалуження і був злитий останнім (`3070d15e`) — його ще ніхто не читав. Прочитай
§3.8 цілком і зроби як там: `POST /api/settings/apps/fiskaly/connect { propertyId }` →
`PUT /tss/{uuid}` → `PATCH /tss/{id}/admin` (PUK → новий PIN) → `POST /tss/{id}/admin/auth`
→ `PATCH /tss/{id} {state:'INITIALIZED'}` → `PUT /tss/{id}/client/{uuid} {serial_number}`
→ запис `fin_fiscal_settings(property_id, tss_id, tse_client_id, recording_system_serial)`
для обʼєкта; серійник `ALISIO-<slug обʼєкта>`; PIN/PUK — лише через `seal()` (де саме —
твоє рішення, у DECISIONS; якщо нові колонки — міграція `0141`); ідемпотентно: обʼєкт
із заповненим `tss_id` → 409 із назвою, другої TSS не буває; `reportOk`/`reportError` у
`app_connections`; стан картки після успіху «підключено · TSS …last4». Дефолт
`FISKALY_BASE_URL` → `https://kassensichv-middleware.fiskaly.com/api/v2`; на екрані біля
ключів — що TEST-ключ не підписує по-справжньому. Гейт 12 (§5 задачі) — червоним ДО коду:
фікстура з підставленим fetch, що віддає автентичні тіла quickstart, осі: свіжий обʼєкт /
обʼєкт із `tss_id` (409) / відмова вендора з текстом на кожному з пʼяти кроків (жоден
частковий стан не лягає в `fin_fiscal_settings`). Приймання §6 — крок «Підключити TSE»
проти підставленого сервера (без живого ключа).

Клієнт TSE живе в `src/modules/invoicing/data/fiskaly-sign-de.ts` — там дозволено (§3.8)
дописати функцію підключення поруч із `signReceipt`; решта `invoicing/**` — не твоя, крім
одного рядка фасаду з п. Б1.

## Б. Правки з рецензії 1

1. **Стеля `invoicing` у `scripts/check-boundaries.mjs` назад на 3** (зараз 5), коментарі
   «3 → 4» і «4 → 5» прибрати. Двері: **дозволено один рядок** у `src/modules/invoicing/api/index.ts` —
   `export { fiskalyDevice, fiskalyProbe, fiskalyConnect } from '../data/fiskaly-sign-de';`
   (імена — твої). `_handlers.ts` і `apps.check.ts` імпортують `@invoicing`, не `data/`.
2. **`reported()` не приписує вендору нашу відмову.** Перевірка «чек без розбиття ПДВ»
   виконується ДО `reported(...)`, або звітується лише те, що впало на `call()`. Гейт:
   чек без розбиття → рядок fiskaly в `app_connections` не змінюється. Заодно імпорти в
   `fiskaly-sign-de.ts` — `@core/…`, як у 10 сусідніх файлів `data/`.
3. **Проба fiskaly кнопкою**: `fiskalyProbe(config)` = auth + `GET /tss/{id}` через
   `reported()`, без транзакції; `PROBEABLE` + кнопка на картці, як у пошти.
4. **Один `<Link>`** з `src/app/app/platform/page.tsx` на `/app/platform/apps` — дозволено.

Пункт 7.2 твого звіту (екран «Канали» без ключа) — не твій, іде іншому контролеру.

## В. Приймання і звіт

`tsc`, `npm run check`, `check:pg` роллю `alisio_app`, `check-boundaries --strict` (стеля
`invoicing` = 3), `check:i18n` (число має зрушити — нові рядки), `build`, Playwright
`apps.spec.ts` доповнений кроком «Підключити TSE». Звіт — дописати в
`docs/tasks/2026-09-09-block-apps.report.md` розділом «Задача 3» (не переписувати
попереднє). Перший рядок звіту — стан CI на гілці (сторінка Actions): контролер його не
бачить.

Один чекпоінт — рецензія контролера. Питань власнику з цієї задачі не ставити.

Коли блок скінчено і звіт запушено — чекати номер так:

```bash
MINE=3
for i in $(seq 1 40); do
  git fetch -q origin claude/controller-2
  N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-4.md | head -1 | grep -oE '[0-9]+')
  if [ "${N:-0}" -gt "$MINE" ]; then echo "НОВА ЗАДАЧА: $N"; break; fi
  sleep 120
done
```
