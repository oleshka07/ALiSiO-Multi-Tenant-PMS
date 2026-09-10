-- entity: payments
-- source: ZAHLUNGEN
-- columns: lnr:int, mand_nr:int, budat:date, uhrzeit:time, lnr_devi:int, bezeichn:text, betrag:amount, gastnr_1:int, lnr_gk:int, re_nr:int, tatigk:text, kurs_fakt:amount, re_lauf:int, userid:int, tg_abs:int, m_debitor:int, woher:int, mahns:int, leist_lnr:int, lnr_co:int, debi_bez_betr:amount, tag_abs_lnr:int, signatur_ok:int, gastauslage:bool, gs_extern_key:text, gs_extern_gsnr:int
--
-- Дельта (задача 8 §3): лише рядки броней, що заїжджають або виїжджають у вікні {{FROM}}..{{TO}}
-- (або живуть у ньому наскрізь). Агент підставляє дати замість {{FROM}}/{{TO}}.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BUDAT AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(UHRZEIT AS VARCHAR(13)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_DEVI AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTNR_1 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_GK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RE_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(TATIGK, '') || ASCII_CHAR(31)
  || COALESCE(CAST(KURS_FAKT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RE_LAUF AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(USERID AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TG_ABS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_DEBITOR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WOHER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAHNS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_CO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DEBI_BEZ_BETR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAG_ABS_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SIGNATUR_OK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTAUSLAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(GS_EXTERN_KEY, '') || ASCII_CHAR(31)
  || COALESCE(CAST(GS_EXTERN_GSNR AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM ZAHLUNGEN
WHERE TA_STATUS < 1000 AND LNR_GK IN (SELECT LNR FROM GASTKONT WHERE (VONAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR BISAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR (VONAUFH < '{{FROM}}' AND BISAUFH > '{{TO}}')));
