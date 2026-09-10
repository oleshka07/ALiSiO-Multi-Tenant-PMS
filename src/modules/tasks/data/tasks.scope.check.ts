/**
 * Задачі і проєкти — свій будинок ПЛЮС спільні, а не всі підряд.
 *
 *   node src/modules/tasks/data/tasks.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `listTasks` і `listProjects` фільтрувались лише `organization_id`: готель
 * із двома будинками бачив у списку задачі обох. Фільтр `property_id` у
 * `ListTasksFilters` існував, але його ніхто не слав — вибір оператора з
 * шапки до запиту не доходив.
 *
 * ── Чому тут ІНШІ двері ─────────────────────────────────────────────────
 *
 * `tasks.property_id` і `task_projects.property_id` — NULLABLE, і NULL там не
 * «забули»: `createTask` кладе `input.property_id ?? null`, тобто задача без
 * будинку — звичайний випадок. «Оновити прайс на сайті» не належить жодному
 * будинку і тому належить кожному.
 *
 * Суворі двері (`propertyScopeFilter`, `property_id = ?`) тихо сховали б саме
 * ці рядки — той самий звір, що рядок без орендаря (інваріант 12): рядок є,
 * його не видно, у логах нічого. Тому тут `propertyOrSharedFilter` (О14), і
 * сцена нижче доводить РІЗНИЦЮ між дверима числом, а не на слово.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * 2 задачі в А, 3 в Б, 2 спільні. Отже 4 в області А, 5 в області Б, 7 в
 * «усіх» — три різні числа, і «спільні враховано» (4) відрізняється від
 * «спільні загублено» (2) та від «вісь забуто» (7). Інваріант 26, друга
 * половина.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-tasks-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { listTasks } = await import('./tasks.repo.ts');
const { listProjects } = await import('./projects.repo.ts');
const { getTasksSummary } = await import('./summary.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

/** Засів — під орендарем того рахунку, якому рядок належить (див. lists.scope). */
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(fx.organizationId, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);
const forProperty = <T>(propertyId: string, fn: () => Promise<T>) =>
  (propertyId === neighbour.propertyId ? inTheirs(fn) : inOurs(fn));
const forOrg = <T>(organizationId: string, fn: () => Promise<T>) =>
  runWithOrganization(organizationId, fn);


const task = async (id: string, organizationId: string, propertyId: string | null, extra = '') =>
  forOrg(organizationId, () => sql.run(
    `INSERT INTO tasks (id, organization_id, property_id, title, status${extra ? ', due_date' : ''})
     VALUES (?, ?, ?, ?, 'todo'${extra ? ', ?' : ''})`,
    extra ? [id, organizationId, propertyId, id, extra] : [id, organizationId, propertyId, id],
  ));
const project = async (id: string, organizationId: string, propertyId: string | null) =>
  forOrg(organizationId, () => sql.run(
    'INSERT INTO task_projects (id, organization_id, property_id, name) VALUES (?, ?, ?, ?)',
    [id, organizationId, propertyId, id],
  ));

// А — 2 задачі, Б — 3, і ДВІ спільні на весь рахунок (одна з них прострочена).
await task('t_a1', fx.organizationId, fx.a.id);
await task('t_a2', fx.organizationId, fx.a.id);
await task('t_b1', fx.organizationId, fx.b.id);
await task('t_b2', fx.organizationId, fx.b.id);
await task('t_b3', fx.organizationId, fx.b.id);
await task('t_shared', fx.organizationId, null);
// Прострочена спільна — щоб дайджест теж мав що загубити.
await task('t_shared_overdue', fx.organizationId, null, '2020-01-01');

// Проєкти: 1 в А, 2 в Б, 1 спільний.
await project('p_a1', fx.organizationId, fx.a.id);
await project('p_b1', fx.organizationId, fx.b.id);
await project('p_b2', fx.organizationId, fx.b.id);
await project('p_shared', fx.organizationId, null);

// Сусід — своя задача і свій проєкт: без осі орендаря твердження порожнє.
await task('t_n1', neighbour.organizationId, neighbour.propertyId);
await project('p_n1', neighbour.organizationId, neighbour.propertyId);

await runWithOrganization(fx.organizationId, async () => {
  // ─── Задачі ──────────────────────────────────────────────────────────────
  const inA = await listTasks(oneProperty(fx.a.id));
  assert.strictEqual(inA.length, 4, `очікували 4 задачі в області обʼєкта А (2 свої + 2 спільні), отримали ${inA.length}`);
  assert.ok(inA.some((t) => t.id === 't_shared'), 'спільна задача рахунку зникла зі списку обʼєкта А');
  assert.ok(!inA.some((t) => String(t.id).startsWith('t_b')), 'у списку А є задачі обʼєкта Б');

  const inB = await listTasks(oneProperty(fx.b.id));
  assert.strictEqual(inB.length, 5, `очікували 5 задач в області обʼєкта Б (3 свої + 2 спільні), отримали ${inB.length}`);

  assert.strictEqual((await listTasks(ALL_PROPERTIES)).length, 7,
    '«усі обʼєкти» мали дати всі сім і жодної чужого орендаря');

  // Фільтр екрана звужує ВСЕРЕДИНІ області: «лише цей будинок» — без спільних.
  assert.strictEqual((await listTasks(oneProperty(fx.a.id), { property_id: fx.a.id })).length, 2,
    'фільтр «лише цей будинок» мав прибрати спільні');
  assert.strictEqual((await listTasks(oneProperty(fx.a.id), { property_id: fx.b.id })).length, 0,
    'фільтр обʼєкта Б в області обʼєкта А віддав рядки');

  // ─── Проєкти ─────────────────────────────────────────────────────────────
  assert.strictEqual((await listProjects(oneProperty(fx.a.id))).length, 2,
    'проєкти обʼєкта А: свій + спільний');
  assert.strictEqual((await listProjects(oneProperty(fx.b.id))).length, 3,
    'проєкти обʼєкта Б: два свої + спільний');
  assert.strictEqual((await listProjects(ALL_PROPERTIES)).length, 4,
    '«усі обʼєкти» мали дати чотири проєкти');

  // ─── Дайджест ────────────────────────────────────────────────────────────
  //
  // Числа інші, ніж у списку, і це навмисно: дайджест рахує лише відкриті, а
  // прострочена тут одна — спільна. Тобто «спільне загублено» видно окремим
  // числом, а не тим самим.
  const digestA = await getTasksSummary(oneProperty(fx.a.id));
  assert.strictEqual(digestA.total, 4, `дайджест обʼєкта А мав порахувати 4 (2 свої + 2 спільні), вийшло ${digestA.total}`);
  assert.strictEqual(digestA.overdue, 1, 'прострочена спільна задача зникла з дайджесту обʼєкта А');

  const digestAll = await getTasksSummary(ALL_PROPERTIES);
  assert.strictEqual(digestAll.total, 7, `дайджест рахунку мав порахувати 7, вийшло ${digestAll.total}`);

  // Обʼєкт сусіда, названий нашою організацією, не віддає нічого свого.
  assert.strictEqual((await listTasks(oneProperty(neighbour.propertyId))).length, 2,
    'в області чужого обʼєкта мали лишитись лише спільні задачі нашого рахунку');
  assert.ok(!(await listTasks(oneProperty(neighbour.propertyId))).some((t) => t.id === 't_n1'),
    'задача сусіда знайшлася в нашій організації');
});

// Вісь орендаря з другого боку.
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual((await listTasks(ALL_PROPERTIES)).length, 1, 'сусід побачив не свою задачу');
  assert.strictEqual((await listProjects(ALL_PROPERTIES)).length, 1, 'сусід побачив не свій проєкт');
});

console.log('  ok  задачі 4/5/7 зі спільними, суворий фільтр екрана 2; проєкти 2/3/4; дайджест 4/7');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('tasks.scope: усі перевірки пройдено');
