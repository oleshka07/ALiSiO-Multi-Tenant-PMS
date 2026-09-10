-- Контрольні числа знімка — крок 7 `docs/research/winhotel/extract.sh`,
-- перенесений у міст (COUNTS-2025-03.md §2, IMPORT-PLAN.md §5).
--
-- Кожен блок — `-- name: <ключ>` + `-- label: <людська назва>` + один запит.
-- Міст виконує блоки по одному; результат — обрізаний текст рядка isql
-- (одне число або короткий розподіл «код×N»), і `ERR`, якщо запит упав.
-- Персональних даних тут немає за побудовою: лише лічильники, суми й коди.
--
-- Суми в базі — BIGINT ×1000; тут уже поділені на 1000.0.

-- name: snapshot_max_invoice_at
-- label: знімок: max RECHNUNG.DATUM_ZEIT
SELECT MAX(DATUM_ZEIT) FROM RECHNUNG;

-- name: snapshot_max_booking_created
-- label: знімок: max GASTKONT.ERF_DATUM
SELECT MAX(ERF_DATUM) FROM GASTKONT;

-- name: invoice_no_generator
-- label: остання Rechnung-Nr (генератор)
SELECT GEN_ID(GEN_RECHNUNGNR, 0) FROM RDB$DATABASE;

-- name: invoice_no_max_live
-- label: остання Rechnung-Nr (max, живі), кількість
SELECT MAX(RECHNR), COUNT(*) FROM RECHNUNG WHERE TA_STATUS < 1000;

-- name: invoices_in_snapshot_year
-- label: фактур у році знімка (живі)
SELECT COUNT(*) FROM RECHNUNG WHERE TA_STATUS < 1000 AND EXTRACT(YEAR FROM DATUM_ZEIT) = (SELECT EXTRACT(YEAR FROM MAX(DATUM_ZEIT)) FROM RECHNUNG);

-- name: invoices_storno
-- label: фактур сторнованих
SELECT COUNT(*) FROM RECHNUNG WHERE STORNO_KZ > 0;

-- name: bookings_live
-- label: броней (GASTKONT) живих
SELECT COUNT(*) FROM GASTKONT WHERE TA_STATUS < 1000;

-- name: bookings_future
-- label: броней із заїздом після знімка
SELECT COUNT(*) FROM GASTKONT WHERE TA_STATUS < 1000 AND VONAUFH > (SELECT CAST(MAX(DATUM_ZEIT) AS DATE) FROM RECHNUNG);

-- name: bookings_in_snapshot_year
-- label: броней із заїздом у році знімка
SELECT COUNT(*) FROM GASTKONT WHERE TA_STATUS < 1000 AND EXTRACT(YEAR FROM VONAUFH) = (SELECT EXTRACT(YEAR FROM MAX(DATUM_ZEIT)) FROM RECHNUNG);

-- name: booking_status_mix
-- label: стани броней BUCH/CI/TA (код×N)
SELECT BUCH_STATUS, CI_STATUS, TA_STATUS, COUNT(*) FROM GASTKONT GROUP BY 1, 2, 3 ORDER BY 4 DESC;

-- name: occupancy_junk_dates
-- label: BELEGUNG сміттєвих дат (<1900)
SELECT COUNT(*) FROM BELEGUNG WHERE ANREISE < '1900-01-01';

-- name: addresses_live
-- label: адрес живих
SELECT COUNT(*) FROM ADRESSEN WHERE TA_STATUS < 1000;

-- name: addresses_with_debtor_no
-- label: адрес з номером дебітора (N, min, max)
SELECT COUNT(*), MIN(DEBI_NR), MAX(DEBI_NR) FROM ADRESSEN WHERE DEBI_NR > 0 AND TA_STATUS < 1000;

-- name: addresses_by_type
-- label: адрес за типом ADR_WAHL (код×N)
SELECT ADR_WAHL, COUNT(*) FROM ADRESSEN WHERE TA_STATUS < 1000 GROUP BY 1;

-- name: addresses_anonymised
-- label: адрес анонімізованих (DS_VORGENOMMEN×N)
SELECT DS_VORGENOMMEN, COUNT(*) FROM ADRESSEN GROUP BY 1;

-- name: units_real_pseudo
-- label: номерів справжніх / псевдо
SELECT SUM(CASE WHEN CAST(ZINR AS INTEGER) < 9000 THEN 1 ELSE 0 END), SUM(CASE WHEN CAST(ZINR AS INTEGER) >= 9000 THEN 1 ELSE 0 END) FROM ZIMMSTAM WHERE TA_STATUS < 1000 AND ZINR IS NOT NULL;

-- name: unit_types_real_pseudo
-- label: категорій справжніх / псевдо
SELECT SUM(CASE WHEN COALESCE(PSEUDO, 0) = 0 THEN 1 ELSE 0 END), SUM(CASE WHEN COALESCE(PSEUDO, 0) <> 0 THEN 1 ELSE 0 END) FROM KATESTAM WHERE TA_STATUS < 1000 AND LNR NOT IN (0, 99999);

-- name: folio_lines_live
-- label: рядків рахунку (BUCHKONT) живих, сума
SELECT COUNT(*), SUM(GBETRAG) / 1000.0 FROM BUCHKONT WHERE TA_STATUS < 1000;

-- name: payments_live
-- label: платежів живих, сума
SELECT COUNT(*), SUM(BETRAG) / 1000.0 FROM ZAHLUNGEN WHERE TA_STATUS < 1000;

-- name: payments_debtor
-- label: платежів дебіторських (M_DEBITOR>0), сума
SELECT COUNT(*), SUM(BETRAG) / 1000.0 FROM ZAHLUNGEN WHERE TA_STATUS < 1000 AND M_DEBITOR > 0;

-- name: open_guest_balances
-- label: відкриті позиції по рахунках гостей (виїхали, offen<>0): N, сума
EXECUTE BLOCK RETURNS (N INTEGER, SUMME NUMERIC(15,3)) AS DECLARE L INTEGER; DECLARE O NUMERIC(12,3); BEGIN N = 0; SUMME = 0; FOR SELECT LNR FROM GASTKONT WHERE TA_STATUS < 1000 AND CI_STATUS = 2 INTO :L DO BEGIN SELECT OFFEN_BETRAG FROM GET_OFFEN_ZAHLBETRAG(:L) INTO :O; IF (O IS NOT NULL AND O <> 0) THEN BEGIN N = N + 1; SUMME = SUMME + O; END END SUSPEND; END

-- name: invoice_ledger_by_status
-- label: книга вихідних рахунків за DB_STATUS (код×N×сума)
SELECT DB_STATUS, COUNT(*), SUM(UMSATZ) / 1000.0 FROM AUSGBUCH GROUP BY 1;

-- name: vouchers_sold
-- label: ваучерів продано (послуги 7/55/95): N, сума
SELECT COUNT(*), SUM(GBETRAG) / 1000.0 FROM BUCHKONT WHERE TA_STATUS < 1000 AND LEIST_LNR IN (7, 55, 95);

-- name: vouchers_redeemed
-- label: ваучерів погашено (спосіб оплати Gutschein): N, сума
SELECT COUNT(*), SUM(Z.BETRAG) / 1000.0 FROM ZAHLUNGEN Z JOIN DEVISEN D ON D.LNR = Z.LNR_DEVI WHERE Z.TA_STATUS < 1000 AND UPPER(D.BEZEICHN) LIKE '%GUTSCHEIN%';

-- name: deposits_on_bookings
-- label: депозити на бронях (ANZA_BETRAG>0): N, сума
SELECT COUNT(*), SUM(ANZA_BETRAG) / 1000.0 FROM GASTKONT WHERE TA_STATUS < 1000 AND ANZA_BETRAG > 0;

-- name: deposits_on_future_bookings
-- label: депозити на майбутніх бронях: N, сума
SELECT COUNT(*), SUM(ANZA_BETRAG) / 1000.0 FROM GASTKONT WHERE TA_STATUS < 1000 AND ANZA_BETRAG > 0 AND VONAUFH > (SELECT CAST(MAX(DATUM_ZEIT) AS DATE) FROM RECHNUNG);

-- name: last_day_closing
-- label: останнє денне закриття: дата, сальдо
SELECT FIRST 1 TAG_ABS_DATUM, SALDO / 1000.0 FROM TAG_ABS WHERE TA_STATUS < 1000 ORDER BY TAG_ABS_DATUM DESC;

-- name: seasons_in_snapshot_year
-- label: сезонів на рік знімка
SELECT COUNT(*) FROM SAISSTAM WHERE TA_STATUS < 1000 AND EXTRACT(YEAR FROM VON) = (SELECT EXTRACT(YEAR FROM MAX(DATUM_ZEIT)) FROM RECHNUNG);

-- name: prices_live
-- label: цінових рядків живих
SELECT COUNT(*) FROM PREISLIST WHERE TA_STATUS < 1000;

-- name: tax_codes_live
-- label: ставок ПДВ живих
SELECT COUNT(*) FROM STEUSTAM WHERE TA_STATUS < 1000;

-- name: payment_methods_live
-- label: способів оплати живих
SELECT COUNT(*) FROM DEVISEN WHERE TA_STATUS < 1000;
