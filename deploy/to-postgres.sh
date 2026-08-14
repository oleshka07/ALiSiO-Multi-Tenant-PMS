#!/usr/bin/env bash
#
# Move one environment from SQLite to Postgres.
#
#   ./deploy/to-postgres.sh beta --dry-run   # everything except the switch
#   ./deploy/to-postgres.sh beta
#   ./deploy/to-postgres.sh beta --fresh     # a NEW environment: no data to move
#
# Runs on the server, from /opt/alisio. Idempotent up to the import: the schema
# and the role are created only if absent, and the import refuses a database
# that already has rows.
#
# The order is the whole point. `DB_DRIVER=postgres` on an empty database is an
# application with no users, no bookings and no way in — so the switch is the
# last step, after the data is in and after row-level security has been proved
# to isolate.
#
# Rollback, at any point: remove DB_DRIVER from the env file and redeploy. The
# SQLite file is never written to, moved or deleted by this script.
set -euo pipefail

ENV_NAME="${1:-}"
DRY_RUN=""
REPLACE=""
FRESH=""
for opt in "${@:2}"; do
  case "$opt" in
    --dry-run) DRY_RUN=1 ;;
    # A second attempt at the same migration: the first found the schema wrong,
    # or the switch did not take, and the copy has to be made again. Empties
    # Postgres before importing. Never touches the SQLite file.
    --replace) REPLACE=--replace ;;
    # A brand-new environment has nothing to move. Steps 1–4 (server, role,
    # schema, proof that row-level security isolates) are exactly what it
    # needs; step 5 is the one that does not apply, because importing an
    # empty SQLite file into an empty Postgres is a no-op that can only fail.
    #
    # This exists because beta is new. Standing it up on SQLite "for now"
    # would have made it a rehearsal of an engine no customer runs — and
    # today two bugs reached production precisely because everything was
    # checked on SQLite.
    --fresh) FRESH=1 ;;
    *) echo "unknown option: $opt" >&2; exit 2 ;;
  esac
done

case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [--dry-run] [--replace] [--fresh]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
PROJECT="alisio-${ENV_NAME}"
COMPOSE="docker compose --env-file $ENV_FILE -p $PROJECT -f deploy/docker-compose.yml"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "./$ENV_FILE"; set +a

for v in PG_SUPERUSER_PASSWORD PG_APP_PASSWORD PG_PORT; do
  [ -n "${!v:-}" ] || { echo "$v is not set in $ENV_FILE" >&2; exit 1; }
done

PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="${PG_DATABASE:-alisio}"
PG_APP_USER="${PG_APP_USER:-alisio_app}"
CONTAINER="alisio-${ENV_NAME}-postgres"

psql_super() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_SUPERUSER" -d "$PG_DATABASE" "$@"; }

# ── 1. The database server ───────────────────────────────────────────────────
echo "==> starting postgres for $ENV_NAME"
$COMPOSE --profile postgres up -d postgres

echo "==> waiting for it to accept connections"
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$PG_SUPERUSER" -d "$PG_DATABASE" >/dev/null 2>&1; then break; fi
  [ "$i" = 30 ] && { echo "!! postgres did not become ready" >&2; docker logs --tail 40 "$CONTAINER" >&2; exit 1; }
  sleep 2
done

# ── 1a. Is this volume the one this env file describes? ──────────────────────
#
# `POSTGRES_PASSWORD` initialises the superuser ONCE, when the data directory
# is created. On a volume left over from an earlier attempt it is ignored
# entirely, so a freshly generated password in the env file simply does not
# match what is inside — and every later step fails on authentication.
#
# That is what happened on beta: the run reported a role created, a schema
# "already present", and then `password authentication failed for user
# alisio_admin` from a step three screens further down. The cause was two
# screens up, and nothing said so.
if ! psql_super -tAc 'SELECT 1' >/dev/null 2>&1; then
  echo "!! cannot connect to $PG_DATABASE as $PG_SUPERUSER" >&2
  echo "" >&2
  echo "   The password in $ENV_FILE is not the one inside this volume." >&2
  echo "   POSTGRES_PASSWORD only takes effect when the data directory is" >&2
  echo "   first created, so a volume from an earlier attempt keeps its own." >&2
  echo "" >&2
  echo "   On an environment with no data worth keeping, start it over:" >&2
  echo "     docker compose --env-file $ENV_FILE -p $PROJECT -f deploy/docker-compose.yml --profile postgres down" >&2
  echo "     docker volume rm ${PROJECT}_pg-data" >&2
  echo "     $0 $ENV_NAME --fresh" >&2
  echo "" >&2
  echo "   That volume belongs to $PROJECT only. Every other environment has" >&2
  echo "   its own, named after its own compose project." >&2
  exit 1
fi

# ── 2. The application's role ────────────────────────────────────────────────
# NOT the table owner. FORCE ROW LEVEL SECURITY in the schema covers the owner
# too, but relying on that alone means one table that someone adds without
# FORCE is a silent full-table read across every tenant.
echo "==> role $PG_APP_USER (not the owner of anything)"
psql_super <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$PG_APP_USER') THEN
    CREATE ROLE $PG_APP_USER LOGIN PASSWORD '$PG_APP_PASSWORD';
  ELSE
    ALTER ROLE $PG_APP_USER LOGIN PASSWORD '$PG_APP_PASSWORD';
  END IF;
END \$\$;
GRANT CONNECT ON DATABASE $PG_DATABASE TO $PG_APP_USER;
GRANT USAGE ON SCHEMA public TO $PG_APP_USER;
SQL

# ── 3. Schema ────────────────────────────────────────────────────────────────
#
# "Not zero" used to be the whole test, and "not zero" is not "complete". Beta
# came up with 92 tables against a schema that defines 102 — a database left
# behind by an earlier attempt, ten tables short. The script announced "schema
# already present" and carried on building on top of it.
#
# A count that is short means the tables were created by an older schema.sql.
# Loading the current one over it would leave a half-old database rather than
# fixing it, so this stops instead and says what to do. Being generous with a
# database that is nearly right is how an environment ends up different from
# production in ways nobody can list.
WANT="$(grep -c '^CREATE TABLE' db/postgres/schema.sql)"
TABLES="$(psql_super -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$TABLES" -eq 0 ]; then
  echo "==> loading schema ($WANT tables)"
  psql_super < db/postgres/schema.sql >/dev/null
elif [ "$TABLES" -lt "$WANT" ]; then
  echo "!! this database has $TABLES tables; db/postgres/schema.sql defines $WANT" >&2
  echo "" >&2
  echo "   It was built by an older schema and is missing $((WANT - TABLES)) of them." >&2
  echo "   Loading the current schema on top would leave it half-old, so this stops." >&2
  echo "" >&2
  echo "   On an environment with no data worth keeping, start it over:" >&2
  echo "     docker compose --env-file $ENV_FILE -p $PROJECT -f deploy/docker-compose.yml --profile postgres down" >&2
  echo "     docker volume rm ${PROJECT}_pg-data" >&2
  echo "     $0 $ENV_NAME --fresh" >&2
  echo "" >&2
  echo "   On one that HAS data, this is a migration question, not a setup one:" >&2
  echo "   run ./deploy/migrate.sh $ENV_NAME and check what it reports." >&2
  exit 1
else
  echo "==> schema already present ($TABLES tables)"
fi

psql_super <<SQL >/dev/null
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $PG_APP_USER;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $PG_APP_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $PG_APP_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $PG_APP_USER;
SQL

# ── 4. Proof that row-level security isolates ────────────────────────────────
# Before the data, not after: if the policies do not hold there is nothing to
# discuss, and finding that out with an empty database costs nothing.
echo "==> proving row-level security"
# 2>&1 matters: psql reports errors on stderr, and a log that captured only
# stdout said nothing but "BEGIN" when this check first failed.
if ! psql_super < db/postgres/rls-check.sql 2>&1 | tee "/tmp/rls-$ENV_NAME.log" | grep -q 'all checks passed'; then
  echo "!! rls-check did not pass — stopping before any data is moved" >&2
  tail -20 /tmp/rls-$ENV_NAME.log >&2
  exit 1
fi

# ── 5. Data ──────────────────────────────────────────────────────────────────
# The application is stopped first. The import is one-time and does not chase
# rows written while it runs, so a booking taken mid-import would be lost.
# The application reaches Postgres through the published loopback port; the
# import runs inside the compose network and reaches it by service name.
# By service name on the compose network, NOT the published 127.0.0.1:PG_PORT.
# That port is on the HOST's loopback; inside the application container
# 127.0.0.1 is the container, where nothing listens. The published port stays,
# so psql from the host keeps working.
APP_URL_CONTAINER="postgres://${PG_APP_USER}:${PG_APP_PASSWORD}@postgres:5432/${PG_DATABASE}"
SUPER_URL="postgres://${PG_SUPERUSER}:${PG_SUPERUSER_PASSWORD}@postgres:5432/${PG_DATABASE}"

if [ -n "$FRESH" ]; then
  echo "==> fresh environment: nothing to import, going straight to the switch"
else

echo "==> stopping the app"
$COMPOSE stop app

# In a container built from the application's own image: the server has no
# node_modules of its own — everything is built inside Docker — and that image
# already carries better-sqlite3, pg and scripts/. The SQLite volume is mounted
# READ-ONLY, so the import cannot write to the database it is reading, which is
# also the database the rollback depends on.
run_import() {
  docker run --rm \
    --network "${PROJECT}_default" \
    -v "${PROJECT}_app-data:/app/data:ro" \
    -e ALISIO_DB_PATH=/app/data/alisio.db \
    --entrypoint node \
    "alisio-pms:${ENV_NAME}" scripts/pg-import.mjs "$SUPER_URL" "$@"
}

echo "==> importing"
# The import writes past row-level security, so it connects as the superuser.
# The application never does.
if [ -n "$DRY_RUN" ]; then
  run_import --dry-run $REPLACE
  echo "==> dry run: starting the app back up on SQLite, nothing was switched"
  $COMPOSE up -d app
  exit 0
fi
run_import $REPLACE

fi

# ── 6. The switch ────────────────────────────────────────────────────────────
echo "==> switching $ENV_NAME to postgres"
if grep -q '^DB_DRIVER=' "$ENV_FILE"; then
  sed -i "s|^DB_DRIVER=.*|DB_DRIVER=postgres|" "$ENV_FILE"
else
  printf '\n# Set by deploy/to-postgres.sh. Remove this line to go back to SQLite.\nDB_DRIVER=postgres\n' >> "$ENV_FILE"
fi
if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${APP_URL_CONTAINER}|" "$ENV_FILE"
else
  printf 'DATABASE_URL=%s\n' "$APP_URL_CONTAINER" >> "$ENV_FILE"
fi

# Compose reads the SHELL first and --env-file only as a fallback, and line 37
# sourced this file back when both variables were still the scaffold's empty
# strings. Without re-exporting them, compose substitutes those empties and
# starts the app on SQLite while every step above reports success. That is not
# hypothetical: it is what happened to beta, and the health check below could
# not tell.
export DB_DRIVER=postgres
export DATABASE_URL="$APP_URL_CONTAINER"

$COMPOSE up -d app

# ── 7. Proof, not health ─────────────────────────────────────────────────────
# What stood here POSTed a bad login and accepted 401. A working application
# answers 401 to a wrong password — and so does one that cannot read app_users
# at all, which is exactly what a failed switch looks like. The check could not
# fail, and it did not: it passed beta while beta was still on SQLite.
rollback_hint() {
  echo "!! to go back: remove the DB_DRIVER line from $ENV_FILE and run ./deploy/deploy.sh $ENV_NAME" >&2
  echo "!! the SQLite file is untouched — nothing in this script writes to it" >&2
}

PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)"
echo "==> waiting for the app to answer on 127.0.0.1:${PORT}"
UP=""
for i in $(seq 1 45); do
  # Any non-5xx answer means the server is up. /login answers 308 here (Next
  # redirects it), so testing for 200 waited the full 90s and then blamed the
  # app for not starting.
  case "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/login" || true)" in
    2??|3??) UP=1; break ;;
  esac
  sleep 2
done
[ -n "$UP" ] || { echo "!! $ENV_NAME did not answer in 90s" >&2; $COMPOSE logs --tail 60 app >&2; rollback_hint; exit 1; }

# First question: is it on Postgres at all? This is the one the old check dodged.
IN_CONTAINER="$(docker inspect "alisio-${ENV_NAME}-app" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DB_DRIVER=' | cut -d= -f2)"
if [ "$IN_CONTAINER" != "postgres" ]; then
  echo "!! the container has DB_DRIVER='${IN_CONTAINER}', not postgres — the switch did not take" >&2
  rollback_hint
  exit 1
fi

# Second question: does it work? Real logins, two real organizations, and every
# cross-tenant assertion the project has. As the superuser, because it seeds
# from outside any request and row-level security refuses that to the
# application's role — correctly, which is the point.
echo "==> proving tenant isolation against postgres"
if docker run --rm \
  --network "${PROJECT}_default" \
  -v "$(pwd)/scripts:/app/scripts:ro" -v "$(pwd)/src:/app/src:ro" -w /app \
  -e DB_DRIVER=postgres \
  -e DATABASE_URL="$SUPER_URL" \
  -e BASE_URL="http://alisio-${ENV_NAME}-app:3000" \
  --entrypoint node "alisio-pms:${ENV_NAME}" scripts/check-isolation.mjs; then
  echo "==> $ENV_NAME is on postgres, and isolation holds"
  exit 0
fi

echo "!! $ENV_NAME is on postgres but the isolation check failed" >&2
$COMPOSE logs --tail 40 app >&2
rollback_hint
exit 1
