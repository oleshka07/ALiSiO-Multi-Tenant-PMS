-- entity: occupancy
-- source: BELEGUNG
-- columns: lnr:int, lnr_gk:int, lnr_kate:int, lnr_zinr:int, anreise:date, abreise:date, status:int, anz_zi:int, gl_status:int
--
-- Дельта (задача 8 §3): лише рядки броней, що заїжджають або виїжджають у вікні {{FROM}}..{{TO}}
-- (або живуть у ньому наскрізь). Агент підставляє дати замість {{FROM}}/{{TO}}.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
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
WHERE TA_STATUS < 1000 AND LNR_GK IN (SELECT LNR FROM GASTKONT WHERE (VONAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR BISAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR (VONAUFH < '{{FROM}}' AND BISAUFH > '{{TO}}')));
