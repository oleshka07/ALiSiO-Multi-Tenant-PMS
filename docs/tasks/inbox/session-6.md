TASK: 1

# Сесія 6 — задача 1: блок «Кіоск самообслуговування», частина А

Задача — `docs/tasks/2026-09-10-block-kiosk.md` на `origin/claude/controller-2`. Прочитай її
цілком, потім `AGENTS.md`, `docs/tasks/AUTOLOOP.md`, `docs/ARCHITECTURE.md` (розділи «Застосунки»
і Winhotel), `src/core/apps.ts`, `src/apps/winhotel-import/` як зразок застосунку,
`src/modules/bookings/api/reservation.handlers.ts:150–300`, `src/modules/guests/data/registration.repo.ts`,
`src/modules/properties/data/availability.ts`, `src/modules/properties/data/units.repo.ts`.

Старт: `git checkout -b claude/kiosk origin/claude/winhotel-import` → злиття
`origin/claude/channex-integration-66kv65` (без перебазування) → `tsc` і `npm run check` ДО
першої правки; червоне після злиття — стик, окремим комітом. Скопіюй задачу першим комітом у
`docs/tasks/2026-09-10-block-kiosk.md` на своїй гілці.

Зроби **частину А цілком** (§3.1 задачі): фасади `checkIn`/`checkOut`/`assignUnit` у
`@bookings` з політикою `checkin_payment_policy` і PATCH поверх них; підпис у `@guests`;
`system_of_record` і `kiosk_walkin_url` на обʼєкті; `kiosk_devices` / `kiosk_pairings` /
`kiosk_events` (міграція 0146+, `organization_id`, індекси, RLS, `schema.sql` перегенерований
зі СВІЖОЇ SQLite); парування і токен пристрою; публічний префікс `/api/apps/kiosk/` у
`src/proxy.ts` з причиною; маніфест `kiosk` у реєстрі (`kind: 'device'`, `scope: 'property'`,
`live: true`); гейти §3.4 для частини А — **кожен побачений червоним** (цитати в звіт);
документи тим самим комітом (ARCHITECTURE, NAMING, DECISIONS К1–К9 рядками).

Без частин Б–Г: після А — звіт `docs/tasks/2026-09-10-block-kiosk.report.md` (розділ
«Частина А»: що зроблено файл:рядок, гейти червоним/зеленим, відхилення названі), пуш, і
цикл, `MINE=1`:

```
MINE=1; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-6.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-6.md; break; }; sleep 300; done
```

Правила без винятків: жодних секретів і назв клієнта в коді (файл готелю — єдиний виняток, і
його ти не чіпаєш); `*.jsonl` витягів — ніколи в git; суперечність у задачі — не вирішуй
мовчки, назви в звіті; питання про гроші/ринок/смак — контролеру, решта — з коду й
DECISIONS.
