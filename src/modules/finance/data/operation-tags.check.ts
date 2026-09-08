/**
 * Мітка на операції належить ЦЬОМУ готелю — на обох входах і в кожному читанні.
 *
 *   node src/modules/finance/data/operation-tags.check.ts
 *
 * `operation-scope.check.ts` стереже пʼять полів, які вказують у довідник
 * фінансів. `tag_ids` — ШОСТЕ поле того самого тіла запиту, і воно жило повз
 * ту варту (Р13.2): `createOperationInTx` і `updateOperation` клали клієнтські
 * id прямо в `fin_operation_tags`, а три читачі (`getTagsFor`, `getBatchTags`,
 * `getTagIds`) джойнили `finance_tags` БЕЗ орендаря.
 *
 * Чому це червоне саме на SQLite. `fin_operation_tags` — чиста звʼязка, без
 * `organization_id`; орендар у ній читається лише через `finance_tags`. На
 * Postgres запис ловить `WITH CHECK` політики на `finance_tags`, а читання
 * ховає та сама політика — тобто там зелено. Уся розробка (`npm run dev`) і
 * майже весь гейт-парк ходять по SQLite, де політик немає взагалі: там чуже
 * імʼя мітки повертається в API. Це рід INC-014 — «зелено там, де політика є,
 * червоно там, де її немає», і саме тому цей гейт живе в `npm run check`
 * (SQLite), а не тільки в `check:pg`.
 *
 * Осі (інваріант 26). У кожного готелю ДВІ мітки:
 *   - `spa` — імʼя однакове в обох, ідентифікатори різні. Без неї «чужа мітка»
 *     відрізнялась би від своєї ще й назвою, і твердження про належність
 *     проходило б на порівнянні рядків, а не ідентифікаторів;
 *   - `тільки-А` / `тільки-Б` — імена різні. Без неї витік читача був би
 *     невидимий: два `spa` в одному списку не відрізниш.
 * Обидві потрібні: перша тримає вісь ідентифікатора, друга — вісь імені.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { provisionOrganization } = await import('@core/provisioning');
const { isRefusal } = await import('@core/http/refusal');
const {
  createOperationInTx, updateOperation, listOperations, duplicateOperation,
} = await import('../api/operations.handlers');

const sql = getSql();
const SLUGS = ['optags-check-one', 'optags-check-two'];
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

async function cleanup() {
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) continue;
    // Звʼязка першою: вона висить і на операції, і на мітці.
    await runWithOrganization(org.id, async () => {
      await sql.run(`DELETE FROM fin_operation_tags WHERE operation_id IN
        (SELECT id FROM fin_operations WHERE organization_id = ?)`, [org.id]);
      await sql.run(`DELETE FROM fin_operation_tags WHERE tag_id IN
        (SELECT id FROM finance_tags WHERE organization_id = ?)`, [org.id]);
      await sql.run('DELETE FROM fin_operations WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM finance_tags WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM expense_categories WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM business_units WHERE organization_id = ?', [org.id]);
      // `app_users` перед `finance_accounts`: власник тримає касу через
      // `default_cash_account_id`, і цей ключ не каскадний (Д26).
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM finance_accounts WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

/** Стаття, каса і дві мітки одного готелю. */
async function catalogue(organizationId: string, tag: string) {
  return runWithOrganization(organizationId, async () => {
    const cat = await sql.row<{ id: string }>(
      "SELECT id FROM expense_categories WHERE organization_id = ? AND code = 'other_exp'", [organizationId]);
    const acc = await sql.row<{ id: string }>(
      "SELECT id FROM finance_accounts WHERE organization_id = ? AND type = 'cash'", [organizationId]);
    const shared = `tg_spa_${tag}`;
    const own = `tg_own_${tag}`;
    await sql.run('INSERT INTO finance_tags (id, organization_id, name) VALUES (?, ?, ?)',
      [shared, organizationId, 'spa']);
    await sql.run('INSERT INTO finance_tags (id, organization_id, name) VALUES (?, ?, ?)',
      [own, organizationId, `тільки-${tag}`]);
    return {
      category: String(cat?.id), account: String(acc?.id),
      sharedTag: shared, ownTag: own, ownTagName: `тільки-${tag}`,
    };
  });
}

/** Назви міток операції так, як їх бачить список у API. */
async function tagsInList(organizationId: string, operationId: string): Promise<string[]> {
  return runWithOrganization(organizationId, async () => {
    const res = await listOperations({
      nextUrl: new URL('http://local/api/finance/operations?pageSize=100'),
    } as never);
    const body = await res.json() as { items?: { id: string; tags: string[] }[] };
    const row = (body.items || []).find((r) => r.id === operationId);
    return row?.tags || [];
  });
}

await cleanup();
try {
  const provisioned = [];
  for (const [i, slug] of SLUGS.entries()) {
    provisioned.push(await provisionOrganization({
      name: `Op tags ${slug}`, slug,
      ownerEmail: `${slug}@example.test`, ownerPassword: 'check-password-1234',
      currency: i === 0 ? 'EUR' : 'CZK', language: 'uk',
    }));
  }
  const [one, two] = provisioned;
  const mine = await catalogue(one.organizationId, 'А');
  const alien = await catalogue(two.organizationId, 'Б');

  say(mine.sharedTag !== alien.sharedTag && mine.ownTagName !== alien.ownTagName,
    'у двох готелів мітка «spa» з однаковим імʼям і різними id, і по одній власній назві');

  const base = {
    op_type: 'expense' as const, amount: 100, currency: 'EUR', paid_at: '2026-09-09',
    account_from_id: mine.account, category_id: mine.category,
  };
  const write = (input: Record<string, unknown>) => runWithOrganization(one.organizationId,
    () => createOperationInTx(one.organizationId, input as never, null));

  // ── 1. Вхід «створення»: чужа мітка в тілі запиту ───────────────────────
  let created: string | null = null;
  try {
    created = await write({ ...base, tag_ids: [mine.sharedTag] });
  } catch (e) {
    say(false, `власна мітка відмовлена (${(e as Error).message}) — далі «чужа відмовлена» нічого не значить`);
  }
  say(Boolean(created), 'операція з ВЛАСНОЮ міткою проходить');

  let refusedCreate = false;
  let how = 'ПРОЙШЛО';
  let leaked: string | null = null;
  try {
    leaked = await write({ ...base, tag_ids: [alien.ownTag] });
  } catch (e) {
    how = isRefusal(e) ? 'названа відмова' : `виняток не наш: ${(e as Error).message.slice(0, 60)}`;
    refusedCreate = isRefusal(e);
  }
  say(refusedCreate, `створення з міткою чужого готелю відхилено названою відмовою (${how})`);

  const linked = leaked ? await runWithOrganization(one.organizationId, () => sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_operation_tags WHERE operation_id = ?', [leaked])) : { n: 0 };
  say(Number(linked?.n) === 0, `звʼязки з чужою міткою в базі не лишилось (${linked?.n})`);

  // ── 2. Вхід «редагування»: те саме тіло, ті самі id ─────────────────────
  //
  // Мітки їдуть РАЗОМ із коментарем навмисно. Сам по собі `tag_ids` до запису
  // не доходив узагалі: він не входить у білий список `allowed`, тож
  // `fields.length === 1` віддавав 400 «Nothing to update» ДО блоку міток
  // (`:713` проти `:717`). Тобто сцена «сам лише tag_ids» перевіряла б двері,
  // які не відчиняються, і варта на них нічого б не значила. Обидва стани
  // тверджуються нижче окремо.
  const editOnly = (body: Record<string, unknown>) => runWithOrganization(one.organizationId, async () => {
    const res = await updateOperation({
      json: async () => body,
      nextUrl: new URL('http://local/api/finance/operations'),
    } as never, { params: Promise.resolve({ id: String(created) }) });
    return { status: res.status, body: await res.json() as { tags?: string[] } };
  });

  if (created) {
    let editStatus = 0;
    try {
      editStatus = (await editOnly({ comment: 'правка з чужою міткою', tag_ids: [alien.ownTag] })).status;
    } catch (e) { editStatus = isRefusal(e) ? 404 : -1; }
    say(editStatus === 404, `редагування на чужу мітку відхилено, і саме 404 (${editStatus})`);

    const afterEdit = await tagsInList(one.organizationId, created);
    say(!afterEdit.includes(alien.ownTagName),
      `після відмови мітки операції лишились своїми (${JSON.stringify(afterEdit)})`);

    // А самі лише мітки — доходять до запису, а не гаснуть у «Nothing to update».
    let onlyTags = { status: 0, body: {} as { tags?: string[] } };
    try { onlyTags = await editOnly({ tag_ids: [mine.sharedTag, mine.ownTag] }); } catch { /* нижче */ }
    say(onlyTags.status === 200 && (onlyTags.body.tags || []).includes(mine.ownTagName),
      `зміна САМИХ міток застосовується (статус ${onlyTags.status}, ${JSON.stringify(onlyTags.body.tags || [])})`);
  }

  // ── 3. Читачі: звʼязка з чужою міткою, засіяна ПОВЗ API ─────────────────
  //
  // Саме так виглядає рядок, який уже лежить у базі: варта на вході його не
  // прибирає, і питання лише в тому, чи видасть його читач. Пишемо під
  // контекстом ГОТЕЛЮ Б — інакше політика Postgres не пустила б вставку, і
  // сцена перевіряла б неіснуючий стан.
  if (created) {
    await runWithOrganization(two.organizationId, () => sql.run(
      'INSERT INTO fin_operation_tags (operation_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [created, alien.ownTag]));

    const names = await tagsInList(one.organizationId, created);
    say(!names.includes(alien.ownTagName),
      `getBatchTags (список) не віддає імені чужої мітки (${JSON.stringify(names)})`);

    let single: string[] = [];
    await runWithOrganization(one.organizationId, async () => {
      const res = await updateOperation({
        json: async () => ({ comment: 'дотик, щоб прочитати відповідь' }),
        nextUrl: new URL('http://local/api/finance/operations'),
      } as never, { params: Promise.resolve({ id: String(created) }) });
      single = ((await res.json()) as { tags?: string[] }).tags || [];
    });
    say(!single.includes(alien.ownTagName),
      `getTagsFor (одна операція) не віддає імені чужої мітки (${JSON.stringify(single)})`);

    // `getTagIds` годує копіювання: чужа звʼязка, скопійована в нову операцію,
    // це вже не читання, а ЗАПИС чужого id — і він мусить або не статись, або
    // не пройти варту входу.
    let copyTags: string[] = [];
    let copyStatus = 0;
    await runWithOrganization(one.organizationId, async () => {
      const res = await duplicateOperation({} as never,
        { params: Promise.resolve({ id: String(created) }) });
      copyStatus = res.status;
      copyTags = ((await res.json()) as { tags?: string[] }).tags || [];
    });
    say(copyStatus === 201 && !copyTags.includes(alien.ownTagName),
      `getTagIds (копіювання) не переносить чужої мітки (статус ${copyStatus}, ${JSON.stringify(copyTags)})`);
  }
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\noperation-tags: ${fails.length} червоних`);
  process.exit(1);
}
console.log('operation-tags: мітка на операції — лише СВОГО готелю, на обох входах і в трьох читачах');
assert.ok(true);
