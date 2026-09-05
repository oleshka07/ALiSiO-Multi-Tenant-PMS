/**
 * Звіт міграції матриці цін у сезони + надбавки — СУХИЙ ПРОГІН, нічого не пише.
 *
 *   node scripts/report-matrix-migration.mjs [--out docs/….md] [--org <id>]
 *   DB_DRIVER=postgres DATABASE_URL=… node scripts/report-matrix-migration.mjs
 *
 * Блок 2 кроки 1 і 3 (Ц27, Ц30) завели два джерела, які разом ЗАМІНЯЮТЬ
 * матрицю `price_occupancy` (тип × вікно дат × скільки дорослих → ціна ночі):
 *
 *   * сезон з клітинкою «ціна типу за базову заселеність» (`seasons`,
 *     `season_prices`) — це рядок матриці з `persons = base_occupancy`;
 *   * правило «дорослий понад базу +N» (`extra_occupancy_rules`) — це різниця
 *     сусідніх рядків матриці, і вона мусить бути ОДНАКОВОЮ для кожного
 *     наступного дорослого, бо правило одне на всіх понад базу.
 *
 * Що НЕ зводиться до цих двох (інваріант 17: не вигадувати, а назвати):
 *
 *   * рядок на МЕНШЕ дорослих, ніж база (одинак у двомісному за 89 проти 119):
 *     Ц30 не має знижки нижче бази — або опустити `base_occupancy` типу до
 *     найменшої заселеності матриці і виразити решту надбавками вгору, або
 *     лишити рядок у матриці (котирування читає її й далі);
 *   * нелінійні різниці (+30 за третього, +20 за четвертого): одне правило
 *     цього не скаже — потрібне рішення готелю, яке число правильне;
 *   * вікна дат, що перетинаються між типами по-різному — сезон один на
 *     обʼєкт, тож межі треба вирівняти;
 *   * `price_los_tiers` (знижка від N ночей) — це правило ціни §2.5, не сезон
 *     і не надбавка; у цьому кроці не мігрується.
 *
 * Чому окремий скрипт, а не міграція: міграція, що «здогадується», — це
 * бронювання за ціною, якої готель не називав. Звіт кладеться перед власником;
 * після його «так» пишеться накат — окремим кроком і зі своїм гейтом.
 *
 * Читає кожну організацію в її контексті (`runWithOrganization`), тож на
 * Postgres із політиками бачить рівно те, що бачить сама організація. Таблиці
 * модуля цін читаються через його фасад `@pricing` (межі модулів), не SQL.
 */
import fs from 'node:fs';
import './lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { occupancyMatrixOf, listSeasons, listExtraOccupancyRulesOf } = await import('@pricing');

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const outPath = argOf('--out');
const onlyOrg = argOf('--org');

const sql = getSql();
const out = [];
const say = (s = '') => out.push(s);
const money = (n) => Math.round(Number(n) * 100) / 100;
const fmt = (n) => (n == null ? '—' : String(money(n)));

const totals = { organizations: 0, properties: 0, matrixRows: 0, seasons: 0, adultRules: 0, warnings: 0 };

say('# Звіт міграції матриці цін → сезони + надбавки (сухий прогін)');
say('');
say(`Згенеровано: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · драйвер: ${process.env.DB_DRIVER === 'postgres' ? 'postgres' : 'sqlite'}`);
say('');
say('Нічого не записано. Кожен рядок нижче — пропозиція; «⚠» — те, що не зводиться без рішення готелю.');
say('');

const orgs = await sql.rows(
  `SELECT id, name FROM organizations ${onlyOrg ? 'WHERE id = ?' : ''} ORDER BY name`,
  onlyOrg ? [onlyOrg] : [],
);

for (const org of orgs) {
  await runWithOrganization(String(org.id), async () => {
    const properties = await sql.rows('SELECT id, name FROM properties WHERE organization_id = ? ORDER BY name', [org.id]);
    const unitTypes = await sql.rows(
      `SELECT ut.id, ut.property_id, ut.code, ut.name, ut.base_occupancy, ut.max_adults FROM unit_types ut
         JOIN properties p ON p.id = ut.property_id WHERE p.organization_id = ?`, [org.id]);

    // Матриця, тіри, сезони й правила — по обʼєкту, через фасад модуля цін.
    const perProperty = [];
    for (const property of properties) {
      const matrix = await occupancyMatrixOf(String(property.id));
      if (matrix.prices.length === 0 && matrix.tiers.length === 0) continue;
      perProperty.push({
        property,
        rows: matrix.prices,
        tiers: matrix.tiers,
        seasons: await listSeasons(String(property.id), { includePast: true }),
        rules: await listExtraOccupancyRulesOf(String(property.id)),
      });
    }
    const orgRows = perProperty.reduce((s, p) => s + p.rows.length, 0);
    if (orgRows === 0) return;
    totals.organizations++;
    totals.matrixRows += orgRows;
    say(`## ${org.name} (\`${org.id}\`) — ${orgRows} рядків матриці`);
    say('');

    for (const { property, rows, tiers, seasons, rules } of perProperty) {
      if (rows.length === 0) continue;
      totals.properties++;
      say(`### Обʼєкт ${property.name} (\`${property.id}\`)`);
      say('');

      // Вікна дат — майбутні сезони обʼєкта. Сезон один на обʼєкт, тож вікна,
      // які в різних типів нарізані по-різному, треба вирівняти.
      const windows = new Map();
      for (const r of rows) {
        const key = `${r.valid_from ?? ''}|${r.valid_to ?? ''}`;
        windows.set(key, (windows.get(key) ?? 0) + 1);
      }
      say('**Вікна дат матриці → сезони:**');
      say('');
      say('| Вікно | Рядків | Пропозиція |');
      say('|---|---|---|');
      const sorted = [...windows.keys()].sort();
      for (const key of sorted) {
        const [from, to] = key.split('|');
        let note;
        if (!from && !to) note = 'без дат — це не сезон, а ціна «завжди»: базова ціна типу на весь горизонт (масовий редактор) або сезон на рік уперед — вирішує готель';
        else if (!from || !to) note = '⚠ відкритий кінець — сезон потребує обох меж';
        else note = `сезон ${from} – ${to}`;
        if (note.startsWith('⚠')) totals.warnings++;
        say(`| ${from || '…'} → ${to || '…'} | ${windows.get(key)} | ${note} |`);
      }
      totals.seasons += sorted.filter((k) => { const [f, t] = k.split('|'); return f && t; }).length;
      const dated = sorted.map((k) => k.split('|')).filter(([f, t]) => f && t);
      for (let i = 0; i < dated.length; i++) for (let j = i + 1; j < dated.length; j++) {
        const [f1, t1] = dated[i]; const [f2, t2] = dated[j];
        if (f1 <= t2 && f2 <= t1) { say(`- ⚠ вікна ${f1}–${t1} і ${f2}–${t2} перетинаються — сезони обʼєкта не можуть; межі треба вирівняти`); totals.warnings++; }
      }
      if (seasons.length) {
        say(`- уже є сезонів: ${seasons.length} (${seasons.map((s) => `${s.name} ${s.dateFrom}–${s.dateTo}`).join('; ')}) — нові вікна не мають їх перетинати`);
      }
      say('');

      // Тип × вікно — базова ціна і надбавка за дорослого
      say('**Тип × вікно → базова ціна сезону і правило «дорослий понад базу»:**');
      say('');
      say('| Тип | Вікно | База (дорослих) | Ціна бази | Рядки матриці (дорослих → ціна) | Правило | Примітка |');
      say('|---|---|---|---|---|---|---|');
      const typeIds = [...new Set(rows.map((r) => (r.unit_type_id == null ? '' : String(r.unit_type_id))))];
      for (const typeId of typeIds) {
        const type = unitTypes.find((u) => String(u.id) === typeId);
        const typeLabel = typeId === '' ? 'усі типи' : (type ? `${type.code}` : `⚠ невідомий ${typeId}`);
        const base = type ? Math.max(1, Number(type.base_occupancy) || 2) : null;
        const maxAdults = type ? Math.max(1, Number(type.max_adults) || 1) : null;
        for (const key of sorted) {
          const [from, to] = key.split('|');
          const cell = rows.filter((r) => (r.unit_type_id == null ? '' : String(r.unit_type_id)) === typeId
            && (r.valid_from ?? '') === from && (r.valid_to ?? '') === to)
            .sort((a, b) => Number(a.persons) - Number(b.persons));
          if (cell.length === 0) continue;
          const byPersons = new Map(cell.map((r) => [Number(r.persons), Number(r.price_gross)]));
          const notes = [];
          let rule = '—';
          let basePrice = null;
          if (typeId === '') {
            notes.push('⚠ рядок на всі типи: базова заселеність у типів різна — розкласти по типах руками');
          } else if (base != null) {
            basePrice = byPersons.get(base) ?? null;
            if (basePrice == null) notes.push(`⚠ немає рядка на ${base} дорослих (базу типу) — клітинку сезону нічим заповнити`);
            const below = [...byPersons.keys()].filter((n) => n < base);
            if (below.length) notes.push(`⚠ рядки на ${below.join(', ')} дорослих (менше бази): знижки нижче бази в Ц30 немає — опустити base_occupancy до ${Math.min(...below)} і виразити решту надбавками, або лишити в матриці`);
            const above = [...byPersons.keys()].filter((n) => n > base).sort((a, b) => a - b);
            if (above.length && basePrice != null) {
              const diffs = [];
              let prev = base;
              let ok = true;
              for (const n of above) {
                if (n !== prev + 1 || !byPersons.has(prev)) { ok = false; notes.push(`⚠ пропуск між ${prev} і ${n} дорослими — правило на кожного потребує суцільного ряду`); break; }
                diffs.push(money(byPersons.get(n) - byPersons.get(prev)));
                prev = n;
              }
              if (ok) {
                const distinct = [...new Set(diffs)];
                if (distinct.length === 1) {
                  rule = `дорослий понад базу: +${fmt(distinct[0])} за ніч (сума)`;
                  totals.adultRules++;
                  if (distinct[0] < 0) notes.push('⚠ надбавка відʼємна — правило приймає лише невідʼємні; це знижка, не надбавка');
                  if (maxAdults != null && Math.max(...above) < maxAdults) notes.push(`після правила опції каталогу відкриються до ${maxAdults} дорослих — матриця знала лише до ${Math.max(...above)}`);
                } else {
                  notes.push(`⚠ різниці нелінійні (${diffs.map((d) => `+${fmt(d)}`).join(', ')}) — одне правило цього не виразить; готель називає одне число або лишає матрицю`);
                }
              }
            }
            const existingAdult = rules.find((r) => r.guestKind === 'adult' && (r.unitTypeId == null || String(r.unitTypeId) === typeId) && r.ratePlanId == null);
            if (existingAdult && rule !== '—') notes.push('уже є правило для дорослого на цьому типі/усіх — накат мав би його не дублювати (rule_conflict)');
          }
          totals.warnings += notes.filter((n) => n.startsWith('⚠')).length;
          say(`| ${typeLabel} | ${from || '…'} → ${to || '…'} | ${base ?? '—'} | ${fmt(basePrice)} | ${cell.map((r) => `${r.persons} → ${fmt(r.price_gross)}`).join(', ')} | ${rule} | ${notes.join('; ') || '—'} |`);
        }
      }
      say('');

      if (tiers.length) {
        say(`- ⚠ знижок за тривалість (\`price_los_tiers\`): ${tiers.length} — це правила ціни §2.5, не сезон і не надбавка; у цьому кроці не мігруються, котирування читає їх далі`);
        totals.warnings++;
      }
      say('');
    }
  });
}

say('## Разом');
say('');
say(`| Організацій з матрицею | Обʼєктів | Рядків матриці | Сезонів (вікон з обома межами) | Правил «дорослий понад базу» | ⚠ Попереджень |`);
say('|---|---|---|---|---|---|');
say(`| ${totals.organizations} | ${totals.properties} | ${totals.matrixRows} | ${totals.seasons} | ${totals.adultRules} | ${totals.warnings} |`);
say('');
if (totals.matrixRows === 0) say('Матриця порожня: мігрувати нічого; наступний крок — лише рішення, коли прибрати екран «Ціни за заселеністю».');
else if (totals.warnings === 0) say('Жодного попередження: матриця зводиться до сезонів і одного правила на тип без рішень готелю — накат можна писати.');
else say('Кожне ⚠ — питання до готелю, а не до коду (інваріант 17): накат пишеться після відповідей, не замість них.');

const text = out.join('\n') + '\n';
if (outPath) { fs.writeFileSync(outPath, text); console.log(`записано: ${outPath}`); }
else process.stdout.write(text);
