-- entity: address_types
-- source: ADR_AUSWAHL
-- columns: lnr:int, adr_wahl:int, bezeichn:text, sort_nr:int, default_intern:int
--
-- Типи адрес: розшифровка ADRESSEN.ADR_WAHL (гість / фірма / …).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ADR_WAHL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DEFAULT_INTERN AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM ADR_AUSWAHL
WHERE TA_STATUS < 1000;
