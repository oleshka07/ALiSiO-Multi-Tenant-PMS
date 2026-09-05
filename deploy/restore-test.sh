#!/usr/bin/env bash
#
# Prove the latest backup actually restores — and measure how long it takes.
#
#   ./deploy/restore-test.sh prod                 # freshest dump of that env
#   ./deploy/restore-test.sh prod path/to.sql.gz  # a specific dump
#
# A backup nobody has restored is indistinguishable from a good one until the
# day it is needed — this repository already lived that once, when every deploy
# archived a SQLite volume that had stopped changing and the live database had
# no backup at all. So this does the whole drill against a THROWAWAY Postgres:
# restore, count the bookings, check the data is recent, print the time. That
# time is the project's real RTO; before this script existed it was unknown.
#
# Checks, and what each catches:
#   rows in reservations > 0     an empty or truncated dump
#   newest created_at fresh      a dump that is quietly weeks old — UNLESS the
#                                LIVE database's newest row is just as old: a
#                                sleeping hotel is not a dead backup, so that
#                                case is green with a note. FAILED here means
#                                the dump lags the live database by more than
#                                the dump file's own age — rows that already
#                                existed at dump time are missing from it.
#   newest dump file fresh       cron stopped producing dumps at all
#
# Runs weekly from cron (setup-backup-cron.sh) and by hand before anything
# scary. Read-only towards the real database: it only ever touches the copy.
#
# RESTORE_TEST_LOCAL_PG=1 uses local Postgres binaries (initdb/pg_ctl) instead
# of docker — for environments that have Postgres but no docker daemon, such
# as CI runners and remote work sessions. Same restore, same checks.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [dump.sql.gz]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

# Data freshness threshold, hours. Deliberately looser than the backup-age
# threshold (30h): the newest RESERVATION being two quiet days old is a small
# hotel's weekend, not a broken backup. Override: MAX_DATA_AGE_H=24 …
MAX_DATA_AGE_H="${MAX_DATA_AGE_H:-72}"
MAX_DUMP_AGE_H="${MAX_DUMP_AGE_H:-30}"

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

DUMP_AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$DUMP") ) / 3600 ))
echo "==> restore test: $DUMP (файлу ${DUMP_AGE_H} год)"
START=$(date +%s)

FAIL=0
note_fail() { echo "!! $1" >&2; FAIL=1; }

# ── Bring up an empty Postgres 16 and load the dump into it ─────────────────
if [ "${RESTORE_TEST_LOCAL_PG:-}" = "1" ]; then
  PGBIN="$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || ls -d /usr/lib/postgresql/*/bin | tail -1)"
  WORK="$(mktemp -d)"
  cleanup() { su postgres -c "'$PGBIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
  trap cleanup EXIT
  chmod 777 "$WORK"
  su postgres -c "'$PGBIN/initdb' -D '$WORK/data' -U '$PG_SUPERUSER' --auth=trust" >/dev/null
  su postgres -c "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p 54399 -k $WORK -c listen_addresses='' ' -w start" >/dev/null
  PSQL=(psql -h "$WORK" -p 54399 -U "$PG_SUPERUSER")
  "${PSQL[@]}" -d postgres -qc "CREATE ROLE alisio_app LOGIN" 2>/dev/null || true
  "${PSQL[@]}" -d postgres -qc "CREATE DATABASE restore_test" >/dev/null
  echo "==> restoring (local Postgres $("$PGBIN/psql" --version | grep -oE '[0-9]+' | head -1))"
  gunzip -c "$DUMP" | "${PSQL[@]}" -d restore_test -q -v ON_ERROR_STOP=1 >/dev/null
  Q() { "${PSQL[@]}" -d restore_test -tAc "$1"; }
else
  CONTAINER="alisio-restore-test-$$"
  cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  # No ports published, no volume: the copy dies with the container.
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_USER="$PG_SUPERUSER" -e POSTGRES_PASSWORD=restore-test \
    -e POSTGRES_DB=restore_test postgres:16-alpine >/dev/null
  for i in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U "$PG_SUPERUSER" -d restore_test >/dev/null 2>&1 && break
    [ "$i" = 30 ] && { echo "!! throwaway postgres never came up" >&2; exit 1; }
    sleep 2
  done
  # The app role exists on the real server, so the dump's GRANTs name it.
  docker exec "$CONTAINER" psql -U "$PG_SUPERUSER" -d postgres \
    -qc "CREATE ROLE alisio_app LOGIN" 2>/dev/null || true
  echo "==> restoring (postgres:16-alpine, throwaway container)"
  gunzip -c "$DUMP" | docker exec -i "$CONTAINER" \
    psql -U "$PG_SUPERUSER" -d restore_test -q -v ON_ERROR_STOP=1 >/dev/null
  Q() { docker exec "$CONTAINER" psql -U "$PG_SUPERUSER" -d restore_test -tAc "$1"; }
fi

# ── The questions that make it a test rather than a demo ────────────────────
ROWS="$(Q 'SELECT count(*) FROM reservations' | tr -d ' ')"
TABLES="$(Q "SELECT count(*) FROM pg_tables WHERE schemaname='public'" | tr -d ' ')"
POLICIES="$(Q 'SELECT count(*) FROM pg_policies' | tr -d ' ')"
DATA_AGE_H="$(Q "SELECT COALESCE(floor(extract(epoch from now()-max(created_at))/3600)::int, -1) FROM reservations" | tr -d ' ')"

# Скільки таблиць МАЄ бути, і чому число не збігається зі schema.sql.
#
# `schema.sql` описує базу нового клієнта. Жива база має рівно на одну
# таблицю більше — `schema_migrations`, журнал накочених міграцій, який
# створює сам `migrate.sh` і якого немає ні в SQLite, ні в генераторі схеми.
#
# Це питали вголос: «у нас 104 чи 105?». Обидва числа правильні, просто про
# різні бази — 104 у схемі, 105 на розгорнутій. Тому очікуване рахується
# ТУТ-таки зі schema.sql, а не тримається в голові: додалась таблиця —
# змінились обидва числа разом, і ця перевірка не почне брехати.
EXPECT_TABLES="$(( $(grep -c '^CREATE TABLE "' "$(dirname "$0")/../db/postgres/schema.sql" || true) + 1 ))"

echo "    таблиць: $TABLES (очікувано $EXPECT_TABLES = schema.sql + schema_migrations)   RLS-політик: $POLICIES   бронювань: $ROWS"
[ "$TABLES" = "$EXPECT_TABLES" ] 2>/dev/null || note_fail \
  "таблиць $TABLES, а schema.sql описує $(( EXPECT_TABLES - 1 )) + журнал міграцій = $EXPECT_TABLES. Дамп зі старішої схеми, або міграція не накотилась"
[ "$ROWS" -gt 0 ] 2>/dev/null || note_fail "reservations порожня — дамп биті або обрізаний"
[ "$POLICIES" -gt 0 ] 2>/dev/null || note_fail "жодної RLS-політики — відновлена база не ізолює орендарів"

# ── Спадок першого клієнта не має повернутися ЧЕРЕЗ ДАНІ ────────────────────
# Код тримає check-no-tenant-names.mjs; дамп — оцей греп. Чистку зроблено
# 2026-08-28 (purge-tenant.sh). Маркер «сауна/купіль» знято 05.09.2026 разом
# із вирізанням сауно-чано-флоу з віджета (П17, Блок 0.3): сауна — звичайна
# послуга будь-якого готелю, і слово в дампі більше не означає спадок. Лишились
# лише власні назви першого клієнта (вузькі зразки — у FORBIDDEN_IN_CODE
# гейта check-no-tenant-names.mjs).
LEGACY_MARKERS='глемпінг|glamping|карпатськ|kemp[ -]?carlsbad|kempcarlsbad|luhačovic|лугачовіце|buchlov|бухлов|lešná|лешна|будов[аиуі] [fd]'
LEGACY_HITS="$(zcat "$DUMP" | grep -aciE "$LEGACY_MARKERS" || true)"
if [ "${LEGACY_HITS:-0}" -gt 0 ]; then
  note_fail "у дампі $LEGACY_HITS рядків зі спадком першого клієнта (глемпінг/назви/…) — purge-tenant не завершився або спадок повернувся крізь дані"
  zcat "$DUMP" | grep -aiE "$LEGACY_MARKERS" | head -3 | sed 's/^/      /'
fi

# «Несвіжі дані в дампі» має два прочитання, і лише одне — поломка.
# Порівнюємо вік останнього запису в ДАМПІ з віком того самого запису в
# ЖИВІЙ базі: збігаються (з поправкою на вік самого файла — рядки, що
# зʼявилися ПІСЛЯ зняття дампа, відставанням не є) — бекап чесний, база
# просто спить, і 2026-08-28 саме так виглядав прод без операційної
# активності з 31 липня. Дамп, що відстає сильніше, ніж міг би, — не бачить
# рядків, які вже існували на момент зняття: ось це FAILED.
LIVE_AGE_H=""
LIVE_PG_CONTAINER="alisio-${ENV_NAME}-postgres"
if [ "${RESTORE_TEST_LOCAL_PG:-}" != "1" ] && docker inspect "$LIVE_PG_CONTAINER" >/dev/null 2>&1; then
  LIVE_DB="$(grep -E '^PG_DATABASE=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  LIVE_AGE_H="$(docker exec "$LIVE_PG_CONTAINER" psql -U "$PG_SUPERUSER" -d "${LIVE_DB:-alisio}" -tAc \
    "SELECT COALESCE(floor(extract(epoch from now()-max(created_at))/3600)::int, -1) FROM reservations" \
    2>/dev/null | tr -d ' ')" || LIVE_AGE_H=""
fi

if [ "$DATA_AGE_H" = "-1" ]; then
  note_fail "у reservations немає жодного created_at"
elif [ "$DATA_AGE_H" -gt "$MAX_DATA_AGE_H" ]; then
  if [ -n "$LIVE_AGE_H" ] && [ "$LIVE_AGE_H" != "-1" ] && [ "$LIVE_AGE_H" -ge 0 ] 2>/dev/null; then
    LAG_H=$(( DATA_AGE_H - LIVE_AGE_H ))
    if [ "$LAG_H" -le $(( DUMP_AGE_H + 1 )) ]; then
      echo "    база спить, бекап чесний: останній запис і в живій базі ${LIVE_AGE_H} год тому"
      echo "    (у дампі ${DATA_AGE_H} год; різниця в межах віку самого файла — ${DUMP_AGE_H} год)"
    else
      note_fail "дамп ВІДСТАЄ від живої бази: живій останній запис ${LIVE_AGE_H} год тому, дампу — ${DATA_AGE_H} год, а сам файл лише ${DUMP_AGE_H} год. Рядки, що вже існували на момент зняття, у дамп не потрапили — бекапиться не та база або не той обсяг"
    fi
  else
    note_fail "останнє бронювання в дампі старше ${MAX_DATA_AGE_H} год (${DATA_AGE_H} год), а живу базу порівняти не вдалося (контейнер ${LIVE_PG_CONTAINER} недоступний) — «мертвий бекап» від «сплячої бази» звідси не відрізнити"
  fi
else
  echo "    останній запис у дампі: ${DATA_AGE_H} год тому (поріг ${MAX_DATA_AGE_H})"
fi

if [ "$DUMP_AGE_H" -gt "$MAX_DUMP_AGE_H" ]; then
  note_fail "найсвіжіший дамп старший ${MAX_DUMP_AGE_H} год (${DUMP_AGE_H} год) — розклад бекапів мертвий"
fi

ELAPSED=$(( $(date +%s) - START ))
printf '==> час відновлення і перевірок: %d хв %d с — це і є RTO цього дампа\n' \
  $((ELAPSED/60)) $((ELAPSED%60))

if [ "$FAIL" = 1 ]; then
  echo "!! restore test: FAILED — бекап, який не відновлюється, це не бекап" >&2
  exit 1
fi
echo "==> restore test: OK"
