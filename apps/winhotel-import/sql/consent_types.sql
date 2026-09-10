-- entity: consent_types
-- source: DATENSCHUTZSTAM
-- columns: lnr:int, bezeichn:text, online_status:int, sort_lnr:int, zuordnung:int, meldeschein_zuordn:int, vorbelegung:int
--
-- Пункти згоди GDPR (крок 14): три рядки, на які посилається ADR_DATENSCHUTZ.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(ONLINE_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZUORDNUNG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MELDESCHEIN_ZUORDN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VORBELEGUNG AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM DATENSCHUTZSTAM
WHERE TA_STATUS < 1000;
