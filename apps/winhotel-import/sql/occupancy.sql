-- entity: occupancy
-- source: BELEGUNG
-- columns: lnr:int, lnr_gk:int, lnr_kate:int, lnr_zinr:int, anreise:date, abreise:date, status:int, anz_zi:int, gl_status:int
--
-- Зайнятість (крок 9): по рядку на сегмент перебування; кілька рядків на LNR_GK з різними номерами — переселення.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_GK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_KATE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_ZINR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANREISE AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ABREISE AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_ZI AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GL_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM BELEGUNG
WHERE TA_STATUS < 1000;
