TASK: 9

# Сесія 5 — задача 9: хвости живого проходу №3 і смуга міграцій

Рецензія Б2 — `docs/tasks/2026-09-10-review-winhotel-import-B2.md` на `origin/claude/controller-2`:
задачу 8 прийнято, живий прохід №3 зійшовся по компаніях (2 143), родах рядків (`lodging`
163 709,09 € із 202 710,49 €), оплатах (458, усі `import`). Чотири хвости, усі малі:

1. Рядок звірки «майбутні брони, живі, без staging»: Winhotel 889, наші 901 → `mismatch: true`.
   Порахувати обидва боки одним SQL, виправити той, що бреше; гейт на фікстурі зі staged
   майбутніми ≠ 0 (зараз, схоже, ця вісь вироджена — інваріант 26).
2. `GASTKREF.EXT_SOURCE` — номери броней каналу, не назви (живі: `18778622`, `2140901178`…).
   Знайти в живому витягу `booking_refs` колонку з назвою каналу (Booking.com / DIRS21 /
   Onlinebuchung), мапити її в `booking_sources`; номер — в `external_ref`. Якщо назви немає
   ніде — сказати, які колонки є, і лишити `direct` з поясненням.
3. **Міграції у смугу 04xx:** злити `origin/claude/block-apps` (`142d7071`; там 0140–0142 →
   0400–0402), перейменувати `0143 → 0403`, `0144 → 0404`, `0145 → 0405`; `db.ts`, ARCHITECTURE,
   звіти, `schema.sql` — за новими іменами; після злиття жодної міграції під двома іменами
   (`ls db/postgres/migrations | sed 's/-.*//' | sort | uniq -d` порожній, крім давнього 0034).
4. CI гілки — рядок у звіт із номером запуску.

Звіт — розділ «Задача 9». Потім цикл, `MINE=9`:

```
MINE=9; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-5.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-5.md; break; }; sleep 300; done
```
