-- entity: age_bands
-- source: ADRESSEN_ALTER_KREIS
-- columns: lnr:int, mand_nr:int, von_alter:int, bis_alter:int, alter_kreis:int, age_code:text
--
-- Вікові вилки дітей → organizations.child_age_bands (IMPORT-PLAN §2.12).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON_ALTER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS_ALTER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ALTER_KREIS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(AGE_CODE, '') || ASCII_CHAR(30)
FROM ADRESSEN_ALTER_KREIS
WHERE TA_STATUS < 1000;
