-- 0095: статус оплати броні перераховується З ФОЛІО (В3, рішення власника 07.09)
--
-- Фоліо — єдина книга проживання. Слово в `reservations.payment_status`
-- виводиться з неї, а не є другою книгою поруч.
--
-- У чинних базах книги вже розійшлися: слово ставили троє — картка фоліо
-- (лише `paid`), фінансовий модуль зі своєї суми `fin_operations` і маркер
-- оплати з ТИПУ натиснутої кнопки, без жодної суми за ним. Видимий наслідок:
-- 3000 наперед із 5000 через фоліо давали борг 2000 на виселенні, а ті самі
-- 3000 через касу — 5000.
--
-- Міграція нічого не вигадує, але вона НЕ тотожна `statusFromFolio` і не
-- мусить бути: вона одноразова і навмисно обережніша.
--   є нарахування проживання і борг <= 0           → 'paid'
--   є проживання, гроші прийшли, але не всі        → 'partial'
--   усе інше                                       → слово лишається як було
--
-- Чого тут НЕМАЄ і що є в домені: «нараховано, а гроші в книзі БУЛИ і їх не
-- стало» → 'unpaid'. Це відповідь про подію (зустрічний рядок зняв платіж), а
-- не про залишок; оптом по спадку вона перевела б у «не оплачено» броні,
-- яких ніхто не чіпав. Тотожність тут раніше була заявлена — і після Р8.7
-- перестала бути правдою (Р10.10).
--
-- Кожна бронь, де було інакше, називається в лозі поіменно: розбіжність — це
-- те, що хтось має побачити, а не те, що тихо зникає під `UPDATE`.
--
-- `is_prepaid` не чіпається: канал зібрав гроші з гостя, і часткова виплата на
-- рахунок готелю не робить бронь «частково оплаченою» для рецепції.
--
-- Перезапускна: другий прохід нічого не змінює, бо слово вже дорівнює
-- порахованому.
DO $$
DECLARE
  r record;
  changed int := 0;
BEGIN
  FOR r IN
    SELECT res.id,
           res.payment_status AS was,
           CASE
             WHEN round((f.charged - f.paid)::numeric, 2) <= 0 THEN 'paid'
             WHEN f.paid > 0 THEN 'partial'
             ELSE NULL
           END AS word
      FROM reservations res
      JOIN LATERAL (
        SELECT
          COALESCE((SELECT SUM(i.total_gross) FROM fin_folio_items i
                      JOIN fin_folios fo ON fo.id = i.folio_id
                     WHERE fo.reservation_id = res.id AND i.voided_by_item_id IS NULL), 0) AS charged,
          COALESCE((SELECT SUM(p.amount) FROM fin_folio_payments p
                      JOIN fin_folios fo ON fo.id = p.folio_id
                     WHERE fo.reservation_id = res.id), 0) AS paid,
          (SELECT COUNT(*) FROM fin_folio_items i
              JOIN fin_folios fo ON fo.id = i.folio_id
             WHERE fo.reservation_id = res.id AND i.voided_by_item_id IS NULL AND i.kind = 'lodging') AS lodging
      ) f ON TRUE
     WHERE COALESCE(res.is_prepaid, FALSE) <> TRUE
       AND f.charged > 0
       AND f.lodging > 0
  LOOP
    IF r.word IS NOT NULL AND r.word IS DISTINCT FROM r.was THEN
      UPDATE reservations SET payment_status = r.word WHERE id = r.id;
      RAISE NOTICE '0095: % — % → % (книги розходились)', r.id, r.was, r.word;
      changed := changed + 1;
    END IF;
  END LOOP;
  IF changed > 0 THEN
    RAISE NOTICE '0095: статус оплати перераховано з фоліо для % брон(і/ей)', changed;
  END IF;
END $$;
