/**
 * Попередження над списком броней говорять мовою готелю.
 *
 *   node src/modules/dashboard/domain/alerts.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * `/api/alerts` складав повідомлення сам: «Прострочений заїзд …», «Сьогодні
 * заїзд, оплата не завершена — …». Українською, у SQL-хендлері, без жодного
 * `t()`. Німецький портьє відкривав /app/bookings і бачив стіну українського
 * тексту — на першому екрані, який він відкриває сам, і обхід був «заходь у
 * броні через календар, не через список».
 *
 * Перекласти це на місці не можна, і не з ліні: `check-i18n-leak` забороняє
 * `t()` під `src/app/api` навмисно — мова оператора не сміє вирішувати, якою
 * мовою вийде документ чи лист гостю. Тому API віддає КОД, а рядок складає
 * екран.
 *
 * Такий поділ має власну ціну: сторони можуть розійтися. Додати код в API і
 * забути `case` на екрані — і портьє побачить порожній рядок замість
 * попередження; збірка змовчить, бо `default` є. Тому третя перевірка нижче
 * зводить обидві сторони до одного списку.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { ALERT_TYPES } from './alerts.ts';

const HANDLER = 'src/modules/dashboard/api/alerts.handlers.ts';
const SCREEN = 'src/app/app/(dashboard)/bookings/page.tsx';

const handler = fs.readFileSync(HANDLER, 'utf8');
const screen = fs.readFileSync(SCREEN, 'utf8');
// Коментарі пояснюють рядки, яких БІЛЬШЕ немає, — гейт, який їх не відрізняє,
// падає на власній документації. Уже було.
const handlerCode = handler.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const screenCode = screen.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');

// ── В API не лишилось жодного речення для людини ─────────────────────
//
// Кирилиця в хендлері — це або старе повідомлення, або нове, написане тим
// самим способом. Обидва читає німецький портьє.
const cyrillic = handlerCode.match(/[а-яїієґА-ЯЇІЄҐ]{3,}/g) ?? [];
assert.deepStrictEqual(cyrillic, [],
  `у /api/alerts лишився текст для людини: ${cyrillic.join(', ')} — його не перекладе ніхто`);
assert.ok(!/\bmessage\s*:/.test(handlerCode),
  'готовий `message` з API — це і є те, що портьє читав чужою мовою');
console.log('  ok  /api/alerts віддає код і дані, а не готове речення');

// ── Екран справді перекладає ─────────────────────────────────────────
assert.ok(/alertText\(/.test(screenCode), 'екран мусить складати текст попередження сам');
const fn = screenCode.slice(screenCode.indexOf('function alertText'));
const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
assert.ok(body.length > 200, 'не знайшов тіло alertText — гейт дивиться не туди');
const wrapped = [...body.matchAll(/t\('([^']+)'\)/g)].map((m) => m[1]);
// Рівно стільки, скільки кодів: кожен малює одне речення. «Не менше» тут було
// б послабленням рівно на той випадок, який і треба ловити, — один case, з
// якого прибрали t(), лишає рядок українською для всіх.
assert.strictEqual(wrapped.length, ALERT_TYPES.length,
  `у alertText ${wrapped.length} рядків через t(), а кодів ${ALERT_TYPES.length} — котрийсь case лишився без перекладу`);
for (const s of wrapped) {
  assert.ok(/[а-яїієґ]/i.test(s), `«${s}» — не українське джерело, словник його не знайде`);
}
// Назва номера й дата — дані готелю. Загорнути їх у t() означало б спробувати
// перекласти «DZ 204», і словник відповів би тим самим рядком назавжди.
assert.ok(!/t\(\s*`/.test(body) && !/t\(a\./.test(body),
  'у t() не можна класти дані: назва номера й дата не перекладаються');
console.log(`  ok  екран перекладає ${wrapped.length} рядків, дані лишає як є`);

// ── Сторони не розійшлися ────────────────────────────────────────────
//
// Код, доданий в API без case на екрані, дає порожній рядок замість
// попередження — і збірка мовчить, бо default є.
for (const type of ALERT_TYPES) {
  assert.ok(handlerCode.includes(`'${type}'`),
    `код «${type}» є в реєстрі, але /api/alerts його не віддає — мертвий рядок реєстру`);
  assert.ok(body.includes(`case '${type}'`),
    `код «${type}» приходить з API, а екран його не малює — портьє побачить порожньо`);
}
const emitted = [...handlerCode.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1]);
for (const type of new Set(emitted)) {
  assert.ok((ALERT_TYPES as readonly string[]).includes(type),
    `/api/alerts віддає «${type}», якого немає в реєстрі alerts.ts`);
}
console.log(`  ok  ${ALERT_TYPES.length} кодів: реєстр, API та екран сходяться`);

console.log('попередження над бронями: код з API, речення з екрана');
