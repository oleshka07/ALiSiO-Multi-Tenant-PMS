#!/usr/bin/env bash
#
# Apply the Postgres migrations this database has not seen yet.
#
#   ./deploy/migrate.sh prod        # applies what is pending
#   ./deploy/migrate.sh prod --list # says what would be applied, changes nothing
#
# Called by deploy.sh between the build and the restart. Runnable on its own
# when you need to see where a database stands.
#
# It exists because "накотити міграції" was a step a person had to remember,
# and every migration in db/postgres/migrations/ fails silently when skipped:
# 0005 makes fourteen INSERTs bounce off a policy, 0007 makes the entire guest
# portal answer 404, 0008 does the same the moment new code starts setting
# `app.public_token` against a database still checking `app.guest_token`.
# Nothing logs an error — the application just behaves as if a feature was
# never built. A step whose omission is invisible does not belong to a human.
#
# Ordering is by filename, which is why they are numbered. Each file is already
# a transaction of its own (BEGIN … COMMIT) and each is written to be
# re-runnable, so the worst case of a wrong ledger is wasted work, not damage.
set -euo pipefail

ENV_NAME="${1:-}"
LIST_ONLY="${2:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [--list]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'; }

DB_DRIVER_NOW="$(val DB_DRIVER)"
if [ "$DB_DRIVER_NOW" != "postgres" ]; then
  echo "==> $ENV_NAME is not on Postgres (DB_DRIVER='$DB_DRIVER_NOW') — nothing to migrate"
  exit 0
fi

PG_CONTAINER="alisio-${ENV_NAME}-postgres"
PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 \
  || { echo "no postgres container ($PG_CONTAINER) — start the stack first" >&2; exit 1; }

# psql as the OWNER, not as the application role: migrations create tables,
# change defaults and replace policies, none of which the application role may
# do — and must not be able to.
psql_run() {
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -q \
    -U "$PG_SUPERUSER" -d "$PG_DATABASE" "$@"
}

# The ledger. Deliberately not one of the application's tables: it describes
# the schema, is written only by this script, and must survive being read by a
# database whose schema is otherwise unknown.
psql_run -c '
  SET client_min_messages = warning;
  CREATE TABLE IF NOT EXISTS "schema_migrations" (
    "filename"   TEXT PRIMARY KEY,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now()
  );' >/dev/null

applied="$(psql_run -tAc 'SELECT filename FROM schema_migrations')"
applied_count="$(psql_run -tAc 'SELECT count(*) FROM schema_migrations' | tr -d ' ')"

pending=()
for f in db/postgres/migrations/*.sql; do
  name="$(basename "$f")"
  grep -qxF "$name" <<<"$applied" || pending+=("$f")
done

if [ ${#pending[@]} -eq 0 ]; then
  echo "==> $ENV_NAME: migrations up to date ($applied_count applied)"
  exit 0
fi

# First run on a database that predates the ledger: everything looks pending,
# and everything gets applied again. That is safe by construction — each file
# is written to be re-runnable, and deploy/../db/postgres/README.md says so —
# but say out loud what is about to happen, because "applying 0001" on a live
# production database should never arrive as a surprise in a log.
if [ "$applied_count" = "0" ] && [ ${#pending[@]} -gt 1 ]; then
  echo "    (no ledger yet — re-applying every migration once to establish it;"
  echo "     each one is re-runnable, so this changes nothing already in place)"
fi

echo "==> $ENV_NAME: ${#pending[@]} migration(s) pending"
for f in "${pending[@]}"; do echo "    $(basename "$f")"; done
if [ "$LIST_ONLY" = "--list" ]; then
  exit 0
fi

for f in "${pending[@]}"; do
  name="$(basename "$f")"
  echo "==> applying $name"
  # The file goes in on stdin, and its own BEGIN/COMMIT is the transaction.
  # ON_ERROR_STOP means a failure here stops the deploy, which is the point:
  # a half-migrated database serving new code is worse than a deploy that
  # did not happen.
  psql_run < "$f"
  psql_run -c "INSERT INTO schema_migrations (filename) VALUES ('$name')" >/dev/null
done

echo "==> $ENV_NAME: ${#pending[@]} migration(s) applied"
