-- entity: rate_codes
-- source: PREISCODE
-- deleted: kept — історичні брони несуть PR_CODE вимкнених кодів
-- columns: lnr:int, mand_nr:int, bezeichn:text, ta_status:int, sort_nr:int, pseudo:bool
--
-- Прайс-коди (крок 5) — наші тарифи. Без фільтра: історичні брони несуть PR_CODE вимкнених кодів (2, 6, 10).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(TA_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PSEUDO AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM PREISCODE
WHERE 1 = 1;
