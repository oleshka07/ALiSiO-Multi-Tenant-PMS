TASK: 4

# Сесія 5 — задача 4: файл готелю `hotels/schlossberghotel.json` звірити з базою

Задачу 3 прийнято — `docs/tasks/2026-09-10-review-winhotel-3.md` на
`origin/claude/controller-2`. Дослідження вичерпано; тепер його перший прикладний плід.
Гілка та сама. **Дозволено писати** в `docs/research/winhotel/**`, звіт і — вперше —
`hotels/schlossberghotel.json`. Більше нікуди (не `src/**`, не схема, не `hotels/README.md`).

## Навіщо

`hotels/schlossberghotel.json` — стан, до якого готель приводиться на беті й проді
(`hotels/README.md`, `scripts/apply-hotel.mjs`). Він писався зі скріншотів до того, як була
база. Тепер є `extract-out/main/samples.txt` (KATESTAM, ZIMMSTAM, STEUSTAM, WARENGRU,
LEISTSTA, PREISLIST) — файл треба звірити з базою і привести до неї. Рішення власника
(не перепитувати): номерів **31**; серія фактур — **як на останній фактурі Winhotel
`22.591`**: один наскрізний лічильник, без префікса, без року, крапка — роздільник тисяч
у друці; лічильник у день перемикання продовжується з останнього номера Winhotel.

## Обсяг

1. **Номери** — рівно ті 31, що в `ZIMMSTAM` з `ZINR < 9000`: коди, поверх з `STOCK`,
   тип з `LNR_KATE → KATESTAM.KATEGORIE`. Діапазони `from…to` у файлі розгорни або
   перевір, що вони дають саме цей перелік (105–106, 202–206, 208–209 тощо — звір
   кожен). Псевдо (9001, 95xx, 9999) — не номери. Тип `AP` з номерами 111/112 у базі
   **відсутній** (ані в `ZIMMSTAM`, ані в `KATESTAM`) — з файла не видаляти (README:
   «нічого не видаляється»), але в `HOTEL-FILE-DIFF.md` назвати як питання власнику.
2. **Категорії** — назви з `KATESTAM.BEMERK1` (`Doppelzimmer "Design"` тощо), місткість з
   `ANZ_ERW`/`ANZ_K1`/`ANZ_BETTEN` проти `maxAdults`/`maxOccupancy`; розбіжності — у
   DIFF, у файлі — за базою, якщо база не суперечить прайсу 2027 (Suite до 4 осіб з
   Aufbettung, Vierbett 4).
3. **Ставки ПДВ** — `taxRates` за `STEUSTAM`: коди `reduced`/`standard`/`zero` з історією
   `validFrom` (2020-07-01 5 %/16 %, 2021-01-01 7 %/19 %) — README каже, що ключ —
   `code + validFrom`; перевір у `scripts/apply-hotel.mjs`, чи він приймає кілька рядків на
   код, і якщо ні — лише чинні, а історію в DIFF.
4. **Послуги** — з `LEISTSTA` ті, що готель справді продає (Logis не послуга; сніданок
   Speisen/Getränke, Lunchpaket, Haustier, Tiefgarage, Aufbettung/Zustellbett, Kuchen,
   Gutschein-послуги, Stornogebühren, No-Show, Nachlass — усе, що є в зразку з `WG` і
   `STS`): назва, ціна з `BETRAG`/1000 або з прайсу 2027 (Frühstück 15 = 12 + 3, Haustier
   10, Tiefgarage 10, Aufbettung 19), `vatCode` з `STS` (2 → reduced, 3 → standard,
   1 → zero), категорія з `WARENGRU`. Те, що у файлі є, а в базі немає, — лишити, у DIFF.
5. **Серія фактур** — за рішенням власника: формат без префікса й року; подивись
   грамматику `numberFormat` у `src/modules/invoicing/domain/invoice-number-format.ts` і
   гейт `invoice-number-format.check.ts`, обери формат, який дає `22591` / `22.591` у
   друці; стартовий лічильник **не** вигадувати — у DIFF: «поставити в день X з
   `MAX(RECHNUNG.RECHNR)` (є ще `RECHNR_ALPHA`)».
6. **Ціни** — 2027 у файлі вже є; звір із `PREISLIST` 2025 лише структуру: сезони
   (`SAISSTAM`: NS 01.01–28.02, HS 01.03–31.12), `MATCHC ÜF_1/2` = 1/2 особи, LOS. Числа
   2025 у файл не переносити (застарілі); розбіжності структури — у DIFF.
7. **`acceptance`** — перерахувати очікувані суми під чинні ціни у файлі (дати сценаріїв
   у майбутньому, 2027), щоб `scripts/check-hotels.mjs` і `apply-hotel --dry-run` були
   зелені.
8. **`docs/research/winhotel/HOTEL-FILE-DIFF.md`** — таблиця «файл ↔ база»: що змінено,
   що лишено, що спитати власника (AP 111/112; послуги з ціною 0; Komfortzimmer).

Жодних компаній, дебіторів, гостей у файлі — вони прийдуть імпортом. Жодних
персональних даних.

## Приймання і звіт

`node scripts/apply-hotel.mjs hotels/schlossberghotel.json --dry-run` без відмов;
`node scripts/check-hotels.mjs` зелений; `npm run check` зелений; PII-grep за правилом
README порожній; кількість номерів у файлі після розгортання діапазонів = 31 (+ AP, якщо
лишено, — назвати). Звіт — розділ «Задача 4»: коміти, що змінено у файлі числом
(номерів/послуг/ставок), три головні розбіжності з базою. Потім цикл очікування,
`MINE=4`:

```
MINE=4; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-5.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-5.md; break; }; sleep 300; done
```
