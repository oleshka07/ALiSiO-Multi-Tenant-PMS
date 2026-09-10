-- entity: invoices
-- source: RECHNUNG
-- deleted: kept — нумерація має бути суцільною; сторно й видалені — заморожена історія
-- columns: lnr:int, rechnr:int, rechnr_alpha:text, verk_nr:int, lfdnr:int, gk_lnr:int, datum_zeit:ts, userid:int, ta_status:int, lnr_co:int, storno_kz:int, sign_nicht_ok:int
--
-- Фактури (крок 11): УСІ, разом зі сторно (STORNO_KZ) і видаленими — заморожена історія, нумерація має бути суцільною.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECHNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(RECHNR_ALPHA, '') || ASCII_CHAR(31)
  || COALESCE(CAST(VERK_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LFDNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DATUM_ZEIT AS VARCHAR(24)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(USERID AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TA_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_CO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STORNO_KZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SIGN_NICHT_OK AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM RECHNUNG
WHERE 1 = 1;
