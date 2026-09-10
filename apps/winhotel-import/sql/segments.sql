-- entity: segments
-- source: SEGMSTAM
-- columns: lnr:int, mand_nr:int, segmcode:int, bezeichn:text, sort_lnr:int, leistung_lnr:int, prozent_betrag:int, betrag:amount
--
-- Сегменти броней (крок 6) → джерела: SEGMCODE — код, на який посилається GASTKONT.MARKSEG.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SEGMCODE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEISTUNG_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PROZENT_BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM SEGMSTAM
WHERE TA_STATUS < 1000;
