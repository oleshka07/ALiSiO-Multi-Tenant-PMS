-- entity: booking_refs
-- source: GASTKREF
-- columns: lnr:int, gk_lnr:int, ref_nr:text, inet_ref_nr:text, ext_source:text, ext_refnr:text, ref_storno:text, precheckin_done:bool, erf_datumzeit:ts
--
-- Дельта (задача 8 §3): лише рядки броней, що заїжджають або виїжджають у вікні {{FROM}}..{{TO}}
-- (або живуть у ньому наскрізь). Агент підставляє дати замість {{FROM}}/{{TO}}.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(REF_NR, '') || ASCII_CHAR(31)
  || COALESCE(INET_REF_NR, '') || ASCII_CHAR(31)
  || COALESCE(EXT_SOURCE, '') || ASCII_CHAR(31)
  || COALESCE(EXT_REFNR, '') || ASCII_CHAR(31)
  || COALESCE(REF_STORNO, '') || ASCII_CHAR(31)
  || COALESCE(CAST(PRECHECKIN_DONE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ERF_DATUMZEIT AS VARCHAR(24)), '') || ASCII_CHAR(30)
FROM GASTKREF
WHERE TA_STATUS < 1000 AND GK_LNR IN (SELECT LNR FROM GASTKONT WHERE (VONAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR BISAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR (VONAUFH < '{{FROM}}' AND BISAUFH > '{{TO}}')));
