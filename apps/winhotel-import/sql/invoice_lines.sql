-- entity: invoice_lines
-- source: RECHNUNGSDRUCK
-- deleted: kept — рядки належать фактурам, які беруться всі
-- columns: lnr:int, rechnr:int, drucknr:int, gk_lnr:int, bk_lnr:int, leist_lnr:int, gastnr:int, von:date, bis:date, tage:int, me:int, bezeichn:text, ebetrag:amount, gbetrag:amount, gastname:text, gastvorname:text, gasttitel:text, gastanrede:text, zinr:text, m_debirechn:bool, lfdnr:int, arrang_sort:int
--
-- Рядки фактур як надруковано (крок 11): GASTNAME/ZINR — те, що на бланку; M_DEBIRECHN — дебіторська (Sammelrechnung).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECHNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DRUCKNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ME AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(EBETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GBETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(GASTNAME, '') || ASCII_CHAR(31)
  || COALESCE(GASTVORNAME, '') || ASCII_CHAR(31)
  || COALESCE(GASTTITEL, '') || ASCII_CHAR(31)
  || COALESCE(GASTANREDE, '') || ASCII_CHAR(31)
  || COALESCE(ZINR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_DEBIRECHN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LFDNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ARRANG_SORT AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM RECHNUNGSDRUCK
WHERE 1 = 1;
