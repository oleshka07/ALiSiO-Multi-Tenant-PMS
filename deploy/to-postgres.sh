#!/usr/bin/env bash
#
# Move one environment from SQLite to Postgres.
#
#   ./deploy/to-postgres.sh beta --dry-run   # everything except the switch
#   ./deploy/to-postgres.sh beta
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
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1

case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [--dry-run]" >&2; exit 2 ;;
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
TABLES="$(psql_super -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$TABLES" -eq 0 ]; then
  echo "==> loading schema"
  psql_super < db/postgres/schema.sql >/dev/null
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
if ! psql_super < db/postgres/rls-check.sql | tee /tmp/rls-$ENV_NAME.log | grep -q 'all checks passed'; then
  echo "!! rls-check did not pass — stopping before any data is moved" >&2
  tail -20 /tmp/rls-$ENV_NAME.log >&2
  exit 1
fi

# ── 5. Data ──────────────────────────────────────────────────────────────────
# The application is stopped first. The import is one-time and does not chase
# rows written while it runs, so a booking taken mid-import would be lost.
APP_URL_LOCAL="postgres://${PG_APP_USER}:${PG_APP_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}"
SUPER_URL="postgres://${PG_SUPERUSER}:${PG_SUPERUSER_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}"

SQLITE_HOST_COPY="/tmp/alisio-${ENV_NAME}-import.db"
echo "==> stopping the app and copying its database out"
$COMPOSE stop app
docker run --rm -v "${PROJECT}_app-data:/d:ro" -v /tmp:/out alpine \
  sh -c "cp /d/alisio.db /out/$(basename "$SQLITE_HOST_COPY")"

echo "==> importing"
# The import writes past row-level security, so it runs as the superuser; the
# application never does.
if [ -n "$DRY_RUN" ]; then
  ALISIO_DB_PATH="$SQLITE_HOST_COPY" node scripts/pg-import.mjs "$SUPER_URL" --dry-run
  echo "==> dry run: starting the app back up on SQLite, nothing was switched"
  $COMPOSE up -d app
  exit 0
fi
ALISIO_DB_PATH="$SQLITE_HOST_COPY" node scripts/pg-import.mjs "$SUPER_URL"
rm -f "$SQLITE_HOST_COPY"

# ── 6. The switch ────────────────────────────────────────────────────────────
echo "==> switching $ENV_NAME to postgres"
if grep -q '^DB_DRIVER=' "$ENV_FILE"; then
  sed -i "s|^DB_DRIVER=.*|DB_DRIVER=postgres|" "$ENV_FILE"
else
  printf '\n# Set by deploy/to-postgres.sh. Remove this line to go back to SQLite.\nDB_DRIVER=postgres\n' >> "$ENV_FILE"
fi
if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${APP_URL_LOCAL}|" "$ENV_FILE"
else
  printf 'DATABASE_URL=%s\n' "$APP_URL_LOCAL" >> "$ENV_FILE"
fi

$COMPOSE up -d app

# ── 7. Health, which means the database answered ─────────────────────────────
PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)"
echo "==> waiting for health on 127.0.0.1:${PORT}"
for i in $(seq 1 45); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"pg-health@example.invalid","password":"x"}' || true)"
  case "$CODE" in
    401|400) echo "==> $ENV_NAME is on postgres and answering (health $CODE)"; exit 0 ;;
    500|502|503)
      echo "!! $ENV_NAME answers $CODE on a database-backed route" >&2
      $COMPOSE logs --tail 40 app >&2
      echo "!! to go back: remove DB_DRIVER from $ENV_FILE and run ./deploy/deploy.sh $ENV_NAME" >&2
      exit 1
      ;;
  esac
  sleep 2
done

echo "!! $ENV_NAME did not become healthy in 90s" >&2
$COMPOSE logs --tail 60 app >&2
echo "!! to go back: remove DB_DRIVER from $ENV_FILE and run ./deploy/deploy.sh $ENV_NAME" >&2
exit 1
