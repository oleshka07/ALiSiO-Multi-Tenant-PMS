#!/usr/bin/env bash
# Витягання схеми і контрольних чисел з бази Winhotel.MX (Firebird 3, ODS 12.0).
#
# Це дослідницький інструмент, не код продукту: він живе в docs/research/winhotel/
# і ніколи не імпортується. Пише ЛИШЕ текст (DDL, лічильники, списки колонок).
# Рядків даних він не виводить, крім таблиць, названих у --sample явно — і це
# мають бути довідники без персональних даних (категорії, номери, послуги,
# ставки ПДВ, ціни, політики, джерела броні). Дивись REFERENCE-SAMPLES.md.
# Перед комітом виходу — PII-grep з README.md (імена колонок вендора виключені
# словом, не текою); він має бути порожнім.
#
# Використання (у контейнері з firebird3.0-utils і firebird3.0-server):
#   docs/research/winhotel/extract.sh <WINHOTEL.fbk | WINHOTEL.FDB> <вихідна тека> [--sample T1,T2,...]
#
# .fbk відновлюється gbak-ом у /tmp/winhotel-extract/ (embedded, без сервера:
# пароль SYSDBA у цьому режимі не перевіряється — перевірено 09.09.2026 на
# WHMXDOKUMENT.fbk з навмисно неправильним паролем). .FDB відкривається напряму,
# якщо ODS = 12.x; старший ODS (11.x = Firebird 2.5) isql-fb відхилить — тоді
# лише .fbk. База після роботи ВИДАЛЯЄТЬСЯ (крок 6), і це треба сказати у звіті.
set -euo pipefail

SRC="${1:?джерело: .fbk або .FDB}"
OUT="${2:?вихідна тека}"
SAMPLE=""
if [ "${3:-}" = "--sample" ]; then SAMPLE="${4:-}"; fi

WORK=/tmp/winhotel-extract
mkdir -p "$WORK" "$OUT"
DB="$WORK/winhotel.fdb"

ISQL="isql-fb -user SYSDBA -q"

# 1. База: відновити з .fbk або скопіювати .FDB (isql відкриває файл на запис).
case "$SRC" in
  *.fbk|*.FBK)
    echo "== gbak -c $SRC -> $DB"
    rm -f "$DB"
    gbak -c -v "$SRC" "$DB" -user SYSDBA 2>&1 | tail -3
    ;;
  *)
    echo "== copy $SRC -> $DB"
    cp "$SRC" "$DB"
    ;;
esac

# 2. Версія/ODS/кодування — у header.txt.
$ISQL "$DB" <<'SQL' > "$OUT/header.txt" 2>&1
SHOW VERSION;
SHOW DATABASE;
SQL
grep -E "ODS|Character|Creation|PAGE_SIZE|Firebird" "$OUT/header.txt" || true

# 3. Повний DDL — як є, без правок.
echo "== DDL"
isql-fb -user SYSDBA -x "$DB" > "$OUT/DDL.sql" 2> "$OUT/DDL.err" || true
if [ -s "$OUT/DDL.err" ]; then echo "DDL.err не порожній:"; head -5 "$OUT/DDL.err"; fi
echo "CREATE TABLE: $(grep -c '^CREATE TABLE' "$OUT/DDL.sql" || true)"

# 4. Список таблиць (без системних і без view) → по одному COUNT(*) на таблицю.
echo "== counts"
$ISQL "$DB" <<'SQL' 2>/dev/null | sed 's/[[:space:]]*$//' | grep -vE '^(RDB\$RELATION_NAME|=+)?$' > "$WORK/tables.txt"
SET HEADING OFF;
SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS
 WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL
 ORDER BY 1;
SQL
sed -i 's/^[[:space:]]*//' "$WORK/tables.txt"
echo "таблиць: $(wc -l < "$WORK/tables.txt")"

: > "$OUT/table-counts.tsv"
while read -r T; do
  [ -z "$T" ] && continue
  N=$($ISQL "$DB" <<SQL 2>/dev/null | tr -d ' \n' || true
SET HEADING OFF;
SELECT COUNT(*) FROM "$T";
SQL
)
  printf '%s\t%s\n' "$T" "${N:-ERR}" >> "$OUT/table-counts.tsv"
done < "$WORK/tables.txt"
sort -t$'\t' -k2,2nr "$OUT/table-counts.tsv" > "$OUT/table-counts.by-size.tsv"

# 5. Колонки кожної таблиці одним файлом — для пошуку за назвами
#    (BELEG, VERKN, GAST, ADR, RECHN, ZAHL, ZIMMER, KAT, LEIST, PREIS, SAISON,
#    STORNO, GUTSCHEIN, MWST, UST, TSE, DEBITOR, ANZAHL, SEGM, REFERENZ).
echo "== columns"
$ISQL "$DB" <<'SQL' 2>/dev/null > "$OUT/table-columns.tsv"
SET HEADING OFF;
SELECT TRIM(rf.RDB$RELATION_NAME) || '.' || TRIM(rf.RDB$FIELD_NAME) || '  ' ||
       CASE f.RDB$FIELD_TYPE
         WHEN 7 THEN 'SMALLINT' WHEN 8 THEN 'INTEGER' WHEN 16 THEN 'BIGINT'
         WHEN 10 THEN 'FLOAT' WHEN 27 THEN 'DOUBLE' WHEN 12 THEN 'DATE'
         WHEN 13 THEN 'TIME' WHEN 35 THEN 'TIMESTAMP' WHEN 14 THEN 'CHAR'
         WHEN 37 THEN 'VARCHAR' WHEN 261 THEN 'BLOB' ELSE 'T' || f.RDB$FIELD_TYPE END
       || COALESCE('(' || f.RDB$CHARACTER_LENGTH || ')', '')
  FROM RDB$RELATION_FIELDS rf
  JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
  JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
 WHERE r.RDB$SYSTEM_FLAG = 0
 ORDER BY rf.RDB$RELATION_NAME, rf.RDB$FIELD_POSITION;
SQL
sed -i 's/^[[:space:]]*//; s/[[:space:]]*$//; /^$/d' "$OUT/table-columns.tsv"

echo "== keyword hits (назви таблиць і колонок, не дані)"
grep -iE 'BELEG|VERKN|GAST|ADR|RECHN|ZAHL|ZIMMER|KAT|LEIST|PREIS|SAISON|STORNO|GUTSCHEIN|MWST|UST|TSE|DEBITOR|ANZAHL|SEGM|REFERENZ|PUBLIC|SIGNATUR|SERIAL' \
  "$OUT/table-columns.tsv" > "$OUT/keyword-hits.txt" || true
wc -l "$OUT/keyword-hits.txt"

# 6. Зразки — лише для явно названих довідників, по 10 рядків.
if [ -n "$SAMPLE" ]; then
  echo "== samples: $SAMPLE"
  : > "$OUT/samples.txt"
  IFS=',' read -ra TS <<< "$SAMPLE"
  for T in "${TS[@]}"; do
    {
      echo "-- $T"
      $ISQL "$DB" <<SQL 2>&1
SELECT FIRST 10 * FROM "$T";
SQL
      echo
    } >> "$OUT/samples.txt"
  done
fi

# 7. Агрегати для COUNTS-*.md — лише числа, жодного рядка даних. Кожен запит окремо:
#    невідома таблиця/колонка дає ERR у своєму рядку, а не зупиняє скрипт. Список
#    складено з MAPPING.md (10.09.2026); дати знімка підставляються з
#    max(RECHNUNG.DATUM_ZEIT), 2025-й рік — як рік знімка.
echo "== aggregates"
agg() {
  local label="$1" sql="$2" v
  v=$($ISQL "$DB" <<SQL 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; /^$/d' | tr '\n' ' ' | sed 's/ *$//' || true
SET HEADING OFF;
$sql
SQL
)
  printf '%s\t%s\n' "$label" "${v:-ERR}" >> "$OUT/aggregates.txt"
}
: > "$OUT/aggregates.txt"
agg "знімок: max RECHNUNG.DATUM_ZEIT"      "SELECT MAX(DATUM_ZEIT) FROM RECHNUNG;"
agg "знімок: max GASTKONT.ERF_DATUM"       "SELECT MAX(ERF_DATUM) FROM GASTKONT;"
agg "остання Rechnung-Nr (генератор)"      "SELECT GEN_ID(GEN_RECHNUNGNR, 0) FROM RDB\$DATABASE;"
agg "остання Rechnung-Nr (max, живі)"      "SELECT MAX(RECHNR), COUNT(*) FROM RECHNUNG WHERE TA_STATUS < 1000;"
agg "фактур у році знімка (живі)"          "SELECT COUNT(*) FROM RECHNUNG WHERE TA_STATUS < 1000 AND EXTRACT(YEAR FROM DATUM_ZEIT) = (SELECT EXTRACT(YEAR FROM MAX(DATUM_ZEIT)) FROM RECHNUNG);"
agg "фактур сторнованих"                   "SELECT COUNT(*) FROM RECHNUNG WHERE STORNO_KZ > 0;"
agg "броней (GASTKONT) живих"              "SELECT COUNT(*) FROM GASTKONT WHERE TA_STATUS < 1000;"
agg "броней із заїздом після знімка"       "SELECT COUNT(*) FROM GASTKONT WHERE TA_STATUS < 1000 AND VONAUFH > (SELECT CAST(MAX(DATUM_ZEIT) AS DATE) FROM RECHNUNG);"
agg "броней із заїздом у році знімка"      "SELECT COUNT(*) FROM GASTKONT WHERE TA_STATUS < 1000 AND EXTRACT(YEAR FROM VONAUFH) = (SELECT EXTRACT(YEAR FROM MAX(DATUM_ZEIT)) FROM RECHNUNG);"
agg "стани броней BUCH/CI/TA (код×N)"      "SELECT BUCH_STATUS, CI_STATUS, TA_STATUS, COUNT(*) FROM GASTKONT GROUP BY 1,2,3 ORDER BY 4 DESC;"
agg "BELEGUNG сміттєвих дат (<1900)"       "SELECT COUNT(*) FROM BELEGUNG WHERE ANREISE < '1900-01-01';"
agg "адрес живих"                          "SELECT COUNT(*) FROM ADRESSEN WHERE TA_STATUS < 1000;"
agg "адрес з номером дебітора"             "SELECT COUNT(*), MIN(DEBI_NR), MAX(DEBI_NR) FROM ADRESSEN WHERE DEBI_NR > 0 AND TA_STATUS < 1000;"
agg "адрес за типом ADR_WAHL (код×N)"      "SELECT ADR_WAHL, COUNT(*) FROM ADRESSEN WHERE TA_STATUS < 1000 GROUP BY 1;"
agg "адрес, що анонімізовані (DS_VORGENOMMEN)" "SELECT DS_VORGENOMMEN, COUNT(*) FROM ADRESSEN GROUP BY 1;"
agg "номерів справжніх / псевдо"           "SELECT SUM(CASE WHEN CAST(ZINR AS INTEGER) < 9000 THEN 1 ELSE 0 END), SUM(CASE WHEN CAST(ZINR AS INTEGER) >= 9000 THEN 1 ELSE 0 END) FROM ZIMMSTAM WHERE TA_STATUS < 1000 AND ZINR IS NOT NULL;"
agg "рядків рахунку (BUCHKONT) живих, сума" "SELECT COUNT(*), SUM(GBETRAG)/1000.0 FROM BUCHKONT WHERE TA_STATUS < 1000;"
agg "платежів живих, сума"                 "SELECT COUNT(*), SUM(BETRAG)/1000.0 FROM ZAHLUNGEN WHERE TA_STATUS < 1000;"
agg "платежів дебіторських (M_DEBITOR>0), сума" "SELECT COUNT(*), SUM(BETRAG)/1000.0 FROM ZAHLUNGEN WHERE TA_STATUS < 1000 AND M_DEBITOR > 0;"
agg "відкриті позиції по рахунках гостей (виїхали, offen<>0): N, сума" "EXECUTE BLOCK RETURNS (N INTEGER, SUMME NUMERIC(15,3)) AS DECLARE L INTEGER; DECLARE O NUMERIC(12,3); BEGIN N = 0; SUMME = 0; FOR SELECT LNR FROM GASTKONT WHERE TA_STATUS < 1000 AND CI_STATUS = 2 INTO :L DO BEGIN SELECT OFFEN_BETRAG FROM GET_OFFEN_ZAHLBETRAG(:L) INTO :O; IF (O IS NOT NULL AND O <> 0) THEN BEGIN N = N + 1; SUMME = SUMME + O; END END SUSPEND; END"
agg "книга вихідних рахунків за DB_STATUS (код×N×сума)" "SELECT DB_STATUS, COUNT(*), SUM(UMSATZ)/1000.0 FROM AUSGBUCH GROUP BY 1;"
agg "ваучерів продано (послуги 7/55/95): N, сума" "SELECT COUNT(*), SUM(GBETRAG)/1000.0 FROM BUCHKONT WHERE TA_STATUS < 1000 AND LEIST_LNR IN (7, 55, 95);"
agg "ваучерів погашено (спосіб оплати Gutschein): N, сума" "SELECT COUNT(*), SUM(Z.BETRAG)/1000.0 FROM ZAHLUNGEN Z JOIN DEVISEN D ON D.LNR = Z.LNR_DEVI WHERE Z.TA_STATUS < 1000 AND UPPER(D.BEZEICHN) LIKE '%GUTSCHEIN%';"
agg "реєстр ваучерів GUTSCHEINE (живі)"    "SELECT COUNT(*) FROM GUTSCHEINE WHERE TA_STATUS < 1000;"
agg "депозити на бронях (ANZA_BETRAG>0): N, сума" "SELECT COUNT(*), SUM(ANZA_BETRAG)/1000.0 FROM GASTKONT WHERE TA_STATUS < 1000 AND ANZA_BETRAG > 0;"
agg "TSE: підписаних рядків FISKAL_BK (SIGN_OK×N)" "SELECT SIGN_OK, COUNT(*) FROM FISKAL_BK GROUP BY 1;"
agg "TSE: квитанцій FISKAL_RECHNUNG"       "SELECT COUNT(*), MIN(DATUMZEIT), MAX(DATUMZEIT) FROM FISKAL_RECHNUNG;"
agg "сезонів на рік знімка"                "SELECT COUNT(*) FROM SAISSTAM WHERE TA_STATUS < 1000 AND EXTRACT(YEAR FROM VON) = (SELECT EXTRACT(YEAR FROM MAX(DATUM_ZEIT)) FROM RECHNUNG);"
agg "цінових рядків живих"                 "SELECT COUNT(*) FROM PREISLIST WHERE TA_STATUS < 1000;"
cat "$OUT/aggregates.txt"

# 8. Прибрати базу з контейнера. Джерело ($SRC) лишається на совісті того,
#    хто його поклав, — видаліть і його, коли закінчите.
rm -f "$DB"
echo "== база $DB видалена; результати в $OUT"
