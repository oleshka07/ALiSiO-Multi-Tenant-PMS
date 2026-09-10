# Рецензія 3 — сесія 4 (Блок «Застосунки»), задача 3, голова `5aed6dcf`

Контролер 2 (Schlossberghotel / Застосунки), 10.09.2026, ~07:50 UTC.
Рецензовано: `6f65219f` (А1, А2, Б1–Б4, міграція 0142), `b6b56f0a` (злиття гілки робіт,
21 коміт), `5aed6dcf` (звіт).

## Вердикт

**Задачу 3 прийнято.** Блок «Застосунки» зроблено цілком; лишається одне зауваження до
дограння (В1 нижче, задача 4), яке не блокує, але коштує грошей у живому проході. Злиття —
як і раніше, після `beta → main` (З5).

## Перевірено фактами (у хмарі контролера на `5aed6dcf`)

- `tsc` 0; `apps.check.ts` — усі сцени зелені, включно з `3.8`, `А1`, `А2`;
  `check-boundaries --strict` — «39 по 16 модулях, у межах стелі», стеля `invoicing` = 3
  (`check-boundaries.mjs:72–78`, коментар «4 → 3»); `check:i18n` 3542/3542.
- **Гейти вміють червоніти — дві мутації на голові:**
  (1) прибрав умову замка `AND (tse_connecting_at IS NULL OR tse_connecting_at < ?)` у
  `_handlers.ts:251–254` ⇒ `два одночасні натиски відповіли [200,200] — має бути один 200
  і один 409`;
  (2) у `fiskalyConnect` (`fiskaly-sign-de.ts:251–252`) проігнорував `resume` ⇒ лічильник
  `PUT /tss` у повторному натиску `1 !== 0`. Обидві повернуто, дерево чисте.
- `_handlers.ts:229–258`: рядок обʼєкта створюється `INSERT … WHERE NOT EXISTS` ДО походу
  до вендора; замок одним `UPDATE … WHERE tss_id IS NULL AND (замка немає OR старший за
  10 хв)`, `changes === 0` → 409; обидві мітки ISO з JS (пастка `CURRENT_TIMESTAMP` проти
  ISO у SQLite названа в коді, клас INC-011); `release()` на відмові, `tse_connecting_at =
  NULL` на успіху (:291).
- А1: `onCreated` (:270–276) кладе `tse_pending_tss_id` і `seal(adminPuk)` одразу після
  `PUT /tss`; `tss_id` лишається NULL; при повторному натиску `resume = { tssId, adminPuk
  }` (:263–264) і клієнт пропускає `PUT` (`fiskaly-sign-de.ts:262–268`); текст відмови
  `FiskalyConnectError` називає TSS (`:206–208`); клієнту — 502 без `e.message`, з
  last4 (:281–284).
- Міграція 0142 — два `ADD COLUMN IF NOT EXISTS`, дзеркало в `migrateApps()` (`db.ts`
  ~7753); `schema.sql` +2.
- Б1: `src/modules/invoicing/api/index.ts` (кінець файлу) — один експорт
  `fiskalyDevice, fiskalyProbe, fiskalyConnect, FiskalyConnectError` + типи, з посиланням
  на рецензію 1. Б2: розбиття ПДВ перевіряється в `signReceipt` до `reported()` — сцена 6
  «третя вісь» зелена і була червона на старому коді (звіт). Б3: `fiskalyProbe`
  (`fiskaly-sign-de.ts:114–125`) — auth + `GET /tss/{id}` через `reported()`. Б4:
  `<Link>` у `platform/page.tsx`.
- CI: сесія показала `conclusion: success` на `b6b56f0a` (запуск `34446374678`, 06:41–06:52
  UTC) — раннер повернувся. Я Actions не бачу (токен без права), тож приймаю за звітом;
  `npm run check` цілком прогнав сам (лог у контролера).

## Зауваження — у задачу 4

1. **В1. Дограння сліпе до стану TSS.** `fiskalyConnect` з `resume` завжди починає з
   `PATCH /tss/{id} {UNINITIALIZED}` (`fiskaly-sign-de.ts:270`). За документацією fiskaly
   переходи станів односторонні (`CREATED → UNINITIALIZED → INITIALIZED`), і PATCH у стан,
   в якому TSS уже є, відхиляється. Тобто якщо перший прохід упав ПІСЛЯ `PATCH
   {INITIALIZED}` (на `PUT /client`), кожен наступний натиск падатиме на першому кроці
   дограння — сирітська TSS назавжди, і жодний натиск її не завершить. Сесія це сама
   назвала в коментарі («живий прохід скаже») — але це не має чекати живого проходу:
   `GET /tss/{id}` перед доґранням, і кроки лише від поточного `state` (`CREATED` — з
   `PATCH UNINITIALIZED`; `UNINITIALIZED` — з `PATCH /admin`; `INITIALIZED` — `PATCH
   /admin` + `POST /admin/auth` + `PUT /client`). Гейт: часткова відмова на `PUT /client`
   → повторний натиск не шле `PATCH {UNINITIALIZED}` і не шле `PUT /tss`, а лише
   `admin`/`admin/auth`/`client`, і завершується 200.
