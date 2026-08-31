/**
 * Дзеркало мапінгу: що з нашого чим стало на тому боці.
 *
 *   node src/modules/channels/data/mappings.repo.check.ts
 *
 * Мапінг робить оператор в iFrame менеджера каналів (рішення §7 ТЗ — своїх
 * екранів мапінгу ми не пишемо: у кожного OTA своя модель, це чотири екрани
 * замість одного). Наше — ДЗЕРКАЛО: під якими там ідентифікаторами лежать
 * наші тип номера, тариф і сам обʼєкт.
 *
 * ── Навіщо дзеркало взагалі ─────────────────────────────────────────────
 *
 * Без нього бронювання приїжджає з чужим `room_type_id`, який нам ні про що
 * не каже: бронь лягає `unmapped`, тобто без типу номера, і наявність її не
 * бачить. Це не помилка — так і задумано, поки мапінгу немає, — але це
 * ручна робота на кожну броню.
 *
 * ── Вісь, якої в гіпотезі не було ───────────────────────────────────────
 *
 * Рядок буває не лише на сутність, а й на ОПЦІЮ ЗАСЕЛЕНОСТІ тарифу. Живий
 * `GET /restrictions` індексований не ідентифікатором тарифу, а
 * ідентифікатором опції (INVENTORY §4.5: три тарифи віддали вісім ключів).
 * Основна опція має той самий id, що й тариф; решта — власні UUID, які не
 * повертаються НІДЕ, крім `options[]` самого тарифу. Без цих рядків прочитати
 * власні ціни назад неможливо: пʼять ключів із восьми не буде з чим
 * зіставити.
 *
 * `occupancy` при цьому `NOT NULL DEFAULT 0`, а не nullable, і це не смак:
 * `UNIQUE` не обмежує `NULL` ні в SQLite, ні в Postgres. На цьому вже
 * обпікся `price_occupancy` у цій же кодовій базі — дублікат, який індекс
 * мав спинити, був якраз рядком із порожніми колонками.
 *
 * Перевірка написана ДО таблиці й **була червоною** (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { putMapping, mappingMirror, remoteIdOf } = await import('./mappings.repo.ts');

const sql = getSql();
const A = '__map_check__a';
const B = '__map_check__b';

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

/** Готель із зʼєднанням. Двох треба: один не доводить нічого. */
async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [`${org}_prop`, org, org, `${org}_prop`]);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [`${org}_conn`, org, `${org}_prop`, 'probe', `tok_${org}`, `sec_${org}`],
    );
  });
}

await cleanup();
await seed(A);
await seed(B);

try {
  // ── Дзеркало читається як мапа «наш тип → чужий» ──────────────────────
  await runWithOrganization(A, async () => {
    await putMapping(`${A}_conn`, { entityType: 'unit_type', localId: 'ut_deluxe', remoteId: 'rt-1' });
    await putMapping(`${A}_conn`, { entityType: 'unit_type', localId: 'ut_single', remoteId: 'rt-2' });
    await putMapping(`${A}_conn`, { entityType: 'rate_plan', localId: 'rp_bar', remoteId: 'rp-1' });

    const unitTypes = await mappingMirror(`${A}_conn`, 'unit_type');
    assert.strictEqual(unitTypes.size, 2, 'дзеркало віддало не ті рядки');
    assert.strictEqual(unitTypes.get('rt-1'), 'ut_deluxe',
      'дзеркало має читатись ЧУЖИЙ → НАШ: саме так приходить бронь');
    assert.ok(!unitTypes.has('rp-1'), 'у дзеркало типів затесався тариф');
    console.log('  ok  дзеркало віддає чужий id → наш, по одному роду сутностей');
  });

  // ── Повторна синхронізація не двоїть ──────────────────────────────────
  //
  // Мапінг перечитується щоразу після синку каталогу. `INSERT` на кожен
  // прохід дав би два рядки на один тип номера, і який із них виграє —
  // питання порядку читання.
  await runWithOrganization(A, async () => {
    await putMapping(`${A}_conn`, { entityType: 'unit_type', localId: 'ut_deluxe', remoteId: 'rt-1-НОВИЙ' });
    const m = await mappingMirror(`${A}_conn`, 'unit_type');
    assert.strictEqual(m.size, 2, 'повторний мапінг того самого типу створив другий рядок');
    assert.strictEqual(m.get('rt-1-НОВИЙ'), 'ut_deluxe', 'новий чужий id не доїхав');
    assert.ok(!m.has('rt-1'), 'старий чужий id лишився — бронь із нього створить другий тип');
    console.log('  ok  повторна синхронізація оновлює рядок, а не додає другий');
  });

  // ── Заселеність — окремий рядок, і нуль не дірка в UNIQUE ─────────────
  await runWithOrganization(A, async () => {
    await putMapping(`${A}_conn`, { entityType: 'rate_plan_option', localId: 'rp_bar', occupancy: 1, remoteId: 'opt-1' });
    await putMapping(`${A}_conn`, { entityType: 'rate_plan_option', localId: 'rp_bar', occupancy: 2, remoteId: 'opt-2' });

    assert.strictEqual(await remoteIdOf(`${A}_conn`, 'rate_plan_option', 'rp_bar', 1), 'opt-1');
    assert.strictEqual(await remoteIdOf(`${A}_conn`, 'rate_plan_option', 'rp_bar', 2), 'opt-2',
      'дві заселеності одного тарифу злились в один рядок — пʼять ключів із восьми не прочитати');

    // Сам тариф — це occupancy = 0, тобто «не опція». Значення поза доменом
    // заселеності саме тому, що NULL не обмежується UNIQUE.
    assert.strictEqual(await remoteIdOf(`${A}_conn`, 'rate_plan', 'rp_bar', 0), 'rp-1',
      'сама сутність загубилась серед опцій');
    console.log('  ok  опції заселеності лежать окремими рядками, сутність — нулем');
  });

  // ── Чужий орендар не бачить і не псує ─────────────────────────────────
  //
  // `cm_mappings` несе organization_id власною колонкою, але запит за
  // connection_id прийшов би з URL — тобто без обмеження це читання чужого.
  await runWithOrganization(B, async () => {
    const stolen = await mappingMirror(`${A}_conn`, 'unit_type');
    assert.strictEqual(stolen.size, 0,
      'чужий готель прочитав дзеркало мапінгу сусіда — це його номерний фонд');
    assert.strictEqual(await remoteIdOf(`${A}_conn`, 'unit_type', 'ut_deluxe', 0), null,
      'чужий готель дістав ідентифікатор сусіда точковим запитом');

    await assert.rejects(
      () => putMapping(`${A}_conn`, { entityType: 'unit_type', localId: 'їхній', remoteId: 'rt-99' }),
      'чужий готель дописав рядок у дзеркало сусіда');
  });

  await runWithOrganization(A, async () => {
    const mine = await mappingMirror(`${A}_conn`, 'unit_type');
    assert.strictEqual(mine.size, 2, 'сусід таки щось дописав або стер');
    console.log('  ok  чуже дзеркало не читається, не дописується і не псується');
  });

  // ── Порожнє дзеркало — нормальний стан, не помилка ────────────────────
  await runWithOrganization(B, async () => {
    const fresh = await mappingMirror(`${B}_conn`, 'unit_type');
    assert.strictEqual(fresh.size, 0);
    console.log('  ok  щойно підключений обʼєкт має порожнє дзеркало, а не виняток');
  });
} finally {
  await cleanup();
}

console.log('mappings: дзеркало мапінгу належить орендарю і не двоїться');
