-- entity: consents
-- source: ADR_DATENSCHUTZ
-- columns: lnr:int, adr_lnr:int, datenschutzstam_lnr:int, erf_datumzeit:ts, erf_userid:int
--
-- Згоди GDPR (крок 14): адреса × пункт згоди × коли.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ADR_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DATENSCHUTZSTAM_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ERF_DATUMZEIT AS VARCHAR(24)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ERF_USERID AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM ADR_DATENSCHUTZ
WHERE TA_STATUS < 1000;
