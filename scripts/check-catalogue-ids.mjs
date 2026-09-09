#!/usr/bin/env node
/**
 * Ідентифікатор рядка довідника не буває літералом у коді.
 *
 *   node scripts/check-catalogue-ids.mjs            # звіт
 *   node scripts/check-catalogue-ids.mjs --strict   # валить збірку
 *
 * План рахунків і бізнес-юніти сіялись колись із ЛІТЕРАЛЬНИМИ первинними
 * ключами — `ec_accommodation`, `ec_capex`, `bu_shared`, — тобто один комплект
 * на всю базу (INC-025). Тепер ідентифікатор випадковий і належить готелю, а
 * стала величина — `code`, унікальний у межах організації. Звідси властивість:
 * **рядок довідника знаходять за кодом і орендарем, ніколи за написаним у коді
 * ідентифікатором.**
 *
 * Чому це гейт, а не уважність. Літерал не падає і не помиляється видимо: у
 * готелю з випадковими ключами умова `category_id = 'ec_capex'` просто НЕ
 * ВИКОНУЄТЬСЯ НІКОЛИ. Розділ «CapEx дублікати» у фінансовому аудиті через це
 * назавжди зелений — він доповідає «немає підозрілих дублів» не тому, що їх
 * немає, а тому, що питає про ключ, якого ні в кого немає (Р12.4). Перевірка,
 * яка не може стати червоною, гірша за відсутню: відсутня нічого не обіцяє.
 *
 * Вісь — ВЛАСТИВІСТЬ, не візерунок: будь-яка форма лапок, будь-який код.
 * Правильна заміна — підзапит за кодом і орендарем прямо в SQL:
 *
 *     fo.category_id = (SELECT id FROM expense_categories
 *                        WHERE organization_id = ci.organization_id AND code = 'capex')
 *
 * або `categoryIdByCode('capex')` у коді, всередині контексту орендаря.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOTS = ['src', 'scripts'];
// Літерал `ec_<код>` / `bu_<код>` у лапках БУДЬ-ЯКОГО роду. Згенерований
// ідентифікатор під нього не підпадає за побудовою: там шаблон
// (`ec_${crypto.randomBytes(…)}`), а не літера одразу після підкреслення.
const LITERAL = /(['"`])(?:ec|bu)_[a-z][a-z0-9_]*\1/g;

// Вирізаються коментарі JS — інакше гейт лічить власну документацію (AGENTS
// §4). Коментаря SQL (`--` усередині шаблонного рядка) він НЕ знає, і це
// названо навмисно: перший же прогін після правки почервонів на поясненні,
// написаному в тому самому запиті. Робити стрипер розумнішим тут дорожче, ніж
// правило «у коментарі SQL ключ пишеться без лапок» — `--` у JS це ще й
// декремент, а всередині рядків він нічого не відкриває.
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(full); continue; }
    if (/\.(tsx?|mjs|js)$/.test(e.name)) yield full;
  }
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = file.split(path.sep).join('/');
    const lines = withoutComments(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      LITERAL.lastIndex = 0;
      for (const m of line.match(LITERAL) || []) {
        hits.push({ file: rel, line: i + 1, literal: m, text: line.trim().slice(0, 110) });
      }
    });
  }
}

if (hits.length === 0) {
  console.log('catalogue-ids: жодного літерального ключа довідника — рядок шукають за кодом і орендарем');
  process.exit(0);
}

console.log(`catalogue-ids: ${hits.length} літеральних ключ(ів) довідника`);
for (const h of hits) console.log(`  ${h.file}:${h.line}  ${h.literal}\n      ${h.text}`);
if (!STRICT) process.exit(0);

console.error('\n  ✗ ключ довідника належить ГОТЕЛЮ, і в коді його бути не може.'
  + ' Умова з таким літералом не спрацьовує в жодного готелю з випадковими'
  + ' ідентифікаторами — і мовчить про це. Беріть `code` + орендаря:'
  + ' `categoryIdByCode(\'capex\')` або підзапит у SQL.');
process.exit(1);
