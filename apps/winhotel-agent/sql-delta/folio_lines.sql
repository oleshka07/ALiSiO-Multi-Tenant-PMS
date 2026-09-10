-- entity: folio_lines
-- source: BUCHKONT
-- columns: lnr:int, gk_lnr:int, leist_lnr:int, von:date, bis:date, tage:int, me:int, prl_lnr:int, bezeichn:text, aufp:int, zipreis:bool, pausch:bool, gbetrag:amount, tagbetrag:amount, e_preis:amount, ta_status:int, zahlung_lnr:int, umb_gk_lnr:int, lnr_co:int, re_lauf:int, rechnr:int, online_gebucht:bool, basis_lnr:int, sto_kennung:int, gs_lnr:int, erf_datum:date, kor_datum:date
--
-- Дельта (задача 8 §3): лише рядки броней, що заїжджають або виїжджають у вікні {{FROM}}..{{TO}}
-- (або живуть у ньому наскрізь). Агент підставляє дати замість {{FROM}}/{{TO}}.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ME AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PRL_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(AUFP AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZIPREIS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PAUSCH AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GBETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAGBETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(E_PREIS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TA_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZAHLUNG_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(UMB_GK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_CO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RE_LAUF AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECHNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ONLINE_GEBUCHT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BASIS_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STO_KENNUNG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GS_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ERF_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KOR_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(30)
FROM BUCHKONT
WHERE TA_STATUS < 1000 AND GK_LNR IN (SELECT LNR FROM GASTKONT WHERE (VONAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR BISAUFH BETWEEN '{{FROM}}' AND '{{TO}}' OR (VONAUFH < '{{FROM}}' AND BISAUFH > '{{TO}}')));
