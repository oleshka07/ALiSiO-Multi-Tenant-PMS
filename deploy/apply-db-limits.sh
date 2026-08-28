#!/usr/bin/env bash
#
# Свідоме перестворення postgres-контейнера, щоб він нарешті отримав mem_limit.
#
#   ./deploy/apply-db-limits.sh beta
#   ./deploy/apply-db-limits.sh prod    # після ок на беті
#
# Чому це окремий скрипт, а не деплой. Сервіс postgres у docker-compose.yml
# живе під `profiles: ["postgres"]`, і деплойний `up -d` його НАВМИСНО не
# чіпає — середовище на SQLite не має виростити собі базу, а перестворення
# бази не має бути побічним ефектом кожного деплою. Тому контейнери, підняті
# to-postgres.sh ДО появи лімітів (fe20228), так і працювали з mem_limit=0 —
# це знайшов check-oom.sh 2026-08-29. Ліміт застосовується лише
# перестворенням, перестворення бази — лише свідомо, звідси цей скрипт.
#
# Що він робить, по порядку:
#   1. читає ПОТОЧНІ налаштування пам'яті Postgres (SHOW …) і перевіряє, що
#      вони вкладаються в майбутній ліміт — інакше ліміт сам стане причиною
#      OOM: фіксована частина (shared_buffers + wal_buffers +
#      maintenance_work_mem + процесний запас) понад ліміт = відмова;
#      теоретичний максимум (плюс max_connections × work_mem) понад ліміт =
#      попередження з числами, бо реальний пул застосунку куди менший;
#   2. знімає свіжий дамп (та сама команда, що в deploy.sh) — точка відкату;
#   3. питає підтвердження: перестворення = простій бази на ~10–30 секунд,
#      застосунок у цей час віддає 503 на /api/health (див. drill-health.sh);
#   4. `docker compose --profile postgres up -d postgres` — компоуз бачить
#      різницю конфігурації і перестворює контейнер; дані живуть в
#      іменованому томі pg-data і перестворення не переживають ЛИШЕ процеси,
#      не дані;
#   5. чекає pg_isready і /api/health → 200, друкує ліміт «до → після» і
#      RestartPolicy.
#
# Повторний запуск із уже застосованим лімітом — no-op: compose не
# перестворює контейнер, конфігурація якого не змінилась.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
PROJECT="alisio-${ENV_NAME}"
PGC="alisio-${ENV_NAME}-postgres"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — запускати на сервері" >&2; exit 1; }

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r'; }

docker inspect "$PGC" >/dev/null 2>&1 || {
  echo "контейнера $PGC немає — це середовище не на Postgres, ліміт нема куди класти" >&2
  exit 2
}

PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"
APP_PORT="$(val APP_PORT)"

# Майбутній ліміт: що скаже compose — PG_MEM_LIMIT з env-файла або дефолт.
LIMIT_RAW="$(val PG_MEM_LIMIT)"; LIMIT_RAW="${LIMIT_RAW:-640m}"
to_mb() { # '128MB' | '4MB' | '16GB' | '512kB' | '640m' | '1g' | '100' -> МБ (ціле)
  local v="$1"
  case "$v" in
    *GB|*gb|*g|*G) echo $(( ${v//[!0-9]/} * 1024 )) ;;
    *MB|*mb|*m|*M) echo $(( ${v//[!0-9]/} )) ;;
    *kB|*KB|*kb|*k) echo $(( ${v//[!0-9]/} / 1024 )) ;;
    *) echo $(( ${v//[!0-9]/} )) ;;
  esac
}
LIMIT_MB="$(to_mb "$LIMIT_RAW")"

NOW_BYTES="$(docker inspect --format '{{.HostConfig.Memory}}' "$PGC")"
echo "==> $PGC: mem_limit зараз $(( NOW_BYTES / 1024 / 1024 )) МБ, буде ${LIMIT_MB} МБ (PG_MEM_LIMIT=${LIMIT_RAW})"

# ── 1. Чи вкладаються власні налаштування Postgres у майбутній ліміт ─────────
show() { docker exec "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -tAc "SHOW $1" | tr -d ' '; }
SB="$(to_mb "$(show shared_buffers)")"
WM="$(to_mb "$(show work_mem)")"
MWM="$(to_mb "$(show maintenance_work_mem)")"
WB="$(to_mb "$(show wal_buffers)")"
MC="$(show max_connections)"
OVERHEAD_MB=64   # процеси Postgres, каталоги, локальні буфери — запас, не точність

FIXED=$(( SB + WB + MWM + OVERHEAD_MB ))
THEOMAX=$(( FIXED + MC * WM ))
echo "==> налаштування Postgres: shared_buffers=${SB}МБ work_mem=${WM}МБ" \
     "maintenance_work_mem=${MWM}МБ wal_buffers=${WB}МБ max_connections=${MC}"
echo "    фіксована частина ~${FIXED} МБ; теоретичний максимум ~${THEOMAX} МБ" \
     "(${MC} зʼєднань × work_mem — стеля, якої реальний пул не дає)"

if [ "$FIXED" -ge "$LIMIT_MB" ]; then
  echo "!! ВІДМОВА: фіксована частина (${FIXED} МБ) не вкладається в ліміт ${LIMIT_MB} МБ —" >&2
  echo "!! такий ліміт сам стане причиною OOM без жодного навантаження." >&2
  echo "!! Або підніміть PG_MEM_LIMIT у ${ENV_FILE}, або зменшіть shared_buffers/maintenance_work_mem." >&2
  exit 1
fi
if [ "$THEOMAX" -ge "$LIMIT_MB" ]; then
  echo "    (попередження: теоретичний максимум ${THEOMAX} МБ > ліміту ${LIMIT_MB} МБ —"
  echo "     реальний пул застосунку значно менший за ${MC}, але при зростанні"
  echo "     кількості зʼєднань першим упреться саме цей ліміт)"
fi

# ── 2. Свіжий дамп — точка відкату, як перед кожним деплоєм ─────────────────
mkdir -p deploy/backups
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="deploy/backups/alisio-${ENV_NAME}-dblimits-${STAMP}.sql.gz"
echo "==> дамп перед перестворенням: $DUMP"
docker exec -i "$PGC" pg_dump -U "$PG_SUPERUSER" -d "$PG_DATABASE" | gzip > "$DUMP"
[ -s "$DUMP" ] || { echo "!! дамп порожній — нічого не перестворюю" >&2; exit 1; }
echo "    $(du -h "$DUMP" | cut -f1)"

# ── 3. Підтвердження людини ─────────────────────────────────────────────────
echo "!! Перестворення зупинить базу ${ENV_NAME} на ~10–30 секунд: запити в цей"
echo "!! час отримають помилки, /api/health віддасть 503. Дані в томі pg-data"
echo "!! перестворення переживають. Enter — продовжити, Ctrl-C — відмовитись."
read -r

# ── 4. Перестворення силами compose, з профілем postgres ────────────────────
echo "==> перестворюю $PGC з новою конфігурацією"
ENV_NAME="$ENV_NAME" docker compose --env-file "$ENV_FILE" -p "$PROJECT" \
  --profile postgres -f deploy/docker-compose.yml up -d postgres

echo "==> чекаю готовність бази"
for i in $(seq 1 30); do
  docker exec "$PGC" pg_isready -U "$PG_SUPERUSER" -d "$PG_DATABASE" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "!! база не піднялася за 60 с — ./deploy/logs.sh $ENV_NAME" >&2; exit 1; }
  sleep 2
done

if [ -n "$APP_PORT" ]; then
  echo "==> чекаю /api/health → 200"
  UP=000
  for i in $(seq 1 30); do
    UP="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:${APP_PORT}/api/health" || echo 000)"
    [ "$UP" = 200 ] && break
    sleep 2
  done
  [ "$UP" = 200 ] || { echo "!! застосунок не бачить базу (health ${UP}) — ./deploy/logs.sh $ENV_NAME" >&2; exit 1; }
fi

# ── 5. Доказ ────────────────────────────────────────────────────────────────
docker inspect --format \
  '==> {{.Name}}: mem_limit={{.HostConfig.Memory}} байт, restart={{.HostConfig.RestartPolicy.Name}}, стан={{.State.Status}}' \
  "$PGC" | sed 's|/||'
echo "==> перевірити разом з рештою: ./deploy/check-oom.sh $ENV_NAME"
