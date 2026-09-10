# Витяг із головної бази Winhotel.MX — результат `extract.sh`

Зроблено контролером 2 у хмарному контейнері 10.09.2026 (07:15–07:40 UTC) з двох
файлів `gbak`, які власник поклав на диск: `WINHOTEL.fbk` (407 384 576 байт, sha256
`fe543da4…f3c8`) і `WHMXVAKANZ.fbk` (6 966 784 байт, sha256 `cd1206b0…efb1`). Обидва
відновлено `gbak -c` (Firebird 3.0.11, embedded, ODS 12.0); контрольні суми на диску
власника і в контейнері збіглися. **База й обидва `.fbk` з контейнера видалені** після
витягання — тут лише текст.

Це вихід кроків 2–6 скрипта, без правок, плюс `main/samples.txt` — зразки довідників
(запити нижче). Кодування бази `NONE`; текст усередині — CP1252 (німецькі умлаути),
у `samples.txt` перекодовано в UTF-8. У DDL/колонках перекодування не робилося —
там лише ASCII-ідентифікатори.

## Що де

| Файл | Що |
|---|---|
| `main/header.txt` | версія, ODS 12.0, кодування NONE, сторінка 8192 |
| `main/DDL.sql` | повний DDL головної бази (`isql -x`): 258 таблиць, view, процедури, тригери; `DDL.err` порожній |
| `main/table-counts.tsv`, `main/table-counts.by-size.tsv` | `COUNT(*)` по кожній із 258 таблиць |
| `main/table-columns.tsv` | `ТАБЛИЦЯ.КОЛОНКА  ТИП(довжина)` — 7 тис. рядків, для пошуку за назвами |
| `main/keyword-hits.txt` | рядки з `table-columns.tsv` за ключовими словами скрипта |
| `main/samples.txt` | зразки довідників (див. §«Зразки») |
| `vakanz/*` | те саме для `WHMXVAKANZ.fbk`: 5 таблиць, дані лише у `FM_PROT` (486) — журнал обміну з channel manager; для міграції неістотна |

## Дата знімка — 11.03.2025, не вересень 2025

`BELEGUNG.ERF_DATUM` max = 2025-03-11; `RECHNUNG.DATUM_ZEIT` max = 2025-03-11 08:11;
заїзди в базі є до 2026-06 (33 брони з заїздом у 2026 — це майбутні на момент знімка).
Отже `.fbk` зроблено 11 березня 2025. Для контрольних чисел (`COUNTS-*.md`) це і є
дата знімка; перед справжнім перенесенням потрібен свіжий `.fbk` — цей на пів року
старіший, ніж вважалося. `ZIMMSTAM.KOR_DATUM` max = 2022-09-15 — номерний фонд не
мінявся з 2022.

## Головні таблиці (з `table-counts.by-size.tsv`)

Броні `BELEGUNG` 52 996 (заїзд від 1899-12-30 — дефолтна «порожня» дата Delphi, тобто є
сміттєві рядки; у 2025 заїздів 3 086). Рахунки гостя `GASTKONT` 52 941, проводки
`BUCHKONT` 195 303, фактури `RECHNUNG` 33 059 (з 2018-12-31), платежі `ZAHLUNGEN` 26 115,
адреси `ADRESSEN` 37 088 (+`ADR_ZUSATZ` 20 093, `ADR_DATENSCHUTZ` 61 305, `GASTHIST`
18 211, `GASTKREF` 16 696). Фіскалізація: `FISKAL_BK` 79 610 (підписані операції, є
`SIGNATUR`, `FISKAL_REF`), `FISKAL_RECHNUNG` 12 837, `FISKAL_RECH_POS` 42 509,
`FISKAL_ZERO_REC` 3 607. Онлайн: `ONLINE_BUCHUNGEN` 8 047, `ONLINETRANS_ALLE` 148 448.
`GUTSCHEINE` — **0 рядків**: ваучери в цій базі не ведуться окремою таблицею (шукати
як послуги `GS`/`GUTSCHEIN` у `LEISTSTA`/`GASTKONT`). `STORNO_BED` 0. `PLZ_STRASSE`
245 559 — довідник вулиць Німеччини, не дані готелю.

Довідники: `KATESTAM` 11, `ZIMMSTAM` 37, `LEISTSTA` 132, `WARENGRU` 9, `STEUSTAM` 7,
`PREISCODE` 10, `PREISLIST` 341, `SAISSTAM` 23, `KATESTAM_LEISTUNG` (див. samples),
`KASSEN` 206, `MANDANT` 2, `MANDANT_FISKAL` 1.

## Що видно зі зразків

- **Категорії** (`KATESTAM`, `LNR`/`KATEGORIE`/`ANZ_KATE`/`PSEUDO`): ES 1, SD 2, DZD 15,
  SK 2, DZK 8, V 2 (Familienzimmer), B 1 (barrierefrei) = **31 справжній номер**; SEM 1 і
  PS 3 — `PSEUDO=1`; рядки `LNR` 0 і 99999 — технічні. `PREISLIST` у категорії = номер
  прайс-листа (1–7).
- **Номери** (`ZIMMSTAM`, `ZINR` текстовий): 102–110 (поверх 1), 201–214 (2), 231–244 (3);
  9001 Seminarraum, 9500–9502 і 9999 Pseudozimmer; ще один рядок `LNR 9999`/`ZINR 9999`
  з NULL — технічний. `LNR_KATE` → `KATESTAM.LNR`.
- **ПДВ** (`STEUSTAM`): `STS` 1/2/3 = 0 % / 7 % / 19 % з історією за `VON`/`BIS`
  (07–12.2020: 5 % і 16 %). `STSATZ` — відсоток; `FISKAL_ZUWEISUNG` 4/1/0 — код
  ставки для TSE. Послуга зберігає `STS`, не відсоток → ставка на дату.
- **Групи виручки** (`WARENGRU`, `WGNR`): 100 Logis, 200 Speisen, 300 Getränke, 400
  Wellness, 500 Sonstige, 600 Durchläufer (Kurtaxe), 700 Geldtransit, 750 Ausgaben,
  800 Kein Umsatz.
- **Послуги** (`LEISTSTA`): `KURZBEZ`, `BEZEICHN`, `WG` → `WARENGRU.WGNR`, `STS` →
  `STEUSTAM.STS`, `BETRAG` (ціна за замовчуванням), `KONTONR` (рахунок бухобліку),
  прапорці `M_LOGI`/`M_LEIST`/`M_FIX`. Логіс = `LNR 1 LOGIS`.
- **Ціни**: `PREISCODE` (10 «прайс-кодів»: Standard, Pauschalen, Firmenpreise,
  Booking.com, HRS, VPW, Wanderreisen, WEB.MX і два корпоративні — імена замасковано
  FIRMA_A/FIRMA_B) → `SAISSTAM` (сезони на прайс-код: `PRCODE`, `SAISON`, `VON`–`BIS`,
  HS/NS) → `PREISLIST` (рядок = прайс-код × прайс-лист категорії × сезон × `MATCHC`
  тариф, напр. `ÜF_1`/`ÜF_2` = 1/2 особи; `BETRAG` за ніч, `EZPREIS`, `KURTAX_INKL`,
  `ONLINE_BUCHBAR`, `FM_RATEID` для channel manager). Суми — `BIGINT` з трьома
  десятковими (isql показує `141.000` = 141,00 €).
- **TSE** (`MANDANT_FISKAL`, 1 рядок, санітизовано — лише довжини): `CASHBOX_ID` 36
  символів (UUID), окремі `QUEUE_ID`/`SCU_ID`, `TSE_SER_NUM` 64 символи, `REC_TYPE`
  `ecdsa-plain-SHA384`, активовано 2021-09-09, `URL http://<host>:3076`, `CERTIFICATE`
  порожній. Терміни CashBox/Queue/SCU — це словник **fiskaltrust.Middleware**, не
  fiskaly; тобто чинний постачальник TSE в готелі, ймовірно, fiskaltrust (підтвердити в
  готелі). Для ALiSiO це означає нову TSE (fiskaly) з новим `ALISIO-<slug>` серійником і
  окремий експорт старої TSE (TAR) для 10-річного зберігання.

## Зразки — як отримано і що замасковано

`isql-fb -user SYSDBA -q` на відновленій базі; лише довідники, без гостей, адрес,
фактур, проводок. Запити: `KATESTAM`, `ZIMMSTAM`, `STEUSTAM`, `WARENGRU`, `LEISTSTA`
(`BEZEICHN` обрізано до 40), `PREISCODE`, `PREISLIST` (усі 341, `BEZEICHUNG` до 40),
`KATESTAM_LEISTUNG`, `SAISSTAM` (`*`), `MANDANT_FISKAL` (без ідентифікаторів і ключів —
лише `CHAR_LENGTH`), три агрегати дат. Замасковано: назви двох корпоративних клієнтів
у `PREISCODE.BEZEICHN` і `PREISLIST.MATCHC` (→ FIRMA_A / FIRMA_B), хост у
`MANDANT_FISKAL.URL`. `grep -riE "iban|@|strasse|str\."` по цій теці дає лише назви
колонок і збережену процедуру анонімізації в DDL (`'Musterstr. 99'`) — даних нема.
