/**
 * Збори й мито поверх ціни за проживання.
 *
 * ── Чому цей файл узагалі є ─────────────────────────────────────────────
 *
 * `fees_taxes` існує від початку, квота її читає й додає до підсумку — але
 * наповнював таблицю лише demo-seed. Ні екрана, ні CRUD-хендлера, ні секції
 * у файлі готелю. Тобто в кожного реального клієнта міське мито й прибирання
 * в квоті **завжди нуль**, і виглядає це не як помилка, а як «цей готель
 * таких зборів не має».
 *
 * Портьє називає гостю суму з цього екрана. Якщо мито не додалось, готель
 * або доплачує його з власної кишені, або догадується на виїзді — і те, й
 * інше гість дізнається вже після того, як почув ціну.
 *
 * Арифметика винесена сюди чистою, щоб її фіксував гейт без бази: це гроші,
 * і кожен із пʼяти типів помиляється по-своєму.
 *
 * ── Одне рішення, яке варто назвати вголос ──────────────────────────────
 *
 * `per_person_per_night` рахувався як `amount * adults * nights`, а сусідній
 * `per_person` — як `amount * (adults + children)`. Тобто два поля з тим
 * самим словом «person» рахували різні множини людей, і ніде не було
 * сказано чому.
 *
 * Тепер обидва рахують усіх гостей — те, що написано на етикетці. Це не
 * дрібниця смаку: готель, який заводить «Сніданок, за особу за ніч», отримав
 * би недобір на кожній дитині, і побачив би це аж у звіті.
 *
 * Курортне мито в багатьох юрисдикціях дітей звільняє — але це ПРАВИЛО
 * звільнення, а не інше значення слова «особа». Коли воно знадобиться, це
 * буде окреме поле (`applies_to`), а не мовчазна переінтерпретація. Міняти
 * це зараз безпечно рівно тому, що таблиця в усіх реальних клієнтів порожня:
 * виправити арифметику до того, як у ній зʼявляться гроші, — єдиний момент,
 * коли це нічого не коштує.
 */

// Відносний шлях із розширенням, а не аліас: цей файл читає ще й гейт, який
// запускають голим node, а `@core/…` знає лише бандлер.
import { money, percentOf, sumMoney } from '../../../core/money.ts';

export type FeeType =
  | 'per_stay'
  | 'per_night'
  | 'per_person'
  | 'per_person_per_night'
  | 'percentage';

export interface Fee {
  name: string;
  type: FeeType | string;
  amount: number | string;
}

export interface FeeContext {
  nights: number;
  adults: number;
  children: number;
  accommodationTotal: number;
}

export interface FeeLine { name: string; amount: number }

/**
 * Скільки додає кожен збір і скільки вони дають разом.
 *
 * Нуль і відʼємне не потрапляють у розбивку: рядок «Прибирання 0» у квоті
 * для гостя — шум, а відʼємний збір — це знижка, і вона живе в іншому місці.
 */
export function applyFees(
  fees: readonly Fee[],
  ctx: FeeContext,
): { feeBreakdown: FeeLine[]; feesTotal: number } {
  const nights = Math.max(0, Math.trunc(Number(ctx.nights) || 0));
  const adults = Math.max(0, Math.trunc(Number(ctx.adults) || 0));
  const children = Math.max(0, Math.trunc(Number(ctx.children) || 0));
  const guests = adults + children;
  const accommodation = Number(ctx.accommodationTotal) || 0;

  const feeBreakdown: FeeLine[] = [];

  for (const fee of fees || []) {
    const amount = Number(fee?.amount);
    if (!Number.isFinite(amount)) continue;

    let line = 0;
    switch (fee.type) {
      // `money()` на кожному множенні, бо double не має 0.10: мито 0,10 € на
      // трьох гостей дає 0.30000000000000004, і це число їде в квоту й далі
      // в базу. Округлення на виході не рятує — там уже неправильне значення.
      case 'per_stay': line = money(amount); break;
      case 'per_night': line = money(amount * nights); break;
      case 'per_person': line = money(amount * guests); break;
      case 'per_person_per_night': line = money(amount * guests * nights); break;
      // Відсоток рахується від проживання, а не від проміжного підсумку:
      // інакше порядок зборів у таблиці міняв би суму, і два готелі з
      // однаковими правилами отримували б різні числа.
      //
      // `percentOf`, а не `Math.round(x / 100)`: друге округлювало до цілого,
      // тобто 10 % від 119 € давало 12 € замість 11,90 €. У кронах ця втрата
      // непомітна, в євро це центи в кожній квоті — і саме той інваріант 9,
      // заради якого money.ts існує.
      case 'percentage': line = percentOf(accommodation, amount); break;
      // Тип поза CHECK-обмеженням схеми означає, що база змінилась, а цей
      // файл — ні. Тихо додати нуль — значить недорахувати гроші й нічого
      // про це не сказати.
      default:
        console.error(`[fees] невідомий тип збору «${fee.type}» (${fee.name}) — не враховано`);
        continue;
    }

    if (line > 0) {
      feeBreakdown.push({ name: String(fee.name ?? ''), amount: line });
    }
  }

  // Одне округлення на підсумку, а не накопичення `+=`: інакше хвости кожного
  // рядка складаються, і сума зборів у квоті не дорівнює сумі своїх же рядків.
  return { feeBreakdown, feesTotal: sumMoney(feeBreakdown.map((f) => f.amount)) };
}
