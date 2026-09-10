-- entity: day_closings
-- source: TAG_ABS
-- columns: lnr:int, tag_abs_zaehler:int, datum_zeit:ts, tag_abs_datum:date, saldo:amount, storno_betrag:amount, sign_abschluss_ok:int
--
-- Денні закриття (сальдо §3): лише останнє стає стартовим у fin_cash_closings; решта — контрольні числа.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAG_ABS_ZAEHLER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DATUM_ZEIT AS VARCHAR(24)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAG_ABS_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SALDO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STORNO_BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SIGN_ABSCHLUSS_OK AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM TAG_ABS
WHERE TA_STATUS < 1000;
