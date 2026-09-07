/**
 * Число клітинки й підпис під ним походять з ОДНОГО розрахунку.
 *
 *   node src/modules/pricing/ui/price-origin.check.ts
 *
 * Рецензія раунду 9, Р9.2 — блокер. На живій базі екран цін показував
 * «100 · матриця заселеності», тоді як матриця казала 120 — стільки й платив
 * гість. Число малювала сітка календаря (`getPriceMonth`), підпис приходив із
 * `priceNights`, де матриця перекриває календар. Два резолвери на одну
 * клітинку.
 *
 * Осі (інваріант 26). Твердження стверджує, що число і підпис нерозривні,
 * тому фікстура містить випадки, де вони РІЗНЯТЬСЯ між собою: ціна гостя 120
 * проти числа рядка 100 (несумісні арифметично — «взяли не те» не може дати
 * ту саму відповідь), і день без ціни гостя, де підпису бути не може.
 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import '../../../../scripts/lib/module-aliases.mjs';

const { cellPrice, ORIGIN_LABELS } = await import('./price-origin.ts');

// ── 1. Матриця перекриває календар: показуємо ЇЇ число і ЇЇ підпис ────────
//
// Це і є Р9.2. 100 і 120 обрані несумісними: якби функція взяла число з
// рядка, а підпис із гостя, вона дала б 100 + 'matrix' — саме те, що бачив
// контролер на екрані.
const overridden = cellPrice({ effective_price: 100, guest: { price: 120, origin: 'matrix' } });
assert.strictEqual(overridden.price, 120,
  'клітинка показує те, що платить гість: 120 з матриці, а не 100 з рядка календаря');
assert.strictEqual(overridden.origin, 'matrix');

// ── 2. Календар сам себе цінує: число те саме, підпис свій ────────────────
//
// Друге значення осі «чи перекриває джерело рядок». Без нього «завжди брати
// guest.price» і «завжди брати effective_price» розрізнити не можна було б.
const plain = cellPrice({ effective_price: 115, guest: { price: 115, origin: 'unit_type_weekend' } });
assert.strictEqual(plain.price, 115);
assert.strictEqual(plain.origin, 'unit_type_weekend');

// ── 3. Ціни гостя немає: число рядка БЕЗ підпису ──────────────────────────
//
// Закрита ніч і ніч без джерела ціни падають у `missing` резолвера, тож
// сказати, скільки заплатить гість, ми не можемо. Число оператор мусить
// бачити — він його редагує, — але пояснювати нам нічим, і вигадувати підпис
// із полів рядка означало б повернути другий резолвер.
const closed = cellPrice({ effective_price: 333, guest: null });
assert.strictEqual(closed.price, 333, 'число рядка лишається видимим — його редагують');
assert.strictEqual(closed.origin, null, 'без ціни гостя підпису немає: неправдивий підпис гірший за відсутній');

const noGuestField = cellPrice({ effective_price: 333 });
assert.strictEqual(noGuestField.origin, null, 'відсутнє поле — те саме, що null');

// ── 4. Ні числа, ні ціни гостя ────────────────────────────────────────────
const empty = cellPrice({ effective_price: null, guest: null });
assert.strictEqual(empty.price, null);
assert.strictEqual(empty.origin, null);

// ── 5. Кожен підпис є в каталозі перекладів ───────────────────────────────
//
// `t(ORIGIN_LABELS[origin])` — це `t()` зі ЗМІННОЮ, і екстрактор таких місць
// не бачить: наступний доданий ключ мовчки лишиться неперекладним, при
// заявлених 100 % покриття (`check-translations` рахує каталог, а не екран).
// Рецензія раунду 9, Р9.7. Тому властивість перевіряється тут прямо, без
// екстрактора: кожне значення мапи мусить бути ключем каталогу.
const catalogue = new Set<string>(JSON.parse(
  await readFile(new URL('../../../core/i18n/messages/catalogue.json', import.meta.url), 'utf8')) as string[]);
for (const [origin, label] of Object.entries(ORIGIN_LABELS)) {
  assert.ok(catalogue.has(label),
    `${origin}: підпис «${label}» не в каталозі — t() зі змінною екстрактор не бачить, ключ треба додати руками`);
}

console.log('price-origin: клітинка бере число й підпис з одного джерела, і без ціни гостя не підписує нічого');
