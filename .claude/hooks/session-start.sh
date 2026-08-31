#!/usr/bin/env bash
#
# Що бачить кожна сесія, перш ніж торкнутися коду.
#
# CLAUDE.md імпортує правила проєкту (@AGENTS.md), але правила не знають,
# у якому стані репозиторій СЬОГОДНІ. Це друкує стан: гілку, незбережені
# зміни, хвіст розділу «Стан і що далі» — і головне, чи не втік main уперед
# від beta. Порядок «спершу beta, потім main» уже порушувався на 96 комітів
# (5–13 серпня), і ніщо тоді про це не сказало.
#
# Хук інформує, не блокує: його збій не має права зупинити сесію, тому
# мережеві кроки best-effort і вихід завжди 0.
set -u

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 0

echo "── Стан репозиторію на старті сесії ─────────────────────────────────"
echo "Гілка: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

STATUS="$(git status --short 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
  echo "Незбережені зміни:"
  echo "$STATUS" | head -20
else
  echo "Робоча копія чиста."
fi

# Свіжі main і beta — інакше порівнювати нічого: клон веб-сесії часто
# приходить узагалі без beta.
git fetch --quiet origin main beta 2>/dev/null || true

# ── Чи це взагалі те дерево ──────────────────────────────────────────────
# 2026-08-31: сесія два дні досліджувала схему на гілці
# cleanup/remove-antigravity-scaffold, склала план перебудови ядра і подала
# висновки про таблиці, яких у продукті немає п'ять тижнів. Гілка виявилась
# деревом-сиротою: 13 комітів від 27 липня, ВЛАСНИЙ корінь, спільного предка
# з main немає взагалі. Помилки не зробив ніхто — вона лежала в тому самому
# репозиторії, називалась правдоподібно, і ніщо не сказало, що це інший
# продукт. Спіймалося випадково, при звірці двох звітів.
#
# Доказ дешевий і однозначний: merge-base. Немає спільного предка — це не
# відставання, це інше дерево, і злити його нема куди.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  if ! BASE="$(git merge-base HEAD origin/main 2>/dev/null)" || [ -z "$BASE" ]; then
    echo ""
    echo "!! ЦЯ ГІЛКА НЕ МАЄ СПІЛЬНОЇ ІСТОРІЇ З origin/main."
    echo "!! Це не відставання, а ІНШЕ ДЕРЕВО: власний корінь, свій db.ts,"
    echo "!! свої таблиці. Усе, що тут виміряно, продукту не стосується, а"
    echo "!! merge вимагав би --allow-unrelated-histories."
    echo "!! СКАЖИ ПРО ЦЕ ЛЮДИНІ ПЕРШИМ РЯДКОМ СВОЄЇ ПЕРШОЇ ВІДПОВІДІ."
  elif [ "$BRANCH" != "main" ]; then
    # Відставання саме по собі нормальне — гілка на те й гілка. Небезпечна
    # не відстань, а ВІК точки розгалуження: у цьому проєкті ~2.5 коміти на
    # день, тож тиждень — це вже інша схема, і db.ts, прочитаний тут, бреше
    # про продукт.
    BEHIND_MAIN="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    if [ "${BEHIND_MAIN:-0}" != "0" ]; then
      FORK_TS="$(git log -1 --format=%ct "$BASE" 2>/dev/null || echo 0)"
      FORK_AGE=$(( ( $(date +%s) - ${FORK_TS:-0} ) / 86400 ))
      echo "Відгалужена від main ${FORK_AGE} дн. тому; main відтоді пішов на ${BEHIND_MAIN} коміт(ів)."
      if [ "${FORK_AGE:-0}" -gt 7 ]; then
        echo "!! Точка розгалуження старша за тиждень. Перш ніж робити висновки"
        echo "!! зі схеми — звір src/lib/db.ts із origin/main: тут вона застаріла."
      fi
    fi
  fi
fi

if git rev-parse --verify --quiet origin/beta >/dev/null 2>&1; then
  # Два напрямки розбіжності — дві різні речі. main попереду beta — прод
  # обслуговує неперевірене, це тривога. beta попереду main — зміна ще
  # перевіряється на беті, це правильний стан потоку і лише довідка.
  #
  # --no-merges обов'язковий: реліз за процесом (`merge --no-ff beta` у main)
  # лишає на main merge-коміт, якого на beta нема за визначенням — і без
  # цього прапорця хук кричав «main попереду» після КОЖНОГО релізу. Хибна
  # тривога, яку всі вчаться ігнорувати, гірша за відсутню. Зміни, яких бета
  # справді не бачила, живуть у не-merge комітах — їх і рахуємо.
  AHEAD="$(git rev-list --count --no-merges origin/beta..origin/main 2>/dev/null || echo 0)"
  BEHIND="$(git rev-list --count --no-merges origin/main..origin/beta 2>/dev/null || echo 0)"
  if [ "${AHEAD:-0}" != "0" ]; then
    echo ""
    echo "!! MAIN ПОПЕРЕДУ BETA НА ${AHEAD} КОМІТ(ІВ)."
    echo "!! Прод обслуговує код, якого бета не бачила. Порядок проєкту:"
    echo "!! спершу merge у beta, перевірка на беті, потім у main (docs/DEPLOY.md)."
    echo "!! СКАЖИ ПРО ЦЕ ЛЮДИНІ ПЕРШИМ РЯДКОМ СВОЄЇ ПЕРШОЇ ВІДПОВІДІ."
  fi
  if [ "${BEHIND:-0}" != "0" ]; then
    echo ""
    echo "beta попереду main на ${BEHIND} коміт(ів): зміни перевіряються на беті"
    echo "й чекають merge у main. Це правильний напрямок потоку, не тривога."
  fi
else
  echo "(origin/beta недоступна — відставання перевірити не вдалося)"
fi

# ── Останній checks на origin/main і origin/beta ─────────────────────────
# Червоний CI, якого ніхто не бачить, збирає поверх себе нові пуші:
# 2026-08-28 їх лягло чотири поспіль, і деплой стояв чотири години
# (SECURITY-FINDINGS → «Дрейф за одну добу»). Тому статус — у вічі кожній
# сесії. Потрібен gh із токеном; якщо його немає — чесно кажемо, що НЕ
# ЗНАЄМО, а не мовчимо: тиша тут читається як «усе гаразд».
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  for BR in main beta; do
    INFO="$(gh api "repos/{owner}/{repo}/actions/workflows/checks.yml/runs?branch=${BR}&per_page=1" \
              --jq '.workflow_runs[0] | (.conclusion // .status) + "|" + .created_at + "|" + (.run_number|tostring)' \
              2>/dev/null || true)"
    STATE="${INFO%%|*}"; REST="${INFO#*|}"; WHEN="${REST%%|*}"; NUM="${INFO##*|}"
    case "$STATE" in
      success)
        echo "checks на ${BR}: зелений (ран №${NUM})" ;;
      failure|cancelled|timed_out)
        echo ""
        echo "!! CHECKS НА ${BR} ЧЕРВОНІ з ${WHEN} (ран №${NUM}, ${STATE})."
        echo "!! Поверх червоного нову роботу не кладуть: спершу зелений."
        echo "!! СКАЖИ ПРО ЦЕ ЛЮДИНІ ПЕРШИМ РЯДКОМ СВОЄЇ ПЕРШОЇ ВІДПОВІДІ."
        ;;
      in_progress|queued|pending|requested|waiting)
        echo "checks на ${BR}: ще біжить (ран №${NUM}) — результат подивись перед push" ;;
      *)
        echo "checks на ${BR}: статус отримати не вдалося (API відповів «${INFO:-нічого}»)" ;;
    esac
  done
else
  echo "(статус checks на main/beta НЕВІДОМИЙ: немає gh або він не залогінений —"
  echo " подивись вкладку Actions руками, перш ніж пушити в main/beta)"
fi

echo ""
echo "── docs/ARCHITECTURE.md §8 — «Лишається» ────────────────────────────"
awk '/^\*\*Лишається:\*\*/{f=1} f' docs/ARCHITECTURE.md 2>/dev/null | head -40
echo "─────────────────────────────────────────────────────────────────────"
exit 0
