#!/usr/bin/env bash
#
# Чотири речі, які ця сесія не виконає, хоч би що вирішила модель.
#
# Правила в AGENTS.md — контекст: модель намагається їх дотримуватись, але
# нічого не гарантує. Тут — детермінований шар: PreToolUse-хук бачить кожен
# виклик інструмента ДО виконання і відмовляє (exit 2) рівно чотирьом речам,
# ціна яких — прод або дані готелів. stderr відмови повертається моделі, тож
# кожна називає правильну альтернативу, а не лише «не можна».
#
#   1. force-push у main або beta         історія гілок, з яких деплояться готелі
#   2. запис у db/postgres/schema.sql     він генерується (AGENTS.md, інваріант 10)
#   3. DROP TABLE / DROP DATABASE /       незворотна зміна бази повз журнал
#      TRUNCATE через psql|sqlite3        schema_migrations
#   4. ssh … docker build                 інцидент 26 серпня: збірка на VPS
#                                         забила диск, Postgres упав, сусідні
#                                         проєкти віддавали 502
#
# Плюс одне ТЕРТЯ без блоку (1b): push у main/beta, коли checks цієї гілки
# червоні, друкує питання «це фікс чи нова робота?» і пропускає виклик —
# фікси теж пушаться, але тихо класти нове поверх червоного більше не вийде.
#
# Відмова хука — правило проєкту, а не збій. Все інше проходить мовчки.
set -u

# Без node не судимо — пропускаємо. Інший вихід (exit 1) не блокує виклик,
# лише шумить; тиха деградація тут чесніша за хибне відчуття захисту.
command -v node >/dev/null 2>&1 || exit 0

# Поля з JSON на stdin. Переноси рядків усередині команди замінюються
# пробілами, щоб багаторядкова команда матчилась тими самими регекспами.
FIELDS="$(node -e '
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(d); } catch {}
  const i = j.tool_input || {};
  const one = (s) => String(s ?? "").replace(/\r?\n/g, " ");
  process.stdout.write([one(j.tool_name), one(i.command), one(i.file_path)].join("\u0001"));
});
' 2>/dev/null)" || exit 0

TOOL="${FIELDS%%$'\x01'*}"
REST="${FIELDS#*$'\x01'}"
CMD="${REST%%$'\x01'*}"
FILE="${REST#*$'\x01'}"

deny() { printf '%s\n' "$1" >&2; exit 2; }

# ── Edit / Write / MultiEdit: лише один файл під забороною ──────────────────
if [ "$TOOL" != "Bash" ]; then
  case "$FILE" in
    *db/postgres/schema.sql)
      deny "db/postgres/schema.sql ГЕНЕРУЄТЬСЯ (AGENTS.md, інваріант 10) — правку руками затре наступний прогін генератора. Рішення про типи — у мапі OVERRIDE в scripts/pg-schema.mjs; перегенерувати: node scripts/pg-schema.mjs. Зміна самої схеми — це src/lib/db.ts плюс міграція в db/postgres/migrations/."
      ;;
  esac
  exit 0
fi

[ -n "$CMD" ] || exit 0

# ── 1. force-push у main або beta ───────────────────────────────────────────
# --force ловить і --force-with-lease (підрядок); +main / +beta — це той самий
# force, записаний refspec-ом.
if [[ "$CMD" =~ git[[:space:]].*push || "$CMD" =~ git[[:space:]]+push ]]; then
  if [[ "$CMD" =~ --force || "$CMD" =~ (^|[[:space:]])-f([[:space:]]|$) || "$CMD" =~ [[:space:]]\+(main|beta)([[:space:]]|$) ]]; then
    if [[ "$CMD" =~ [[:space:]:+](main|beta)([[:space:]]|$) ]]; then
      deny "Force-push у main/beta переписує історію гілки, з якої деплояться готелі. Відкат — образом, не історією: APP_IMAGE=ghcr.io/…:<sha> DEPLOY_SHA=<sha> ./deploy/deploy.sh prod|beta (docs/DEPLOY.md → Rollback). Якщо force справді потрібен — це рішення людини, руками, поза цією сесією."
    fi
  fi
fi

# ── 1b. Пуш у main/beta на червоний CI: тертя, не блок ──────────────────────
# Фікс поломки теж пушиться, тому exit 1 — «шумить, не блокує» (див. шапку).
# Без gh або без відповіді API судити нема чим, і хук мовчить: про відсутність
# gh сесії вже сказав session-start, а хибна тривога тут навчила б ігнорувати
# справжню.
if [[ "$CMD" =~ git[[:space:]].*push ]] && ! [[ "$CMD" =~ --force ]]; then
  PUSH_TARGET=""
  if [[ "$CMD" =~ [[:space:]](main|beta)([[:space:]]|$) ]]; then
    PUSH_TARGET="${BASH_REMATCH[1]}"
  elif [[ "$CMD" =~ git[[:space:]]+push([[:space:]]+(-u[[:space:]]+)?origin)?[[:space:]]*$ ]]; then
    PUSH_TARGET="$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    case "$PUSH_TARGET" in main|beta) ;; *) PUSH_TARGET="" ;; esac
  fi
  if [ -n "$PUSH_TARGET" ] && command -v gh >/dev/null 2>&1; then
    TMO=""
    command -v timeout >/dev/null 2>&1 && TMO="timeout 10"
    CI_INFO="$(cd "${CLAUDE_PROJECT_DIR:-.}" && $TMO gh api \
      "repos/{owner}/{repo}/actions/workflows/checks.yml/runs?branch=${PUSH_TARGET}&per_page=1" \
      --jq '.workflow_runs[0] | (.conclusion // .status) + "|" + .created_at + "|" + (.run_number|tostring)' \
      2>/dev/null || true)"
    case "$CI_INFO" in
      failure\|*|cancelled\|*|timed_out\|*)
        CI_REST="${CI_INFO#*|}"
        printf '%s\n' "CI на ${PUSH_TARGET} червоний з ${CI_REST%%|*} (ран №${CI_INFO##*|}). Це фікс поломки чи нова робота поверх неї? Нова робота чекає зеленого." >&2
        exit 1
        ;;
    esac
  fi
fi

# ── 2. запис у db/postgres/schema.sql через shell ───────────────────────────
# Читати можна (cat, grep, psql -f) — блокується лише запис: редірект у файл
# або редактор/копіювання, коли файл названий у команді.
if [[ "$CMD" == *db/postgres/schema.sql* ]]; then
  if [[ "$CMD" =~ \>[[:space:]]*(\./)?db/postgres/schema\.sql ]] \
    || [[ "$CMD" =~ (^|[[:space:]])(sed[[:space:]]+-i|tee|cp|mv)([[:space:]]) ]]; then
    deny "db/postgres/schema.sql ГЕНЕРУЄТЬСЯ (AGENTS.md, інваріант 10) — запис руками затре наступний прогін. Перегенерувати: node scripts/pg-schema.mjs; типи — у мапі OVERRIDE там само. Якщо треба копія ІЗ нього: cat db/postgres/schema.sql > /tmp/copy.sql — читання дозволене."
  fi
fi

# ── 3. DROP TABLE / DROP DATABASE / TRUNCATE поза міграціями ────────────────
# Команда, що лише ЗАПУСКАЄ файл із db/postgres/migrations/, тексту DROP не
# містить і сюди не потрапляє. Блокується інлайновий деструктив через клієнт
# бази — саме він оминає журнал schema_migrations.
# Ліва межа TRUNCATE включає лапки й дужки — «psql -c "TRUNCATE x"» — але
# не літеру, щоб не спіймати truncated.log.
TRUNC_RE="(^|[[:space:]\"'(;])truncate[[:space:]]"
shopt -s nocasematch
if [[ "$CMD" =~ (psql|sqlite3) ]]; then
  if [[ "$CMD" =~ drop[[:space:]]+table || "$CMD" =~ drop[[:space:]]+database || "$CMD" =~ $TRUNC_RE ]]; then
    shopt -u nocasematch
    deny "DROP/TRUNCATE повз журнал міграцій — незворотна зміна бази, якої не побачить жодне середовище далі. Оформіть це файлом у db/postgres/migrations/ (нумерований, перезапускний, власна транзакція) — його накотить deploy/migrate.sh на кожному деплої. Локальна одноразова база — теж міграцією: саме так її побачать усі."
  fi
fi
shopt -u nocasematch

# ── 4. збірка на сервері через ssh ──────────────────────────────────────────
# 26 серпня «docker compose build» на VPS забив диск на 100%: Postgres упав
# посеред запису, сусідні проєкти віддавали 502. Образ збирає CI.
if [[ "$CMD" =~ (^|[[:space:]])ssh([[:space:]]) ]]; then
  if [[ "$CMD" =~ docker[[:space:]]+build || "$CMD" =~ docker[[:space:]]+compose[[:space:]][^\|\;\&]*build || "$CMD" =~ docker-compose[[:space:]][^\|\;\&]*build ]]; then
    deny "Збірка на сервері — інцидент 26 серпня (диск 100%, Postgres упав, сусідні проєкти лежали). Образ збирає CI: push у гілку → зелений checks → deploy.yml збирає на раннері й деплоїть сам. Ручна збірка на VPS — аварійний вихід для людини (docs/DEPLOY.md), не команда з сесії."
  fi
fi

exit 0
