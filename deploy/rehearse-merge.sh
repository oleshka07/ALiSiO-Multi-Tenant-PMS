#!/usr/bin/env bash
#
# Репетиція злиття гілки в прод — на КОПІЇ живої бази, до злиття.
#
#   ./deploy/rehearse-merge.sh prod                  # найсвіжіший дамп цього середовища
#   ./deploy/rehearse-merge.sh prod path/to.sql.gz   # конкретний дамп
#   ./deploy/rehearse-merge.sh beta
#
# Запускається з робочої копії ТІЄЇ гілки, яку збираються злити: міграції
# беруться з `db/postgres/migrations/` поруч, схема — з `db/postgres/schema.sql`
# поруч. Тобто питання, на яке відповідає скрипт: «що станеться з базою проду,
# якщо на неї накотити те, що лежить у цій гілці».
#
# Це те саме, що раніше було пʼятнадцятьма рядками прози в ARCHITECTURE §8
# (репетиція 64ff26a, 05.09.2026): відновити дамп → накотити міграції гілки →
# перевірити ізоляцію → накотити ще раз → порахувати. Проза не запускається;
# власник читав її і не міг повторити. Скрипт — може, і друкує числа, які
# кладуться у звіт.
#
# Кроки, і що кожен ловить:
#   1. відновлення дампа в ОДНОРАЗОВИЙ Postgres     дамп биті чи обрізаний
#   2. міграції, яких база ще не бачила (за журналом
#      `schema_migrations`, як `migrate.sh`)         міграція, що не переживає
#                                                     живих даних (CHECK на
#                                                     чужому значенні, NOT NULL
#                                                     на порожньому)
#   3. таблиць стало рівно стільки, скільки описує
#      `schema.sql` + журнал                          міграція, якої немає в
#                                                     схемі нового клієнта, або
#                                                     навпаки
#   4. `rls-check.sql` на мігрованій базі             політика, яку міграція
#                                                     переписала не так
#   5. ті самі міграції ще раз                        неідемпотентна міграція:
#                                                     другий деплой упаде там,
#                                                     де перший пройшов
#   6. `check-schema-drift` (якщо є psql і node)      schema.sql ≠ міграції —
#                                                     інакше це бігає в CI
#
# Читає лише копію. Живої бази не торкається, файл дампа не змінює. Одноразовий
# Postgres прибирається на виході, включно з падінням посередині.
#
# REHEARSE_LOCAL_PG=1 — локальні бінарники Postgres замість docker (той самий
# прапорець, що RESTORE_TEST_LOCAL_PG у restore-test.sh): CI, робочі сесії.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [dump.sql.gz]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

DUMP="${2:-}"
if [ -z "$DUMP" ]; then
  DUMP="$(ls -1t deploy/backups/alisio-${ENV_NAME}-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$DUMP" ] && [ -f "$DUMP" ] || {
  echo "no dump found for $ENV_NAME in deploy/backups/ — run ./deploy/backup.sh $ENV_NAME first" >&2
  exit 1
}

ENV_FILE="deploy/env.${ENV_NAME}"
PG_SUPERUSER="alisio_admin"
if [ -f "$ENV_FILE" ]; then
  V="$(grep -E '^PG_SUPERUSER=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  [ -n "$V" ] && PG_SUPERUSER="$V"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "==> репетиція злиття: гілка $BRANCH ($HEAD_SHA) на копію $ENV_NAME"
echo "    дамп: $DUMP ($(du -h "$DUMP" | cut -f1))"
START=$(date +%s)

FAIL=0
note_fail() { echo "!! $1" >&2; FAIL=1; }

# ── 1. Одноразовий Postgres із дампом ──────────────────────────────────────
DB=rehearse
if [ "${REHEARSE_LOCAL_PG:-}" = "1" ]; then
  PGBIN="$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || ls -d /usr/lib/postgresql/*/bin | tail -1)"
  WORK="$(mktemp -d)"
  PORT=54398
  cleanup() { su postgres -c "'$PGBIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
  trap cleanup EXIT
  chmod 777 "$WORK"
  su postgres -c "'$PGBIN/initdb' -D '$WORK/data' -U '$PG_SUPERUSER' --auth=trust" >/dev/null
  su postgres -c "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=127.0.0.1' -w start" >/dev/null
  PSQL=(psql -h 127.0.0.1 -p "$PORT" -U "$PG_SUPERUSER")
  "${PSQL[@]}" -d postgres -qc "CREATE ROLE alisio_app LOGIN" 2>/dev/null || true
  "${PSQL[@]}" -d postgres -qc "CREATE DATABASE $DB" >/dev/null
  echo "==> відновлення (локальний Postgres $("$PGBIN/psql" --version | grep -oE '[0-9]+' | head -1 || true))"
  gunzip -c "$DUMP" | "${PSQL[@]}" -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null
  Q() { "${PSQL[@]}" -d "$DB" -tAc "$1"; }
  RUN_FILE() { "${PSQL[@]}" -d "$DB" -q -v ON_ERROR_STOP=1 < "$1"; }
  DRIFT_ENV=(PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER="$PG_SUPERUSER")
else
  CONTAINER="alisio-rehearse-$$"
  PORT=54398
  cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  # Порт лише на loopback і лише для check-schema-drift, якому потрібен psql
  # з хоста; без psql на хості крок 6 пропускається з поясненням.
  docker run -d --name "$CONTAINER" -p "127.0.0.1:${PORT}:5432" \
    -e POSTGRES_USER="$PG_SUPERUSER" -e POSTGRES_PASSWORD=rehearse \
    -e POSTGRES_DB="$DB" postgres:16-alpine >/dev/null
  for i in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U "$PG_SUPERUSER" -d "$DB" >/dev/null 2>&1 && break
    [ "$i" = 30 ] && { echo "!! одноразовий postgres так і не піднявся" >&2; exit 1; }
    sleep 2
  done
  docker exec "$CONTAINER" psql -U "$PG_SUPERUSER" -d postgres -qc "CREATE ROLE alisio_app LOGIN" 2>/dev/null || true
  echo "==> відновлення (postgres:16-alpine, одноразовий контейнер)"
  gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U "$PG_SUPERUSER" -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null
  Q() { docker exec "$CONTAINER" psql -U "$PG_SUPERUSER" -d "$DB" -tAc "$1"; }
  RUN_FILE() { docker exec -i "$CONTAINER" psql -U "$PG_SUPERUSER" -d "$DB" -q -v ON_ERROR_STOP=1 < "$1"; }
  DRIFT_ENV=(PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER="$PG_SUPERUSER" PGPASSWORD=rehearse)
fi

count_tables()   { Q "SELECT count(*) FROM pg_tables WHERE schemaname='public'" | tr -d ' '; }
count_policies() { Q 'SELECT count(*) FROM pg_policies' | tr -d ' '; }
count_rows()     { Q "SELECT count(*) FROM $1" | tr -d ' '; }

TABLES_0="$(count_tables)"; POLICIES_0="$(count_policies)"
ORGS="$(count_rows organizations)"; RES="$(count_rows reservations)"
echo "    до міграцій: таблиць $TABLES_0, політик $POLICIES_0, організацій $ORGS, бронювань $RES"
[ "$RES" -gt 0 ] 2>/dev/null || note_fail "reservations порожня — дамп биті або обрізаний; репетиція на порожній базі нічого не доводить"

# ── 2. Міграції гілки, яких база ще не бачила — за журналом, як migrate.sh ─
Q 'CREATE TABLE IF NOT EXISTS "schema_migrations" ("filename" TEXT PRIMARY KEY, "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now())' >/dev/null
APPLIED="$(Q 'SELECT filename FROM schema_migrations')"
APPLIED_N="$(Q 'SELECT count(*) FROM schema_migrations' | tr -d ' ')"

PENDING=()
for f in db/postgres/migrations/*.sql; do
  name="$(basename "$f")"
  grep -qxF "$name" <<<"$APPLIED" || PENDING+=("$f")
done
echo "==> у журналі $APPLIED_N міграцій; гілка несе ${#PENDING[@]} нових"
[ ${#PENDING[@]} -gt 0 ] && printf '    %s\n' "${PENDING[@]##*/}"

MIG_START=$(date +%s%3N)
for f in "${PENDING[@]}"; do
  if ! RUN_FILE "$f"; then
    note_fail "міграція $(basename "$f") впала на живих даних — саме це репетиція й мала зловити"
    break
  fi
  Q "INSERT INTO schema_migrations (filename) VALUES ('$(basename "$f")')" >/dev/null
done
MIG_MS=$(( $(date +%s%3N) - MIG_START ))

TABLES_1="$(count_tables)"; POLICIES_1="$(count_policies)"
echo "    після: таблиць $TABLES_1, політик $POLICIES_1, за ${MIG_MS} мс"

# ── 3. Стільки ж таблиць, скільки описує schema.sql нового клієнта + журнал ─
EXPECT_TABLES="$(( $(grep -c '^CREATE TABLE "' db/postgres/schema.sql || true) + 1 ))"
if [ "$TABLES_1" = "$EXPECT_TABLES" ]; then
  echo "    таблиць рівно як у schema.sql + schema_migrations ($EXPECT_TABLES) — ok"
else
  note_fail "таблиць $TABLES_1, а schema.sql гілки описує $(( EXPECT_TABLES - 1 )) + журнал = $EXPECT_TABLES: міграція і схема нового клієнта розійшлись"
fi

# ── 4. Ізоляція орендарів на МІГРОВАНІЙ базі ───────────────────────────────
if RUN_FILE db/postgres/rls-check.sql 2>&1 | grep -q 'all checks passed'; then
  echo "    rls-check.sql — усі твердження ok"
else
  note_fail "rls-check.sql не пройшов на мігрованій базі — політика, яку міграція переписала не так"
fi

# ── 5. Ті самі міграції ще раз — ідемпотентність ───────────────────────────
if [ ${#PENDING[@]} -gt 0 ]; then
  AGAIN_FAIL=0
  for f in "${PENDING[@]}"; do
    RUN_FILE "$f" || { note_fail "повторний накат $(basename "$f") впав: другий деплой зупиниться там, де перший пройшов"; AGAIN_FAIL=1; break; }
  done
  [ "$AGAIN_FAIL" = 0 ] && echo "    повторний накат ${#PENDING[@]} міграцій — без помилки (ідемпотентність)"
fi

# ── 6. schema.sql ≡ міграції — коли є чим питати ───────────────────────────
if command -v psql >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  if env "${DRIFT_ENV[@]}" node scripts/check-schema-drift.mjs; then
    echo "    check-schema-drift — збігаються"
  else
    note_fail "check-schema-drift: schema.sql і міграції гілки дають різні бази"
  fi
else
  echo "    check-schema-drift пропущено: на хості немає psql або node — його тримає CI на кожен push"
fi

ELAPSED=$(( $(date +%s) - START ))
printf '==> репетиція зайняла %d хв %d с\n' $((ELAPSED/60)) $((ELAPSED%60))
echo "    у звіт: таблиць $TABLES_0 → $TABLES_1, політик $POLICIES_0 → $POLICIES_1, міграцій +${#PENDING[@]} за ${MIG_MS} мс, організацій $ORGS, бронювань $RES"

if [ "$FAIL" = 1 ]; then
  echo "!! репетиція злиття: FAILED — у прод це не зливається" >&2
  exit 1
fi
echo "==> репетиція злиття: OK — гілку можна зливати, деплой накотить рівно ці міграції"
