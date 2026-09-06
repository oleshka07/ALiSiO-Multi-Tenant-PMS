/**
 * Мережа гостя береться ОДНИМ рівнем — назва й пароль разом (О2).
 *
 *   node src/modules/guests/data/guest-page-levels.check.ts
 *
 * Рівнів три: обʼєкт → тип номера → номер. Кожен наступний перекриває
 * попередній, і саме тут ховається помилка, від якої гість не підключиться:
 * якщо назву й пароль брати ДВОМА незалежними `||`, готель, що вписав мережу
 * на типі й не вписав пароль, віддає гостю **назву типу з паролем обʼєкта**.
 * Це не теорія — так було написано на рівні типу, поки О2 діяло лише на
 * рівні номера (рецензія 07.09, п. 2.2).
 *
 * Фікстура не вироджена по осях (інваріант 26): три рівні, і на кожному
 * РІЗНІ назви й паролі; є рівень, у якого назва є, а пароля немає — інакше
 * «пара» і «два незалежні поля» дають однакову відповідь.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
// Резолвер живе в `@guests` (гостьова сторінка), таблиця — у `properties`.
// Перевірка стоїть у ВЛАСНИКА таблиці й ходить у резолвер через фасад: інакше
// або фікстура стає другим писачем `guest_page_config` (і три справжні пробої
// меж зникають зі звіту як прогрес, якого не було — INC-018), або перевірка
// лізе в нутрощі чужого модуля.
const { getGuestPageConfig } = await import('@guests');
const { upsertGuestPageConfig } = await import('./guest-page-config.repo.ts');

const sql = getSql();
const ORG = '__gpl_check__org';
const PROP = '__gpl_check__prop';
const CAT = '__gpl_check__cat';
const TYPE = '__gpl_check__type';
const UNIT = '__gpl_check__unit';

async function cleanup() {
  await runWithOrganization(ORG, async () => {
    await sql.run("DELETE FROM guest_page_config WHERE unit_type_id LIKE '__gpl_check__%'", []);
    await sql.run("DELETE FROM property_guest_config WHERE property_id LIKE '__gpl_check__%'", []);
    await sql.run("DELETE FROM units WHERE id LIKE '__gpl_check__%'", []);
    await sql.run("DELETE FROM unit_types WHERE id LIKE '__gpl_check__%'", []);
    await sql.run("DELETE FROM categories WHERE id LIKE '__gpl_check__%'", []);
    await sql.run("DELETE FROM properties WHERE id LIKE '__gpl_check__%'", []);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

const setType = (fields: Record<string, unknown>) => runWithOrganization(ORG, async () => {
  await sql.run('DELETE FROM guest_page_config WHERE unit_type_id = ?', [TYPE]);
  await upsertGuestPageConfig(TYPE, fields);
});
const setUnit = (fields: Record<string, unknown>) => runWithOrganization(ORG, async () => {
  const cols = Object.keys(fields);
  await sql.run(`UPDATE units SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => fields[c]), UNIT]);
});
const read = () => runWithOrganization(ORG, () => getGuestPageConfig(TYPE, PROP, UNIT));

await cleanup();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'GPL', ORG]);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'GPL', PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
      [TYPE, PROP, CAT, 'DZ', 'DZ']);
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`, [UNIT, PROP, TYPE, CAT, '101', '101']);
    await sql.run(
      `INSERT INTO property_guest_config (property_id, wifi_network, wifi_password)
       VALUES (?, ?, ?)`, [PROP, 'HOUSE-NET', 'house-pass']);
  });

  // ── Лише обʼєкт ───────────────────────────────────────────────────────
  {
    const cfg = await read() as any;
    assert.strictEqual(cfg.wifi_network, 'HOUSE-NET');
    assert.strictEqual(cfg.wifi_password, 'house-pass');
    console.log('  ok  без рівнів вище гість отримує мережу обʼєкта');
  }

  // ── Тип назвав мережу ЦІЛКОМ — вона й перемагає ───────────────────────
  {
    await setType({ wifi_network: 'TYPE-NET', wifi_password: 'type-pass' });
    const cfg = await read() as any;
    assert.strictEqual(cfg.wifi_network, 'TYPE-NET');
    assert.strictEqual(cfg.wifi_password, 'type-pass');
    console.log('  ok  повна мережа типу перекриває мережу обʼєкта');
  }

  // ── Тип назвав ЛИШЕ НАЗВУ — і це головна сцена ────────────────────────
  //
  // Два незалежні `||` дають тут «TYPE-NET» + «house-pass»: назва однієї
  // мережі з паролем іншої. Гість вводить пароль, який не підходить, і о
  // другій ночі дзвонить на рецепцію.
  {
    await setType({ wifi_network: 'TYPE-NET' });
    const cfg = await read() as any;
    assert.strictEqual(cfg.wifi_network, 'HOUSE-NET',
      'мережа зібрана з двох рівнів: назва типу з паролем обʼєкта — це підключення, якого не буде (О2)');
    assert.strictEqual(cfg.wifi_password, 'house-pass',
      'пароль узято не з того рівня, що назва');
    console.log('  ok  половина мережі на типі не перемагає — рівень береться цілим');
  }

  // ── Номер назвав свою мережу цілком ───────────────────────────────────
  {
    await setType({ wifi_network: 'TYPE-NET', wifi_password: 'type-pass' });
    await setUnit({ wifi_network: 'ROOM-NET', wifi_password: 'room-pass' });
    const cfg = await read() as any;
    assert.strictEqual(cfg.wifi_network, 'ROOM-NET', 'мережа номера мала перемогти обидва верхні рівні');
    assert.strictEqual(cfg.wifi_password, 'room-pass');
    console.log('  ok  повна мережа номера перекриває тип і обʼєкт');
  }

  // ── Номер назвав лише пароль ──────────────────────────────────────────
  {
    await setUnit({ wifi_network: null, wifi_password: 'room-pass-only' });
    const cfg = await read() as any;
    assert.strictEqual(cfg.wifi_network, 'TYPE-NET', 'половина мережі номера перекрила повну мережу типу');
    assert.strictEqual(cfg.wifi_password, 'type-pass', 'пароль номера доїхав без своєї назви');
    console.log('  ok  половина мережі номера теж не перемагає');
  }

  console.log('guest-page-levels: мережа гостя береться одним рівнем, назва й пароль разом');
} finally {
  await cleanup();
}
