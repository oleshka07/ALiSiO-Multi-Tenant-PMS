-- 0094: reservations.payment_status приймає 'partial'
--
-- Колонка мала CHECK на чотири значення — 'unpaid', 'payment_requested',
-- 'prepaid', 'paid', — а два писачі ставлять пʼяте:
--
--   src/modules/finance/api/operations.handlers.ts:891
--     після кожної фінансової операції з бронню перераховує сплачене:
--     гроші є, але менші за суму → 'partial';
--   src/app/api/payments/route.ts:139-140
--     позначка оплати з типом 'deposit' або 'partial'.
--
-- Обидва впирались у CHECK. Внесок при цьому вже записано, а запит віддає
-- помилку — тобто депозит лежить у фінансах, бронь лишається «не оплачено»,
-- і оператор, побачивши помилку, має всі підстави провести оплату вдруге.
-- Планер уже читав це значення (`calendar/page.tsx:559`, «неоплачені») і не
-- міг побачити його ніколи.
--
-- Обмеження знімається за ОЗНАЧЕННЯМ, а не за іменем: на свіжій базі його вже
-- створив db/postgres/schema.sql під власним іменем від генератора, і сторож
-- за `conname` не знайшов би нічого й додав другий такий самий CHECK.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'reservations'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%payment_status%'
       AND pg_get_constraintdef(oid) NOT LIKE '%partial%'
  LOOP
    EXECUTE format('ALTER TABLE reservations DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'reservations'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%payment_status%'
       AND pg_get_constraintdef(oid) LIKE '%partial%'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_payment_status_check
      CHECK (payment_status IN ('unpaid', 'payment_requested', 'partial', 'prepaid', 'paid'));
  END IF;
END $$;
