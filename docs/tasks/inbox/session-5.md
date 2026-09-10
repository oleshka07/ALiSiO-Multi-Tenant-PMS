TASK: 2

# Сесія 5 (дослідження Winhotel) — задача 2: завершити §2 з готового витягу

Гілка та сама: `claude/winhotel-schema`. Спершу `git fetch origin && git merge
origin/claude/winhotel-schema` — контролер додав коміт `ccc6cf6b` зверху твого `c391ad5f`:
**`docs/research/winhotel/extract-out/`** — це вихід ТВОГО `extract.sh`, запущеного в хмарі
контролера на справжніх `WINHOTEL.fbk` (407 МБ, знімок **11.03.2025**, не 01.09.2025) і
`WHMXVAKANZ.fbk`. Бази з контейнера видалено; Drive тобі більше не потрібен. Читай
`extract-out/README.md` першим — там дата знімка, головні таблиці, що видно зі зразків,
знахідка про TSE (fiskaltrust, не fiskaly) і що замасковано.

Рецензію задачі 1 (`docs/tasks/2026-09-09-review-winhotel-1.md` на `origin/claude/controller-2`)
прочитай: скрипт і конвенції прийнято; блокер знято шляхом 3.

## Обсяг (один блок, без зупинок)

1. **`TABLES.md`** — заповнити з `extract-out/main/table-counts.by-size.tsv` і
   `table-columns.tsv`: усі 258 таблиць, для кожної — рядків, здогадка «що це» з позначкою
   упевнено/гіпотеза; порожні (0 рядків) — окремим списком одним абзацом. `TEMP_*`, `STAT_*`,
   `WEB_ABF_*`, `ARCHIV_*`, `*_PROT` — групами, не по одній.
2. **`MAPPING.md`** — 11 сутностей §2.3 задачі 1 з таблицями, ключовими колонками і
   зв'язками, читаючи `DDL.sql` (FK, тригери) і `table-columns.tsv`. Уже відомо з README:
   об'єкт/номери (`KATESTAM`, `ZIMMSTAM`), ПДВ (`STEUSTAM`), послуги (`LEISTSTA`, `WARENGRU`),
   ціни (`PREISCODE` → `SAISSTAM` → `PREISLIST`, `KATESTAM_LEISTUNG`), TSE (`MANDANT_FISKAL`,
   `FISKAL_BK`, `FISKAL_RECHNUNG`, `FISKAL_RECH_POS`). Знайти по DDL: гості/адреси
   (`ADRESSEN` + `ADR_ZUSATZ`/`GASTHIST`/`GASTKREF` — де три адреси і `Gast-Nr 1/2/3`),
   компанії/дебітори (де `Debitoren-Nummer` 10000–12599 — колонка в `ADRESSEN`?), брони
   (`BELEGUNG`: `Beleg-Nr`, `Verkn-Nr`, стани, `Buchungs-Segm.`, `Referenz-Nr`, FIX,
   `Anzahlung`; зверни увагу на 1899-12-30 у `ANREISE` — сміттєві рядки), послуги на броні
   (`GASTKONT`/`BUCHKONT`: `Menge × Tage`, щоденна), фактури (`RECHNUNG`, `RECHNUNGSDRUCK`,
   `CHECKOUT`, `FAKT_ERLOESE`; де `Rechnung-Nr` і `offener Betrag`), оплати (`ZAHLUNGEN`,
   `ZAHLUNG_ZUS`, `KASSEN` 206 рядків — що це), політики Storno (`STORNO_BED` порожня —
   шукати в `PREISLIST`/`LEISTSTA`/`MANDANT`), ваучери (`GUTSCHEINE` порожня — шукати як
   послуги `GS`/`GUTSCHEIN` у `LEISTSTA` і рядки в `GASTKONT`). Де не знайдено — чесне
   «не знайдено» з тим, що перевірив.
3. **`REFERENCE-SAMPLES.md`** — переписати з `extract-out/main/samples.txt` у читабельні
   таблиці (по 5–10 рядків, ті самі довідники). Нічого нового з бази не діставати — бази
   нема.
4. **`COUNTS-2025-09.md` → перейменувати в `COUNTS-2025-03.md`** (знімок 11.03.2025) і
   заповнити те, що виводиться з `table-counts.tsv` та README (броней усього, з заїздом у
   2025 = 3 086, у 2026 = 33, фактур усього, гостей/адрес, номерів справжніх/псевдо);
   решту (остання `Rechnung-Nr`, відкриті дебіторські, ваучери) — позначити «потрібен
   запит до бази» з готовим SQL по знайдених колонках, щоб наступний прогін `extract.sh`
   міг їх узяти. Додати в `extract.sh` крок «агрегати» з цими запитами (лише числа).
5. **`notes.md`** — доповнити: дата знімка 11.03.2025 і що перед перенесенням потрібен
   свіжий `.fbk`; кодування NONE/CP1252; суми BIGINT ×1000; `PLZ_STRASSE` — довідник, не
   дані; `ADR_DATENSCHUTZ` 61 305 — що це (GDPR-журнал?); тригери, що пишуть у
   `FISKAL_*`/`STAT_*`; чи є в DDL процедура анонімізації (`'Musterstr. 99'`) і що вона
   робить; знахідка TSE = fiskaltrust з `MANDANT_FISKAL` (CashBox/Queue/SCU) — наслідок для
   ALiSiO: нова TSE fiskaly + експорт старої.
6. **`README.md`** теки — оновити навігацію (extract-out є).

## Чого не робити

Не чіпати `extract-out/**` (це сирий вихід, тільки читати). Не завантажувати нічого з
Drive. Не писати поза `docs/research/winhotel/**` і звітом. Жодних персональних даних:
`grep -riE "iban|@|strasse|str\." docs/research/winhotel/` поза `extract-out/` і
`extract.sh` має бути порожнім (у `extract-out` це лише назви колонок — так і лишається).

## Приймання і звіт

`npm run check` зелений (гейт `check-no-tenant-names` — назва готелю в `docs/research/`
дозволена; перевір). Звіт — доповнити `docs/tasks/2026-09-09-winhotel-schema.report.md`
розділом «Задача 2»: коміти, п'ять найважливіших знахідок для імпортера, що не знайдено.
Потім — цикл очікування з `origin/claude/controller-2`, `MINE=2`:

```
MINE=2; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-5.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-5.md; break; }; sleep 300; done
```
