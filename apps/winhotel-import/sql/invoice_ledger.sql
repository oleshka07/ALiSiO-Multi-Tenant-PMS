-- entity: invoice_ledger
-- source: AUSGBUCH
-- deleted: kept — книга по фактурах, які беруться всі; DB_STATUS — сальдо
-- columns: lnr:int, adr_lnr:int, rechnr:int, rechnr_alpha:text, re_lauf:int, rech_dat:date, lnr_zinr:int, gbvon:date, gbbis:date, leist_lnr:int, menge:int, epreis:amount, umsatz:amount, steuersatz:amount, db_status:int, lnr_buchkont:int, bezeichn:text, lnr_co:int, sto_betrag:amount, konto_nr:text
--
-- Книга вихідних рахунків (крок 11, сальдо §3): ADR_LNR — дебітор, DB_STATUS — стан оплати, STEUERSATZ (NUMERIC(12,3)).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ADR_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECHNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(RECHNR_ALPHA, '') || ASCII_CHAR(31)
  || COALESCE(CAST(RE_LAUF AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECH_DAT AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_ZINR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GBVON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GBBIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MENGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(EPREIS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(UMSATZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STEUERSATZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DB_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_BUCHKONT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_CO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STO_BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KONTO_NR, '') || ASCII_CHAR(30)
FROM AUSGBUCH
WHERE 1 = 1;
