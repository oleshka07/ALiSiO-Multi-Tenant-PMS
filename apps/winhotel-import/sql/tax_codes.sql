-- entity: tax_codes
-- source: STEUSTAM
-- columns: lnr:int, mand_nr:int, von:date, bis:date, sts:int, stsatz:int, stland:text, stbemerk:text, fiskal_zuweisung:int, sts_kasse:text
--
-- Ставки ПДВ (крок 2): STS — код (1 нуль / 2 знижена / 3 стандартна), STSATZ — відсоток, VON–BIS — чинність.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STSATZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(STLAND, '') || ASCII_CHAR(31)
  || COALESCE(STBEMERK, '') || ASCII_CHAR(31)
  || COALESCE(CAST(FISKAL_ZUWEISUNG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(STS_KASSE, '') || ASCII_CHAR(30)
FROM STEUSTAM
WHERE TA_STATUS < 1000;
