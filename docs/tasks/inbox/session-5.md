TASK: 6

# Сесія 5 — задача 6: застосунок `winhotel-import` (кодова, нова гілка)

Дослідження й файл готелю прийняті (рецензії 1–4). Тепер — код. Гілка:

```
git fetch origin
git checkout -b claude/winhotel-import origin/claude/block-apps
git merge --no-edit origin/claude/winhotel-schema     # дослідження + hotels/schlossberghotel.json
npx tsc --noEmit && npm run check                      # зелено ДО першої правки
git push -u origin claude/winhotel-import
```

Задача цілком — `docs/tasks/2026-09-10-block-winhotel-import.md` на `origin/claude/controller-2`
(прочитай через `git show origin/claude/controller-2:docs/tasks/2026-09-10-block-winhotel-import.md`
і скопіюй у свою гілку тим самим шляхом першим комітом). Порядок: §0 → §1 → §2.1–2.4 + §2.7
(частина А) → звіт → чекпоінт контролера → §2.5–2.6 (частина Б). Гілку робіт
`origin/claude/channex-integration-66kv65` підбирати злиттям, коли рушить. Питань власнику не
ставити. Після звіту частини А — цикл очікування, `MINE=6`:

```
MINE=6; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-5.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-5.md; break; }; sleep 300; done
```
