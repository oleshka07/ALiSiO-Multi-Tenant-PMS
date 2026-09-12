/**
 * Правка, якою рухають гроші, лишає слід в історії.
 *
 *   node src/modules/bookings/domain/history-actions.check.ts
 *
 * ── Дефект, проти якого це написано ─────────────────────────────────────
 *
 * Власник прийняв оплату, змінив платника — і «Історія змін» лишилась
 * порожньою. Список подій був стрічкою `if`-ів усередині обробника й
 * складався з девʼяти полів; платник, прейскурант, знижка й сніданок у
 * ньому не значились.
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 * Не «є така-то гілка коду», а ВЛАСТИВІСТЬ: для кожного поля картки, яким
 * рухають гроші або документ, правка дає щонайменше один запис, і роди
 * записів РІЗНІ — інакше в журналі буде десять рядків «змінено бронь».
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. Поставили фірму / зняли фірму — два різні тексти. З одним напрямком
 *    твердження зелене й на писачі, який завжди пише «Платник → …».
 * 2. Знижка 15% і знижка 0 — «знято» це теж подія, і вона мусить читатись.
 * 3. Правка, яка НІЧОГО не змінила (та сама фірма) — запису не лишає:
 *    журнал із рядками «нічого не сталось» перестають читати.
 * 4. Порожнє тіло — нуль записів.
 */
import { historyActionsFor } from './history-actions.ts';

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};
const kinds = (rows: { action: string }[]) => rows.map((r) => r.action).sort().join(',');

// ── 1. Порожня правка ────────────────────────────────────────────────────
say(historyActionsFor({}, {}, {}).length === 0, 'порожнє тіло не лишає записів');

// ── 2. Платник: поставили ────────────────────────────────────────────────
const setPayer = historyActionsFor(
  { company_id: 'c1' },
  { invoice_company_name: null },
  { invoice_company_name: 'Фірма А' });
say(kinds(setPayer) === 'payer_change', `зміна платника — окремий рід (${kinds(setPayer) || 'нічого'})`);
say(setPayer[0]?.details.includes('Фірма А'),
  `у записі НАЗВА фірми, а не ідентифікатор (${setPayer[0]?.details ?? '—'})`);

// ── 3. Платник: зняли ────────────────────────────────────────────────────
const clearPayer = historyActionsFor(
  { company_id: null },
  { invoice_company_name: 'Фірма А' },
  { invoice_company_name: null });
say(kinds(clearPayer) === 'payer_change', 'зняття платника теж подія');
say(clearPayer[0]?.details !== setPayer[0]?.details,
  `поставили і зняли читаються ПО-РІЗНОМУ (${clearPayer[0]?.details ?? '—'})`);

// ── 4. Правка, яка нічого не змінила ─────────────────────────────────────
const same = historyActionsFor(
  { company_id: 'c1' },
  { invoice_company_name: 'Фірма А' },
  { invoice_company_name: 'Фірма А' });
say(same.length === 0, `та сама фірма — запису немає (${kinds(same) || 'нічого'})`);

// ── 5. Прейскурант ───────────────────────────────────────────────────────
const plan = historyActionsFor({ rate_plan_id: 'rp1' }, {}, {});
say(kinds(plan) === 'rate_plan_change', `прейскурант — окремий рід (${kinds(plan) || 'нічого'})`);
say(historyActionsFor({ rate_plan_id: null }, {}, {})[0]?.details.includes('знято'),
  'знятий прейскурант читається як знятий');

// ── 6. Знижка: є і немає ─────────────────────────────────────────────────
const disc = historyActionsFor({ lodging_discount_percent: 15, lodging_discount_reason: 'Постійний гість' }, {}, {});
say(kinds(disc) === 'discount_change', `знижка — окремий рід (${kinds(disc) || 'нічого'})`);
say(disc[0]?.details.includes('15') && disc[0]?.details.includes('Постійний гість'),
  `у записі і відсоток, і причина (${disc[0]?.details ?? '—'})`);
const noDisc = historyActionsFor({ lodging_discount_percent: 0 }, { lodging_discount_percent: 15 }, {});
say(noDisc[0]?.details.includes('знято'), `нуль читається як «знято», а не «знижка → 0%» (${noDisc[0]?.details ?? '—'})`);

// ── 7. Сніданок: три стани ───────────────────────────────────────────────
const bYes = historyActionsFor({ breakfast_included: true }, {}, {})[0]?.details ?? '';
const bNo = historyActionsFor({ breakfast_included: false }, {}, {})[0]?.details ?? '';
const bRule = historyActionsFor({ breakfast_included: null }, {}, {})[0]?.details ?? '';
say(new Set([bYes, bNo, bRule]).size === 3,
  `три стани сніданку — три різні рядки (${[bYes, bNo, bRule].join(' | ')})`);

// ── 8. Старі девʼять не загубились ───────────────────────────────────────
const old = historyActionsFor({
  status: 'checked_in', payment_status: 'paid', total_price: 500,
  adults: 3, unit_id: 'u2', check_in: '2027-01-01', notes: 'x',
  internal_notes: 'y', registration_status: 'registered',
}, { currency: 'EUR', adults: 2, children: 0, unit_code: '101' }, {});
say(old.length === 9, `девʼять давніх подій на місці, отримали ${old.length}`);
say(new Set(old.map((r) => r.action)).size === 9, 'і кожна зі своїм родом');

// ── 9. Одна правка — кілька подій ────────────────────────────────────────
//
// Портьє міняє прейскурант, і ціна перераховується разом із ним: у журналі
// мусять бути ОБИДВА рядки, інакше «ціна змінилась» виглядає безпричинною.
const both = historyActionsFor({ rate_plan_id: 'rp2', total_price: 240 }, { currency: 'EUR' }, {});
say(kinds(both) === 'price_change,rate_plan_change',
  `тариф і ціна — два записи, не один (${kinds(both)})`);

if (fails.length) { console.error(`\nhistory-actions: ${fails.length} червоних`); process.exit(1); }
console.log('history-actions: платник, прейскурант, знижка й сніданок лишають слід, і кожен свій');
