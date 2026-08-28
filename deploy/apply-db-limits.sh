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
# це знайшов check-oom.sh 2026-08-28. Ліміт застосовується лише
# перестворенням, перестворення бази — лише свідомо, звідси цей скрипт.
#
# Перший запуск на сервері (2026-08-28) закінчився БЕЗ ЖОДНОГО рядка виводу:
# PG_MEM_LIMIT — ключ, якому дозволено бути відсутнім (compose має дефолт), а
# grep без збігу виходить з 1, і під `set -euo pipefail` присвоєння вбивало
# скрипт до першого echo. Звідси `|| true` у читачах env-файла (тримає
# scripts/check-fatal-grep.mjs) і банер першим рядком: скрипт, який мовчить,
# нерозрізненний від скрипта, який не запускався.
#
# Що він робить, по порядку:
#   0. якщо в env-файлі немає рядка PG_MEM_LIMIT — дописує PG_MEM_LIMIT=640m
#      (чинний compose-дефолт) туди, ідемпотентно: конфігурація має бути
#      видима у файлі, а не жити в дефолті, якого не видно жодним grep-ом;
#   1. читає ПОТОЧНІ налаштування пам'яті Postgres (SHOW …) і перевіряє, що
#      вони вкладаються в майбутній ліміт — інакше ліміт сам стане причиною
#      OOM: фіксована частина (shared_buffers + wal_buffers +
#      maintenance_work_mem + процесний запас) понад ліміт = відмова;
#      теоретичний максимум (плюс max_connections × work_mem) понад ліміт =
#      попередження з числами, бо реальний пул застосунку куди менший;
#   2. знімає свіжий дамп (та сама команда, що в deploy.sh) — точка відкату;
#   3. вимагає НАБРАТИ назву середовища (Enter не досить: команди, вставлені
#      блоком, відповіли б самі за себе) — перестворення = простій бази на
#      ~10–30 секунд, застосунок у цей час віддає 503 (див. drill-health.sh);
#   4. `docker compose --profile postgres up -d postgres` — компоуз бачить
#      різницю конфігурації і перестворює контейнер; дані живуть в
#      іменованому томі pg-data і перестворення не переживають ЛИШЕ процеси,
#      не дані;
#   5. чекає pg_isready і /api/health → 200 — і ЗВІРЯЄ ліміт з очікуваним:
#      не збігся → exit 1. «Скрипт відпрацював» ≠ «ліміт стоїть».
#
# Повторний запуск із уже застосованим лімітом каже це словами і виходить
# одразу, не чіпаючи базу. Жоден шлях завершення не мовчить: тихий no-op —
# той самий клас поломки, що зелений health при мертвій базі (INC-007).
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

# Банер до будь-якого читання: якщо щось нижче все ж помре, слід лишиться.
echo "==> apply-db-limits: $ENV_NAME ($ENV_FILE)"

# `|| true`: відсутній ключ — нормальний випадок (дефолти стоять поруч у
# `${X:-…}`), а без нього grep, що нічого не знайшов, під set -euo pipefail
# вбиває скрипт мовчки. Саме так перший запуск на сервері не сказав нічого.
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }

docker inspect "$PGC" >/dev/null 2>&1 || {
  echo "контейнера $PGC немає — це середовище не на Postgres, ліміт нема куди класти" >&2
  exit 2
}

PG_SUPERUSER="$(val PG_SUPERUSER)"; PG_SUPERUSER="${PG_SUPERUSER:-alisio_admin}"
PG_DATABASE="$(val PG_DATABASE)";   PG_DATABASE="${PG_DATABASE:-alisio}"
APP_PORT="$(val APP_PORT)"

# Майбутній ліміт. Реальні env-файли на сервері старші за появу лімітів у
# compose (fe20228) і рядка PG_MEM_LIMIT не мають: compose мовчки бере дефолт,
# і жоден перегляд файла цього не покаже — саме на цьому відсутньому ключі
# перший запуск скрипта помер без жодного слова (INC-007). Тому відсутній
# ключ дописується СЮДИ Ж, ідемпотентно: конфігурація має бути видима у
# файлі, а не жити в голові. Порожнє значення (рядок «PG_MEM_LIMIT=» з
# прикладу) — не дописуємо, щоб не плодити дублікати: діє дефолт, про це
# кажемо вголос.
if ! grep -qE '^PG_MEM_LIMIT=' "$ENV_FILE"; then
  [ -z "$(tail -c1 "$ENV_FILE")" ] || echo >> "$ENV_FILE"   # файл без \n у кінці
  printf '# дописано apply-db-limits.sh %s: явний ліміт бази замість мовчазного compose-дефолту\nPG_MEM_LIMIT=640m\n' \
    "$(date +%F)" >> "$ENV_FILE"
  echo "==> у $ENV_FILE не було PG_MEM_LIMIT — дописав PG_MEM_LIMIT=640m (чинний compose-дефолт, тепер видимий)"
fi
LIMIT_RAW="$(val PG_MEM_LIMIT)"
[ -n "$LIMIT_RAW" ] || echo "==> PG_MEM_LIMIT у $ENV_FILE порожній — діє дефолт 640m"
LIMIT_RAW="${LIMIT_RAW:-640m}"
to_mb() { # '128MB' | '4MB' | '16GB' | '512kB' | '640m' | '1g' | '100' -> МБ (ціле)
  local v="$1"
  # Порожнє або дробове значення -> порожня відповідь: хай гучно відмовить
  # той, хто питав. Тихе неправильне число в перевірці памʼяті гірше за відмову.
  case "$v" in ''|*.*) echo ""; return ;; esac
  case "$v" in
    *GB|*gb|*g|*G) echo $(( ${v//[!0-9]/} * 1024 )) ;;
    *MB|*mb|*m|*M) echo $(( ${v//[!0-9]/} )) ;;
    *kB|*KB|*kb|*k) echo $(( ${v//[!0-9]/} / 1024 )) ;;
    *) echo $(( ${v//[!0-9]/} )) ;;
  esac
}
LIMIT_MB="$(to_mb "$LIMIT_RAW")"
[ -n "$LIMIT_MB" ] || {
  echo "!! не зрозумів PG_MEM_LIMIT=«$LIMIT_RAW» — цілі одиниці на кшталт 640m або 1g" >&2
  exit 1
}

NOW_BYTES="$(docker inspect --format '{{.HostConfig.Memory}}' "$PGC")"
echo "==> $PGC: mem_limit зараз $(( NOW_BYTES / 1024 / 1024 )) МБ, буде ${LIMIT_MB} МБ (PG_MEM_LIMIT=${LIMIT_RAW})"

# Уже зроблено — кажемо це словами і виходимо, не турбуючи базу. Але лише
# якщо і політика рестарту на місці: check-oom.sh шле сюди й за нею.
POLICY_NOW="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$PGC")"
if [ "$NOW_BYTES" = "$(( LIMIT_MB * 1024 * 1024 ))" ] \
   && { [ "$POLICY_NOW" = unless-stopped ] || [ "$POLICY_NOW" = always ]; }; then
  echo "==> ліміт уже застосований (${LIMIT_MB} МБ, restart=${POLICY_NOW}) — перестворювати нічого"
  exit 0
fi

# ── 1. Чи вкладаються власні налаштування Postgres у майбутній ліміт ─────────
show() { docker exec "$PGC" psql -U "$PG_SUPERUSER" -d "$PG_DATABASE" -tAc "SHOW $1" 2>/dev/null | tr -d ' ' || true; }
SB="$(to_mb "$(show shared_buffers)")"
WM="$(to_mb "$(show work_mem)")"
MWM="$(to_mb "$(show maintenance_work_mem)")"
WB="$(to_mb "$(show wal_buffers)")"
MC="$(show max_connections)"
# Не відповіла база — не рахуємо на порожніх нулях: порожній рядок у $(( ))
# дав би 0 МБ і «все вкладається» на базі, якої не спитали.
if [ -z "$SB" ] || [ -z "$WM" ] || [ -z "$MWM" ] || [ -z "$WB" ] || [ -z "$MC" ]; then
  echo "!! не зміг прочитати налаштування бази: psql -U ${PG_SUPERUSER} -d ${PG_DATABASE}" >&2
  echo "!! у контейнері $PGC не відповів. Логи: ./deploy/logs.sh $ENV_NAME" >&2
  exit 1
fi
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
docker exec -i "$PGC" pg_dump -U "$PG_SUPERUSER" -d "$PG_DATABASE" | gzip > "$DUMP" \
  || { echo "!! дамп не знявся — нічого не перестворюю. Логи: ./deploy/logs.sh $ENV_NAME" >&2; exit 1; }
[ -s "$DUMP" ] || { echo "!! дамп порожній — нічого не перестворюю" >&2; exit 1; }
echo "    $(du -h "$DUMP" | cut -f1)"

# ── 3. Підтвердження людини ─────────────────────────────────────────────────
# Саме НАБРАТИ назву, а не Enter: команди, вставлені блоком, згодовують
# скрипту наступний рядок блоку як відповідь. З Enter-підтвердженням вставка
# «бета, потім прод» перестворила б ОБИДВІ бази, не спитавши нікого; рядок
# «./deploy/check-oom.sh beta» назвою середовища не є — отже відмова.
echo "!! Перестворення зупинить базу ${ENV_NAME} на ~10–30 секунд: запити в цей"
echo "!! час отримають помилки, /api/health віддасть 503. Дані в томі pg-data"
echo "!! перестворення переживають."
printf '!! Щоб продовжити, набери назву середовища (%s) і Enter; будь-що інше — відмова: ' "$ENV_NAME"
read -r CONFIRM || CONFIRM=""
if [ "$CONFIRM" != "$ENV_NAME" ]; then
  echo "відмова: очікував «${ENV_NAME}», отримав «${CONFIRM:0:60}»." >&2
  echo "Якщо це був вставлений блок команд — запускай цей скрипт окремим рядком." >&2
  exit 1
fi

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

# ── 5. Доказ: ліміт застосований, або це провал зі статусом 1 ───────────────
# «Скрипт відпрацював» ≠ «ліміт стоїть»: якщо compose з якоїсь причини не
# перестворив контейнер, тихий exit 0 був би тим самим класом, що зелений
# health при мертвій базі. Тому звіряємо число, а не віримо крокам.
docker inspect --format \
  '==> {{.Name}}: mem_limit={{.HostConfig.Memory}} байт, restart={{.HostConfig.RestartPolicy.Name}}, стан={{.State.Status}}' \
  "$PGC" | sed 's|/||'
AFTER_BYTES="$(docker inspect --format '{{.HostConfig.Memory}}' "$PGC")"
if [ "$AFTER_BYTES" != "$(( LIMIT_MB * 1024 * 1024 ))" ]; then
  echo "!! ПРОВАЛ: очікував mem_limit=$(( LIMIT_MB * 1024 * 1024 )) байт (${LIMIT_MB} МБ)," >&2
  echo "!! контейнер має ${AFTER_BYTES}. Ліміт НЕ застосований — чи перестворив compose" >&2
  echo "!! контейнер узагалі? docker ps -a, ./deploy/logs.sh $ENV_NAME" >&2
  exit 1
fi
echo "==> ліміт застосований і звірений; перевірити разом з рештою: ./deploy/check-oom.sh $ENV_NAME"
