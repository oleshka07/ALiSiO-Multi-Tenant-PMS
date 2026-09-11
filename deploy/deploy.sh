#!/usr/bin/env bash
#
# Deploy one environment.
#
#   ./deploy/deploy.sh beta      # from the beta branch
#   ./deploy/deploy.sh prod      # from main
#
# Backs the database up first: the flow is beta -> verify -> prod, and the
# whole point of that flow is that a bad prod deploy can be undone.
#
# ── Two ways in ──────────────────────────────────────────────────────────────
#
#   ./deploy/deploy.sh prod
#       builds the image here. The fallback: works with nothing but a checkout
#       and docker, which is what you want at 3 a.m. when GitHub is down.
#
#   APP_IMAGE=ghcr.io/…:<sha> DEPLOY_SHA=<sha> ./deploy/deploy.sh prod
#       pulls that image instead of compiling. This is what CI does.
#
# The second exists because the first, on this machine, is what filled the
# disk. Building a Next.js image needs the source, node_modules and the whole
# `.next` output inside a builder layer; five deploys in one day left 75 GB at
# 100 %, Postgres died mid-write on "No space left on device" and every project
# on the server answered 502 — the PMS, and the three unrelated ones sharing
# the box. A 4 GB VPS whose job is to serve a hotel should not also be a build
# machine.
#
# DEPLOY_SHA is not decoration. Without it the script resets to the branch tip,
# which can already be a commit newer than the one the image was built from —
# and then the container runs one version while the checkout, the migrations
# and `hotels/` come from another. Nothing would report that. With it, the code
# on disk is the code inside the image by construction.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod) BRANCH=main ;;
  beta) BRANCH=beta ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
PROJECT="alisio-${ENV_NAME}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — copy ${ENV_FILE}.example and fill it in" >&2; exit 1; }

# A blank APP_SECRET_KEY means integration credentials cannot be decrypted, and
# the failure surfaces later as "Telegram stopped working" rather than here.
if ! grep -qE '^APP_SECRET_KEY=[0-9a-fA-F]{64}$' "$ENV_FILE"; then
  echo "APP_SECRET_KEY in $ENV_FILE must be 64 hex chars" >&2
  echo '  node -e "console.log(require('"'"'crypto'"'"').randomBytes(32).toString('"'"'hex'"'"'))"' >&2
  exit 1
fi

# ── Update, then start over as the script we just fetched ────────────────────
#
# This file updates its own checkout, and bash reads a script from disk as it
# goes rather than loading it whole. So everything after the reset was being
# read out of a file that had just been replaced under it, at a byte offset
# that belonged to the previous version. Usually that means the OLD script
# finishes the run; when the line lengths shift, it can mean neither.
#
# It is not theoretical. The deploy that shipped the hotel applier ran the
# previous commit's script, so the applier never executed and nothing in the
# log said why — the step simply went from "prod is up" to finished.
#
# So the fetch and the work are separated by an `exec`: the first pass only
# brings the checkout up to date and then replaces itself with the version it
# just fetched, which starts from line one and does the actual deploy. The
# variable is what stops that from recursing.
if [ -z "${DEPLOY_UPDATED:-}" ]; then
  echo "==> $ENV_NAME: fetching $BRANCH"
  git fetch --quiet origin "$BRANCH"
  git checkout --quiet "$BRANCH"
  if [ -n "${DEPLOY_SHA:-}" ]; then
    # The commit CI built and tested, not whatever the branch points at by the
    # time this line runs.
    #
    # It must be ON this branch, not merely present in the repository. A sha
    # that exists but belongs to some other branch would check out and deploy
    # perfectly happily — that is exactly the mistake worth refusing, and the
    # only signal that something is wrong would be the environment quietly
    # serving code nobody meant to ship.
    git merge-base --is-ancestor "$DEPLOY_SHA" "origin/$BRANCH" 2>/dev/null || {
      echo "commit $DEPLOY_SHA is not on origin/$BRANCH — refusing to guess" >&2; exit 1; }
    git reset --hard --quiet "$DEPLOY_SHA"
  else
    git reset --hard --quiet "origin/$BRANCH"
  fi
  echo "    $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
  DEPLOY_UPDATED=1 exec "$SELF" "$ENV_NAME"
fi
echo "==> $ENV_NAME: deploying $(git rev-parse --short HEAD)"

# ── Backup ───────────────────────────────────────────────────────────────────
#
# Back up whatever currently HOLDS the data, which is not the same thing it was.
#
# This step archived the `app-data` volume — the SQLite file — and kept doing so
# after the move to Postgres, when that file stopped changing. Every deploy
# produced a backup, so nothing looked wrong; what it backed up was a frozen
# copy from the day of the migration, and the live database had no backup at
# all. A backup nobody reads is indistinguishable from a good one until the day
# it is needed.
#
# So: dump Postgres when Postgres is the engine, and archive the volume when it
# is not. The volume is still archived once here for the record on a Postgres
# environment — it is the rollback point — but the dump is the thing that
# carries today's guests.
mkdir -p deploy/backups
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_DRIVER_NOW="$(grep -E '^DB_DRIVER=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r' || true)"

if [ "$DB_DRIVER_NOW" = "postgres" ]; then
  PG_CONTAINER="alisio-${ENV_NAME}-postgres"
  PG_SUPERUSER="$(grep -E '^PG_SUPERUSER=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r' || true)"
  PG_DATABASE="$(grep -E '^PG_DATABASE=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r' || true)"
  DUMP="deploy/backups/alisio-${ENV_NAME}-${STAMP}.sql.gz"
  if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    PG_PRESENT=1
    echo "==> dumping ${PG_DATABASE:-alisio} -> $DUMP"
    # A failed dump must stop the deploy: shipping new code over a database
    # with no fresh copy of it is the one thing this step exists to prevent.
    docker exec -i "$PG_CONTAINER" pg_dump \
      -U "${PG_SUPERUSER:-alisio_admin}" -d "${PG_DATABASE:-alisio}" \
      | gzip > "$DUMP"
    [ -s "$DUMP" ] || { echo "backup is empty — refusing to deploy" >&2; exit 1; }
    echo "    $(du -h "$DUMP" | cut -f1)"
  else
    echo "==> no postgres container ($PG_CONTAINER) — first deploy on this engine"
  fi
  ls -1t deploy/backups/alisio-${ENV_NAME}-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
else
  VOLUME="${PROJECT}_app-data"
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    ARCHIVE="alisio-${ENV_NAME}-${STAMP}.tar.gz"
    echo "==> backing up $VOLUME -> deploy/backups/$ARCHIVE"
    docker run --rm \
      -v "${VOLUME}:/data:ro" \
      -v "$(pwd)/deploy/backups:/backup" \
      alpine tar czf "/backup/${ARCHIVE}" -C /data .
    # Keep a month of daily deploys; older copies belong in off-site storage.
    ls -1t deploy/backups/alisio-${ENV_NAME}-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm --
  else
    echo "==> no existing data volume ($VOLUME) — first deploy"
  fi
fi

# ── The image ────────────────────────────────────────────────────────────────
#
# Pull what CI built, or build here if nobody handed us anything.
#
# A failed pull stops the deploy instead of quietly falling back to a local
# build. The fallback is one command away and a person can choose it; choosing
# it automatically is how the machine ends up compiling on a night when nobody
# is watching the disk.
if [ -n "${APP_IMAGE:-}" ]; then
  export APP_IMAGE
  echo "==> pulling $APP_IMAGE"
  if ! docker pull --quiet "$APP_IMAGE"; then
    echo "!! cannot pull $APP_IMAGE" >&2
    echo "   registry login expired or the image was never pushed." >&2
    echo "   docker login ghcr.io -u <user>   # token with read:packages" >&2
    echo "   or build here instead:  ./deploy/deploy.sh $ENV_NAME" >&2
    exit 1
  fi
else
  echo "==> building here (no APP_IMAGE — this compiles on the server)"
  docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f deploy/docker-compose.yml build
fi

# ── Migrations ───────────────────────────────────────────────────────────────
#
# Between the build and the restart, on purpose. Every migration in
# db/postgres/migrations/ fails SILENTLY when it is missing — 0005 makes
# fourteen INSERTs bounce off a policy, 0007 makes the whole guest portal
# answer 404, 0008 does the same the moment new code sets `app.public_token`
# against a database still checking `app.guest_token`. Nothing logs an error;
# the application just behaves as if a feature was never built.
#
# That is not a step a person should have to remember, and it used to be one.
# Here the old container is still serving (the build is done, nothing has
# restarted yet), so the window in which schema and code disagree is the
# restart itself rather than however long it takes someone to type the next
# command.
if [ -n "${PG_PRESENT:-}" ]; then
  ./deploy/migrate.sh "$ENV_NAME"
fi

# ── Hotels ───────────────────────────────────────────────────────────────────
#
# `hotels/*.json` describe the state each customer's structure should be in —
# VAT rates, invoice series, room types, the occupancy price matrix, length-of-
# stay tiers, rooms, channel rules, services. Applying them here rather than by
# hand is the whole point: adding the second hotel must not require SSH, an
# admin login, or a network policy for whoever is doing it. A file and a push.
#
# Runs INSIDE the container because that is where the database is reachable,
# and after the health check because until then there may be nothing to talk
# to. The directory is copied in rather than assumed to be in the image: it is,
# today, by way of Next's file tracing, and that is not a promise anyone made.
#
# The applier creates and updates; it never deletes. Its exit code is the
# honest answer to "does this hotel now sell what its file says" — a refused
# row or a failed acceptance quote is a real problem even though the
# application itself is already serving, which the message says out loud.
apply_hotels() {
  local container="alisio-${ENV_NAME}-app"

  # Collected with a loop, not `ls | grep -v`.
  #
  # This script runs under `set -euo pipefail`, and `grep` exits 1 when it
  # matches nothing — which is precisely the state of a repository whose only
  # hotel file is the `_example.json` template. The pipeline therefore failed,
  # the assignment carried that status, and `set -e` killed the deploy before
  # the "nothing to apply" line could even be printed. The empty case is the
  # normal one; it must not be the failing one.
  local wanted=()
  local f
  for f in hotels/*.json; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in _*|.*) continue ;; esac
    wanted+=("$f")
  done
  local real="${#wanted[@]}"
  [ "$real" -gt 0 ] || { echo "==> no hotel files to apply"; return 0; }

  echo "==> applying $real hotel file(s)"
  docker cp hotels "$container:/app/" >/dev/null
  if docker exec "$container" node scripts/apply-hotel.mjs --all; then
    return 0
  fi
  echo "!! $ENV_NAME serves fine, but a hotel does not match its file (see above)" >&2
  return 1
}

echo "==> starting"
docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f deploy/docker-compose.yml up -d

# ── Verify ───────────────────────────────────────────────────────────────────
PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
# Health means "answers a request that opens the database", not "serves a
# page". GET /login renders from the bundle alone: when a deploy shipped a
# build that could not load better-sqlite3, this loop said "beta is up" while
# every data route returned 500. A login POST with junk credentials has to
# reach the users table, so only a real 401 proves the database is readable.
echo "==> waiting for health on 127.0.0.1:${PORT}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/auth/login"
for i in $(seq 1 45); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HEALTH_URL"     -H 'Content-Type: application/json'     -d '{"email":"deploy-health@example.invalid","password":"x"}' || true)"
  case "$CODE" in
    401|400)
      echo "==> $ENV_NAME is up: $(git rev-parse --short HEAD) (db reachable, health $CODE)"
      echo "    image: ${APP_IMAGE:-alisio-pms:$ENV_NAME}"
      # Layers of the image this deploy replaced. Dangling only — nothing that
      # is still a rollback target is touched. The weekly prune covers the rest;
      # this is here because a deploy is exactly the moment new garbage appears,
      # and the disk filling up is not a hypothetical failure on this machine.
      docker image prune -f >/dev/null 2>&1 || true
      # Дим по живому — машинна «перевірка на беті» (docs/DEPLOY.md → Потік):
      # /api/health, логін-401, публічна головна, операторський бандл. Провал
      # смоуку — провал деплою: нова версія вже серве, тож червоне тут — це
      # «чинити зараз», а не «гляну потім». Прод при цьому не поїде взагалі,
      # доки бета не пройде цей самий смоук (гейт у deploy.yml).
      ./deploy/smoke.sh "$ENV_NAME" || exit 1
      # ── План рахунків тим, хто завівся до 07.09.2026 ────────────────────
      #
      # Без статті `accommodation` готівка ВІДМОВЛЯЄТЬСЯ: місток платежів не
      # має на що віднести операцію, і портьє дістає 409. Засів переїхав у
      # `provisionOrganization` 07.09 (INC-025) — тобто лікує лише НОВИХ
      # клієнтів, а всі наявні на беті й проді лишились без довідника.
      #
      # Скрипт для них написали тоді ж і НЕ ПІДКЛЮЧИЛИ НІКУДИ — він чекав,
      # доки хтось згадає. Саме та різниця, про яку AGENTS §4 каже прямо:
      # між «неможливо» і «поки що не сталося». Тепер його котить деплой,
      # як міграції: ідемпотентний, сіє лише те, чого бракує, назв, які
      # готель змінив під себе, не чіпає.
      #
      # ЗАЛЕЖНІСТЬ, названа вголос: скрипт імпортує `src/core/chart-of-accounts`,
      # тож йому потрібні `src/` і `scripts/` В ОБРАЗІ (Д63). На беті вони
      # там є; на проді будуть, щойно Д63 приїде злиттям `beta → main`. Доти
      # цей крок скаже, що не зміг, і не завалить деплой — але й не змовчить.
      docker exec "alisio-${ENV_NAME}-app" node scripts/seed-chart-of-accounts.mjs --all \
        || echo "!! план рахунків не засіяно — готелі без статті «accommodation» НЕ ВІЗЬМУТЬ готівку (Д63: чи є src/ і scripts/ в образі?)" >&2
      apply_hotels
      HOTELS_OK=$?
      # Демо-проживання — тільки поза продом. Скрипт сам відмовляє проду ще
      # раз (подвійний запобіжник) і ідемпотентний: другий деплой за день
      # нічого не подвоїть. Його збій деплой не валить — структура готелю
      # важливіша за декорації, і apply_hotels уже сказав своє.
      if [ "$ENV_NAME" != "prod" ]; then
        # `docker cp` тут БІЛЬШЕ НЕ ПОТРІБЕН — образ несе `scripts/` і `src/`
        # цілком (Д63) — і лишається рівно як страховка на випадок образу,
        # зібраного до цієї зміни: копіювання поверх наявного файла нешкідливе.
        #
        # І варто памʼятати, чому цей рядок був брехнею: копіювався ОДИН файл,
        # а скрипт імпортує 25 модулів із `src/`, яких у образі не було. Тобто
        # крок падав кожного разу — і мовчав, бо його провал деплой навмисно не
        # валить. Єдиний крок, який «працював», був тим, чию відмову ковтали.
        docker cp scripts/seed-demo-stays.mjs "alisio-${ENV_NAME}-app:/app/scripts/" >/dev/null \
          && docker exec "alisio-${ENV_NAME}-app" node scripts/seed-demo-stays.mjs --all --env "$ENV_NAME" \
          || echo "!! demo seed failed on $ENV_NAME — календар порожній, деплой живий" >&2
      fi
      # Розклад щоденних бекапів живе тому, що середовище живе, а не тому,
      # що хтось пам'ятає crontab. Ідемпотентно; збій деплой не валить,
      # але мовчати не має права: без розкладу RPO знову дорівнює
      # «скільки часу минуло від останнього деплою».
      ./deploy/setup-backup-cron.sh "$ENV_NAME" \
        || echo "!! backup cron не встановився — щоденних дампів НЕМАЄ, лише деплойні" >&2
      exit $HOTELS_OK
      ;;
    500|502|503)
      # The server is answering but something behind it is broken — report the
      # reason instead of retrying until the timeout hides it.
      echo "!! $ENV_NAME answers $CODE on a database-backed route" >&2
      break
      ;;
  esac
  sleep 2
done

echo "!! $ENV_NAME did not become healthy in 90s" >&2
docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f deploy/docker-compose.yml logs --tail 60 app >&2
exit 1
