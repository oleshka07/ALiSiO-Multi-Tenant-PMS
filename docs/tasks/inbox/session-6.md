TASK: 2

# Сесія 6 — задача 2: частина Б — екран кіоска і його хендлери

Рецензія А — `docs/tasks/2026-09-10-review-kiosk-A.md` на `origin/claude/controller-2`: частину
А прийнято, `КІ1–КІ10` лишаються, PATCH через `decideCheckIn` — так. **`source = 'kiosk_walkin'`
дозволено:** міграція `0412` розширює CHECK `reservations.source` одним словом (Postgres — за
означенням, SQLite — перебудова зі зняттям/поверненням індексів і звіркою лічильника), рядок у
NAMING; `booking_sources` не чіпати.

Зроби **частину Б цілком** — §3.2 задачі, пункти 1–8, усе через фасади частини А:

- `src/apps/kiosk/api/`: пошук броні (два чинники, цей корпус, вікно ±1 день, >1 збіг → третій
  чинник без списку), картки гостей + QR на портал з OCR + опитування стану, згода, підпис
  (`@guests`), заселення (`assignUnit` → `checkIn`) з відповіддю «номер + `lock_code` + Wi-Fi»,
  виселення (`checkOut` → лист: `system_of_record = alisio` — фактура; `external` — підсумок без
  номера і рядок у `kiosk_events` для списку рецепції), «Ich habe gerade gebucht» → `tentative`
  з `source = 'kiosk_walkin'`, `external_ref = 'winhotel-ob:<номер>'` (та сама пара двічі → одна
  бронь; без номера → 400), Info & Services з `property_guest_config` і секцій порталу, події
  `kiosk_events` на кожну дію (ідемпотентно: повторне «заселити» — одна подія).
- Екран `src/app/kiosk/`: повноекранний layout без шапки, стан у памʼяті, токен у `localStorage`
  з try/catch, таймер 45/60 с з очищенням, маскування імен, екранна клавіатура (DE/EN + цифрова),
  робоча смуга з `config_json.touch_band`, DE + EN через `t()` (каталог de; cs — як є),
  кнопка «Рецепція» (телефон/WhatsApp) на кожному екрані, walk-in — перехід на
  `kiosk_walkin_url` окремою сторінкою.
- Оболонка `apps/kiosk-shell/` (MV3-розширення): на сторінках поза `/kiosk` — смуга «← Zurück
  zum Start» і той самий таймер, що повертає на `/kiosk` з очищенням cookies сайту бронювання;
  README з кроками Chrome kiosk-режиму на Windows (`--kiosk`, автозапуск, без сну).
- Гейти §3.4, що лишились: вікно ±1 день, один чинник → 400, два збіги → третій, `external` →
  лист без фактури + подія, `alisio` → фактура, повтор заселення → одна подія, walk-in-пара двічі
  → одна бронь; сцену 8 показати червоною на новому коді; родина «кіоск» у `check:routes`
  (форма відповіді). Кожен — червоним із цитатою.

Документи тим самим комітом (ARCHITECTURE, NAMING, DECISIONS, i18n-каталог, `schema.sql`).
Звіт — розділ «Частина Б»; ЧЕКПОІНТ 2 (власник дивиться екран у браузері на стенді) — після
моєї рецензії. Потім цикл, `MINE=2`:

```
MINE=2; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-6.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-6.md; break; }; sleep 300; done
```
