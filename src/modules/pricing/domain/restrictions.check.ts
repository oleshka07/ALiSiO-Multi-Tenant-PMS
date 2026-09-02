/**
 * Обмеження перебування: закрито, мінімум і максимум ночей, заїзд, виїзд.
 *
 *   node src/modules/pricing/domain/restrictions.check.ts
 *
 * Д1/Д2 карти сертифікації (INC-012): ці поля пишуться з екрана «Ціни» і до
 * 02.09 не читались ніким. Тут — чиста функція, яка каже, ЧОМУ перебування
 * не продається; обидва споживачі (котирування → віджет і бронювання; батчер
 * → канал) читають одні й ті самі рядки, тож і відмова одна.
 *
 * Семантика — та, що в менеджера каналів для «arrival»: мінімум і максимум
 * ночей та заборона заїзду читаються з ночі ЗАЇЗДУ; заборона виїзду — з
 * дати ВИЇЗДУ (це не ніч, а ранок). Закрита ніч усередині — не продається
 * взагалі, як і неоцінена (інваріант 17).
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import { stayRefusal, type StayRestrictions } from './restrictions.ts';

const open: StayRestrictions = { minStay: 1, maxStay: null, noArrival: false, noDeparture: false, closedNights: [] };

assert.strictEqual(stayRefusal(open, 1), null, 'без обмежень — продається');
assert.strictEqual(stayRefusal({ ...open, closedNights: ['2026-12-24'] }, 3), 'closed', 'закрита ніч усередині — не продається, і це названо');
// Два різні мінімуми, і кожен число, з яким відповідь несумісна для сусіда (інваріант 26).
assert.strictEqual(stayRefusal({ ...open, minStay: 2 }, 1), 'min_stay');
assert.strictEqual(stayRefusal({ ...open, minStay: 2 }, 2), null);
assert.strictEqual(stayRefusal({ ...open, minStay: 3 }, 2), 'min_stay');
assert.strictEqual(stayRefusal({ ...open, minStay: 3 }, 3), null);
assert.strictEqual(stayRefusal({ ...open, maxStay: 4 }, 5), 'max_stay');
assert.strictEqual(stayRefusal({ ...open, maxStay: 4 }, 4), null);
assert.strictEqual(stayRefusal({ ...open, noArrival: true }, 2), 'no_arrival');
assert.strictEqual(stayRefusal({ ...open, noDeparture: true }, 2), 'no_departure');
// Закрито важливіше за мінімум: гість має почути «закрито», а не «мало ночей».
assert.strictEqual(stayRefusal({ ...open, minStay: 5, closedNights: ['2026-12-24'] }, 1), 'closed');
console.log('  ok  відмова названа: закрито, мінімум, максимум, заїзд, виїзд — і закрито першим');
// ── Споживачі названі статично: віджет питає відмову в пошуку і при бронюванні ──
//
// Гейт котирування доводить, що обмеження ЧИТАЮТЬСЯ; гейт батчера — що вони
// ЇДУТЬ у канал. Третій споживач — віджет — без цього рядка міг би знову
// мовчки їх не питати: саме так дефект і жив (INC-012).
{
  const fs = await import('node:fs');
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const rel of ['../../widget/api/widget-availability.handlers.ts', '../../widget/api/widget-reserve.handlers.ts']) {
    const src = strip(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
    assert.ok(/stayRefusal\(/.test(src), `${rel}: віджет не питає відмови — закрита ніч знову продається`);
    assert.ok(/\.restrictions\b/.test(src), `${rel}: обмеження котирування не читаються`);
  }
}
console.log('  ok  віджет — і пошук, і бронювання — питає відмову');

console.log('restrictions: обмеження перебування читаються одним правилом для віджета, бронювання й каналу');
