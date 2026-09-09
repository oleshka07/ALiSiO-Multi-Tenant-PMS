/**
 * Застосунок знає, ким він є, і чесно каже, чи він підключений.
 *
 *   node src/core/apps.check.ts
 *   DB_DRIVER=postgres DATABASE_URL=… node src/core/apps.check.ts   # сцени 6–9 на політиках
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * Реєстр фіч знав дефолт кожного ключа, але не знав, КИМ ключ є: ядром, модулем
 * PMS чи застосунком (те, що говорить із чужою системою). Екран «Модулі та
 * інтеграції» показував усі 13 перемикачів одним списком, а поля ключів не
 * показував жодного — `fields[fiscal_de]` шукався в мапі, ключованій `fiskaly`.
 * Стан звʼязку трьох інтеграцій жив у трьох різних місцях (виняток fiskaly,
 * `console.log` пошти, `cm_connections` менеджера каналів), і «чи підключений
 * цей готель до fiskaly зараз» не міг відповісти ніхто.
 *
 * Твердження нижче — за §5 задачі `docs/tasks/2026-09-09-block-apps.md`,
 * нумерація та сама. Кожне стереже властивість, а не візерунок (AGENTS §3.2.1).
 *
 * ── Порядок навмисний ───────────────────────────────────────────────────
 *
 * Твердження 1 і 2 читають ЛИШЕ `features.ts` і `navigation.ts` — файли, які
 * існували до цього блоку. Реєстр застосунків (`./apps.ts`) імпортується
 * динамічно ПІСЛЯ них: інакше на дереві без `apps.ts` гейт падав би на
 * «Cannot find module», тобто на імітації, а не на справжньому дефекті —
 * відсутньому `kind` (інваріант 24, крок 2).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import '../../scripts/lib/module-aliases.mjs';
import { FEATURE_SPEC } from './features.ts';

type Key = keyof typeof FEATURE_SPEC;
type Kind = 'core' | 'module' | 'app';

// ── 1. Кожен ключ реєстру має `kind`, і значення названі поіменно ───────
//
// Список тут, а не виведений із реєстру: інакше перевірка звірялася б сама з
// собою. Ключ без рядка тут — червона збірка, як і ключ без дефолту в
// features.check.ts.
const EXPECTED_KIND: Record<Key, Kind> = {
  booking_engine: 'core',
  invoicing: 'core',
  dashboard: 'core',
  tasks: 'module',
  events: 'module',
  reports: 'module',
  day_sheets: 'module',
  accounting: 'module',
  // З4: менеджер каналів — частина ядра/модуля `channels`, НЕ застосунок.
  channels: 'module',
  guest_page: 'module',
  sites: 'module',
  fiscal_de: 'app',
  online_payments: 'app',
};

for (const key of Object.keys(FEATURE_SPEC) as Key[]) {
  assert.ok(key in EXPECTED_KIND,
    `новий ключ «${key}» без рішення, ким він є — впишіть kind у apps.check.ts (core | module | app)`);
  const spec = FEATURE_SPEC[key] as { kind?: string };
  assert.ok('kind' in spec && spec.kind !== undefined,
    `ключ «${key}» реєстру не має kind — екран не знає, чи це модуль (перемикач у «Модулях») чи застосунок (картка в «Застосунках»)`);
  assert.strictEqual(spec.kind, EXPECTED_KIND[key],
    `kind «${key}» = ${spec.kind}, а вирішено ${EXPECTED_KIND[key]}. Якщо навмисно — тут теж; якщо ні, ключ опиниться не на тому екрані`);
}
for (const key of Object.keys(EXPECTED_KIND)) {
  assert.ok(key in FEATURE_SPEC, `«${key}» є в очікуваннях kind, але зник із реєстру`);
}
console.log(`  ok  1. kind названий у ${Object.keys(FEATURE_SPEC).length} ключів реєстру`);

// ── 2. module ⇒ розділ меню є; app ⇒ розділу меню НЕМАЄ ────────────────
//
// Властивість, не візерунок: модуль — це екрани, які ховаються з меню й
// закриваються заслінкою; застосунок — це картка на екрані «Застосунки», і
// власного розділу в каталозі він не має. Ключ, який стоїть по обидва боки,
// або без розділу «модуль», або застосунок із розділом — обидва стани
// означають, що екран покаже його не там.
const catalog = fs.readFileSync('src/core/navigation.ts', 'utf8');
const inCatalog = (key: string) => catalog.includes(`feature: '${key}'`);
/**
 * Модулі, чий екран у каталозі СЬОГОДНІ без ключа. Знайдено цим гейтом
 * 09.09.2026: «Канали» (`/app/settings/channel-manager`) не мають
 * `feature: 'channels'`, тобто вимкнений модуль каналів лишає свій екран
 * відкритим. Варта модуля стоїть у кроні (`features.check.ts INTEGRATIONS`),
 * а не на екрані. Полагодити тут не можна: `navigation.ts` у цьому блоці — один
 * рядок про «Застосунки», а `modules/channels` — чужа тека; записано в звіт як
 * потрібна зміна в чужій теці. Виняток мусить лишатись ПОТРІБНИМ: щойно ключ
 * зʼявиться в каталозі, гейт вимагає прибрати рядок звідси.
 */
const MODULE_WITHOUT_SECTION: Partial<Record<Key, string>> = {
  channels: 'екран «Канали» без feature: — тека сесії 3, див. звіт блоку «Застосунки»',
};
for (const key of Object.keys(FEATURE_SPEC) as Key[]) {
  const kind = (FEATURE_SPEC[key] as { kind?: Kind }).kind;
  if (kind === 'module') {
    if (key in MODULE_WITHOUT_SECTION) {
      assert.ok(!inCatalog(key), `«${key}» уже має розділ у каталозі — приберіть його з MODULE_WITHOUT_SECTION у apps.check.ts`);
      continue;
    }
    assert.ok(inCatalog(key), `модуль «${key}» не має жодного екрана в core/navigation.ts — вимкнути його неможливо, а в «Модулях» він є`);
  } else if (kind === 'app') {
    assert.ok(!inCatalog(key), `застосунок «${key}» має розділ у core/navigation.ts — це модуль, а не застосунок, або каталог бреше`);
  }
}
console.log('  ok  2. модулі мають розділ меню, застосунки — ні');

// ── Далі — реєстр застосунків і стан звʼязку ────────────────────────────
const apps = await import('./apps.ts');
const { APPS, appCatalog, appById, isGatewayApp } = apps;
const { PAYMENT_PROVIDERS } = await import('./payments.ts');
const creds = await import('./integration-credentials.ts');
const { INTEGRATION_FIELDS, INTEGRATION_FEATURE } = creds;

// ── 3. Три експорти integration-credentials збігаються з apps.ts ────────
//
// В обидва боки. Один названий виняток: `channel_manager` — ключ модуля
// `channels` (З4), не застосунку; він лишається в integration-credentials
// поіменно, і гейт вимагає, щоб він був рівно один.
const NOT_AN_APP = ['channel_manager'];
const withFields = APPS.filter((a) => a.fields.length > 0).map((a) => a.id);
assert.deepStrictEqual(
  Object.keys(INTEGRATION_FIELDS).sort(),
  [...withFields, ...NOT_AN_APP].sort(),
  'INTEGRATION_FIELDS і apps.ts розійшлись — є запис, якого немає з іншого боку',
);
assert.deepStrictEqual(
  Object.keys(INTEGRATION_FEATURE).sort(),
  [...withFields, ...NOT_AN_APP].sort(),
  'INTEGRATION_FEATURE і apps.ts розійшлись',
);
for (const app of APPS) {
  if (!app.fields.length) continue;
  assert.deepStrictEqual(INTEGRATION_FIELDS[app.id], app.fields, `поля «${app.id}» в INTEGRATION_FIELDS — не ті, що в apps.ts`);
  assert.strictEqual(INTEGRATION_FEATURE[app.id], app.feature, `вимикач «${app.id}» в INTEGRATION_FEATURE — не той, що в apps.ts`);
}
const union = fs.readFileSync('src/core/integration-credentials.ts', 'utf8')
  .match(/export type IntegrationChannel = ([^;]+);/);
assert.ok(union, 'IntegrationChannel більше не оголошений там, де дивиться гейт');
const unionNames = [...union[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
// Юніон виводиться з реєстру (`AppId`), тож у тексті імен застосунків немає —
// але гейт перевіряє це через ТИП: кожен id застосунку з полями і виняток
// мусять бути допустимим значенням. `IntegrationChannel` — тип, у рантаймі
// його немає; тому рівність доводиться так: рядок тексту юніону називає
// `AppId` (виведення з реєстру) і рівно виняток поіменно.
assert.ok(/\bAppId\b/.test(union[1]), 'IntegrationChannel не виведений з AppId реєстру застосунків');
assert.deepStrictEqual(unionNames, [...NOT_AN_APP].sort(),
  `IntegrationChannel називає поіменно ${JSON.stringify(unionNames)} — має лише ${JSON.stringify(NOT_AN_APP)}, решта з реєстру`);
console.log(`  ok  3. три експорти integration-credentials виведені з ${withFields.length} застосунків + ${NOT_AN_APP.join(', ')}`);

// ── 4. «Скоро» без вимикача й полів; live — з вимикачем і файлом варти ──
const entries = appCatalog(PAYMENT_PROVIDERS);
assert.ok(entries.length >= 9, `у каталозі ${entries.length} записів — перша поставка має девʼять`);
const featuresCheck = fs.readFileSync('src/core/features.check.ts', 'utf8');
for (const e of entries) {
  if (!e.live) {
    assert.strictEqual(e.status, 'soon', `«${e.id}» не live, а статус ${e.status} — не-live це «скоро», без винятків`);
    if (!e.provider) {
      assert.strictEqual(e.feature, null, `«скоро»-застосунок «${e.id}» має вимикач ${e.feature} — прапорець без варти (П5)`);
      assert.strictEqual(e.fields.length, 0, `«скоро»-застосунок «${e.id}» має поля ключів — ключ, який ніщо не читає`);
    }
    continue;
  }
  if (e.id === 'smtp') {
    assert.strictEqual(e.feature, null, 'smtp — названий виняток без вимикача (ARCHITECTURE §2.3)');
    continue;
  }
  assert.ok(e.feature, `live-застосунок «${e.id}» без вимикача — вмикати нема чим`);
  const guarded = new RegExp(`${e.feature}:\\s*'[^']+'`).test(featuresCheck)
    || INTEGRATION_FEATURE[e.id] === e.feature;
  assert.ok(guarded, `live-застосунок «${e.id}»: вимикач «${e.feature}» не названий ні в OWNERS/INTEGRATIONS features.check.ts, ні в INTEGRATION_FEATURE`);
}
// Шлюзи: сьогодні не live — це стверджує payments.check; тут лише, що «скоро»
// не дає їм полів на екрані. Поля вони МАЮТЬ (для екрана оплат), але вимикач
// у них один і спільний.
for (const p of PAYMENT_PROVIDERS) {
  const e = entries.find((x) => x.id === p.id)!;
  assert.strictEqual(e.feature, 'online_payments', `${p.id} не за вимикачем online_payments`);
}
console.log(`  ok  4. ${entries.filter((e) => e.status === 'soon').length} «скоро» без вимикача, ${entries.filter((e) => e.live).length} live з вартою`);

// Ключі `kind: 'app'` реєстру фіч — рівно ті, що стереже хоч один запис APPS.
// Екран «Модулі» ховає ключі за цією ж множиною, тож він не вгадує, а читає.
const appKeys = (Object.keys(FEATURE_SPEC) as Key[]).filter((k) => (FEATURE_SPEC[k] as { kind?: Kind }).kind === 'app').sort();
const appFeatures = [...new Set(APPS.map((a) => a.feature).filter(Boolean) as string[])].sort();
assert.deepStrictEqual(appFeatures, appKeys,
  `ключі kind:'app' ${JSON.stringify(appKeys)} і вимикачі застосунків ${JSON.stringify(appFeatures)} розійшлись — екран «Модулі» покаже застосунок або сховає модуль`);

// ── 5. Платіжні шлюзи не дублюються ─────────────────────────────────────
//
// apps.ts не може імпортувати payments.ts (payments → integration-credentials
// → apps — цикл), тож label/where/live шлюзу підставляються з
// PAYMENT_PROVIDERS у місці читання. Той самий обʼєкт за посиланням — не копія.
for (const p of PAYMENT_PROVIDERS) {
  const e = entries.find((x) => x.id === p.id);
  assert.ok(e, `шлюз ${p.id} відсутній у каталозі застосунків`);
  assert.strictEqual(e.kind, 'payment');
  assert.strictEqual(e.provider, p, `${p.id}: каталог віддає копію, а не обʼєкт PAYMENT_PROVIDERS`);
  assert.strictEqual(e.live, p.live);
  assert.strictEqual(e.label, p.label);
  assert.strictEqual(e.where, p.where);
}
const paymentApps = APPS.filter(isGatewayApp);
assert.strictEqual(paymentApps.length, PAYMENT_PROVIDERS.length, 'кількість шлюзів у apps.ts і payments.ts різна');
for (const a of paymentApps) {
  assert.ok(!('label' in a) && !('where' in a) && !('live' in a),
    `${a.id}: у apps.ts переписано label/where/live шлюзу — джерело одне, payments.ts`);
}
assert.ok(!/from '\.\/payments/.test(fs.readFileSync('src/core/apps.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
  'apps.ts імпортує payments.ts — цикл payments → integration-credentials → apps');
console.log('  ok  5. три шлюзи — ті самі обʼєкти, що в PAYMENT_PROVIDERS');

// ── База: сцени 6–9 ─────────────────────────────────────────────────────
const { runWithOrganization } = await import('./auth/tenant-context.ts');
const { getSql } = await import('./db/async.ts');
const conn = await import('./app-connections.ts');
const { reportOk, reportError, listConnections, wishApp, wishedApps } = conn;

const sql = getSql();
const A = '__apps_check__a';
const B = '__apps_check__b';
const PROP = `${A}_prop`;

async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM app_connections WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM app_wishes WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM fin_fiscal_settings WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
  await sql.run("DELETE FROM platform_sessions WHERE id LIKE '__apps_check__%'");
  await sql.run("DELETE FROM platform_users WHERE id LIKE '__apps_check__%'");
  await sql.run("DELETE FROM sessions WHERE id LIKE '__apps_check__%'");
}

await cleanup();
for (const org of [A, B]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
}
await runWithOrganization(A, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, A, 'A', PROP]);
  await sql.run('INSERT INTO fin_fiscal_settings (id, organization_id, property_id, tss_id, tse_client_id) VALUES (?, ?, ?, ?, ?)',
    [`${A}_fs`, A, PROP, `${A}_tss`, `${A}_client`]);
});
await runWithOrganization(B, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [`${B}_prop`, B, 'B', `${B}_prop`]);
});

try {
  // ── 6. Стан звʼязку пишеться на ОБОХ гілках — fiskaly і пошта ──────────
  //
  // Дві осі (інваріант 26): успіх і відмова, і в кожній — два різні значення
  // на кожній осі (статус, мітка часу, текст).
  const { fiskalyDevice } = await import('../modules/invoicing/data/fiskaly-sign-de.ts');
  const realFetch = globalThis.fetch;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const okFiskaly = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth')) return json({ access_token: 'tok' });
    if (init?.method === 'PUT') return json({ number: 7, signature: { counter: 3, value: 'sig' }, time_start: 't0', time_end: 't1', qr_code_data: 'qr', schema: { standard_v1: {} } });
    return json({ serial_number: 'SER' });
  };
  const receipt = { amount: 10, method: 'cash' as const, vatAmounts: [{ rate: 19, amount: 10 }] };
  const device = fiskalyDevice({ apiKey: 'k', apiSecret: 's', tssId: `${A}_tss`, clientId: `${A}_client` });

  globalThis.fetch = okFiskaly as typeof fetch;
  await runWithOrganization(A, () => device.signReceipt(receipt));
  let rows = await runWithOrganization(A, () => listConnections(A));
  let fk = rows.find((r) => r.app === 'fiskaly');
  assert.ok(fk, 'після успішного підпису рядка fiskaly в app_connections немає');
  assert.strictEqual(fk.status, 'connected', `після успіху статус ${fk.status}, а не connected`);
  assert.ok(fk.last_ok_at, 'після успіху last_ok_at порожній');
  assert.strictEqual(fk.last_error, null, 'після успіху last_error не порожній');
  assert.strictEqual(fk.property_id, PROP, 'fiskaly — TSE обʼєкта: property_id мусить бути обʼєктом, чий tss_id підписував');
  const okAt = fk.last_ok_at;

  globalThis.fetch = (async (url: string) => (url.endsWith('/auth') ? new Response('TSS quota exceeded for this account', { status: 402 }) : json({}))) as typeof fetch;
  await assert.rejects(() => runWithOrganization(A, () => device.signReceipt(receipt)), /402/,
    'відмова fiskaly мусить лишитись винятком для того, хто підписує (folio-payments журналить простій)');
  rows = await runWithOrganization(A, () => listConnections(A));
  fk = rows.find((r) => r.app === 'fiskaly');
  assert.ok(fk);
  assert.strictEqual(fk.status, 'error', `після відмови статус ${fk.status}, а не error`);
  assert.ok(fk.last_error && /quota exceeded/.test(fk.last_error), `last_error не містить тексту відмови вендора: ${fk.last_error}`);
  assert.ok(fk.last_error_at, 'після відмови last_error_at порожній');
  assert.strictEqual(fk.last_ok_at, okAt, 'відмова не має стирати час останнього успіху — він і є відповідь «коли востаннє працювало»');
  assert.strictEqual(rows.filter((r) => r.app === 'fiskaly').length, 1, 'успіх і відмова дали два рядки замість одного (upsert)');
  globalThis.fetch = realFetch;

  // Пошта: транспорт підставляється замість nodemailer (CJS-обʼєкт спільний).
  const nodemailer = (await import('nodemailer')).default as unknown as { createTransport: (o: unknown) => unknown };
  const realCreate = nodemailer.createTransport;
  const { sendEmail, probeMail, forgetMailTransports } = await import('./mail/email.ts');
  const envBefore = { u: process.env.EMAIL_CZ_USER, p: process.env.EMAIL_CZ_PASSWORD, h: process.env.EMAIL_CZ_SMTP_HOST };
  process.env.EMAIL_CZ_USER = 'probe@example.test';
  process.env.EMAIL_CZ_PASSWORD = 'probe';
  process.env.EMAIL_CZ_SMTP_HOST = 'smtp.example.test';
  let mode: 'ok' | 'fail' = 'ok';
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      if (mode === 'fail') throw new Error('535 5.7.8 Authentication credentials invalid');
      return { messageId: 'x' };
    },
    verify: async () => {
      if (mode === 'fail') throw new Error('connect ECONNREFUSED 127.0.0.1:587');
      return true;
    },
  });
  forgetMailTransports();
  try {
    await runWithOrganization(A, () => sendEmail({ to: 'g@example.test', organizationId: A, subject: 's', html: '<p>x</p>' }));
    rows = await runWithOrganization(A, () => listConnections(A));
    let sm = rows.find((r) => r.app === 'smtp');
    assert.ok(sm, 'після успішної відправки рядка smtp немає');
    assert.strictEqual(sm.status, 'connected');
    assert.strictEqual(sm.property_id, null, 'пошта — організації: property_id мусить бути NULL');
    assert.ok(sm.last_ok_at);

    mode = 'fail';
    await assert.rejects(() => runWithOrganization(A, () => sendEmail({ to: 'g@example.test', organizationId: A, subject: 's', html: '<p>x</p>' })), /535/);
    rows = await runWithOrganization(A, () => listConnections(A));
    sm = rows.find((r) => r.app === 'smtp');
    assert.ok(sm);
    assert.strictEqual(sm.status, 'error');
    assert.ok(sm.last_error && /535 5\.7\.8/.test(sm.last_error), `last_error пошти без тексту відмови: ${sm.last_error}`);
    assert.ok(sm.last_error_at);
    assert.strictEqual(rows.filter((r) => r.app === 'smtp').length, 1);

    // «Перевірити звʼязок» іде тим самим шляхом: відмова verify — той самий
    // рядок, інший текст; успіх повертає connected.
    await assert.rejects(() => probeMail(A), /ECONNREFUSED/);
    sm = (await runWithOrganization(A, () => listConnections(A))).find((r) => r.app === 'smtp');
    assert.ok(sm && /ECONNREFUSED/.test(sm.last_error ?? ''), 'проба пошти не записала свій текст відмови');
    mode = 'ok';
    await probeMail(A);
    sm = (await runWithOrganization(A, () => listConnections(A))).find((r) => r.app === 'smtp');
    assert.strictEqual(sm?.status, 'connected', 'успішна проба пошти не повернула connected');
    assert.strictEqual(rows.filter((r) => r.app === 'smtp').length, 1);
  } finally {
    nodemailer.createTransport = realCreate;
    forgetMailTransports();
    process.env.EMAIL_CZ_USER = envBefore.u;
    process.env.EMAIL_CZ_PASSWORD = envBefore.p;
    process.env.EMAIL_CZ_SMTP_HOST = envBefore.h;
    for (const k of ['EMAIL_CZ_USER', 'EMAIL_CZ_PASSWORD', 'EMAIL_CZ_SMTP_HOST']) {
      if (process.env[k] === undefined) delete process.env[k];
    }
  }

  // reportError НЕ кидає, коли база відмовляє: організації, якої немає, —
  // порушення FK на обох рушіях. Стан звʼязку не має ламати операцію, яку описує.
  await assert.doesNotReject(() => reportError('smtp', '__apps_check__ghost', 'x'),
    'reportError кинув, коли база відмовила — відмова fiskaly перетворилась би на другу відмову');
  await assert.doesNotReject(() => reportOk('smtp', '__apps_check__ghost'));
  console.log('  ok  6. успіх → connected з last_ok_at; відмова → error з текстом; reportError не кидає');

  // ── 7. Обʼєкт або організація — за законом ──────────────────────────────
  await runWithOrganization(A, () => reportOk('smtp', A, PROP));
  rows = await runWithOrganization(A, () => listConnections(A));
  assert.strictEqual(rows.filter((r) => r.app === 'smtp' && r.property_id !== null).length, 0,
    'smtp записано з property_id — креденшели організації, підключення пошти теж її');
  await runWithOrganization(A, () => reportError('fiskaly', A, 'boom'));
  rows = await runWithOrganization(A, () => listConnections(A));
  assert.strictEqual(rows.filter((r) => r.app === 'fiskaly' && r.property_id === null).length, 0,
    'fiskaly записано без property_id — TSE стоїть на обʼєкті (fin_fiscal_settings.property_id)');
  console.log('  ok  7. smtp без обʼєкта, fiskaly з обʼєктом — інакше рядка немає');

  // ── 8. «Хочу» ідемпотентно, чужа організація не бачить ──────────────────
  await runWithOrganization(A, () => wishApp(A, 'winhotel_import'));
  await runWithOrganization(A, () => wishApp(A, 'winhotel_import'));
  const wishesA = await runWithOrganization(A, () => wishedApps(A));
  assert.deepStrictEqual(wishesA, ['winhotel_import'], `два натиски дали ${JSON.stringify(wishesA)}`);
  const nA = await runWithOrganization(A, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM app_wishes WHERE organization_id = ? AND app = ?', [A, 'winhotel_import']));
  assert.strictEqual(Number(nA?.n), 1, 'другий натиск «хочу» створив другий рядок');
  const wishesB = await runWithOrganization(B, () => wishedApps(B));
  assert.deepStrictEqual(wishesB, [], 'готель B бачить «хочу» готелю A');
  // Голий запит без organization_id — його тримає лише ПОЛІТИКА, тобто лише
  // Postgres: на SQLite політик немає, і рядок A видно з будь-якого контексту
  // (так і має бути — SQLite не двигун клієнта). Тому твердження про політику
  // ставиться в `check:pg`; тут воно було червоним 09.09.2026 саме на SQLite,
  // і це показало, що на цьому рушії воно не стверджує нічого.
  if (process.env.DB_DRIVER === 'postgres') {
    const seenByB = await runWithOrganization(B, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM app_wishes WHERE app = ?', ['winhotel_import']));
    assert.strictEqual(Number(seenByB?.n), 0, 'у контексті B видно рядок A (політика app_wishes не тримає)');
    const connSeenByB = await runWithOrganization(B, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM app_connections WHERE app = ?', ['fiskaly']));
    assert.strictEqual(Number(connSeenByB?.n), 0, 'у контексті B видно стан звʼязку A (політика app_connections не тримає)');
  }
  await assert.rejects(() => runWithOrganization(A, () => wishApp(A, 'not_an_app' as never)), /невідом|unknown/i,
    '«хочу» на неіснуючий застосунок мусить відмовити, а не записати довільний рядок');
  console.log('  ok  8. «хочу» — один рядок на готель і застосунок, сусід його не бачить');

  // ── 9. Сторінка постачальника відмовляє власнику, віддає все платформі ──
  const { platformAppsReport } = await import('../app/api/platform/apps/_report.ts');
  // Звичайна сесія власника готелю — не платформна: 401.
  await runWithOrganization(A, () => sql.run(
    "INSERT INTO app_users (id, organization_id, email, full_name, role) VALUES (?, ?, ?, ?, 'owner')",
    [`${A}_user`, A, 'owner@apps-check.test', 'Apps Check Owner']));
  await sql.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    ['__apps_check__customer', `${A}_user`, new Date(Date.now() + 3600e3).toISOString()]);
  const refused = await platformAppsReport('__apps_check__customer');
  assert.strictEqual(refused.status, 401, `сесія власника готелю отримала ${refused.status} замість 401`);
  const none = await platformAppsReport(undefined);
  assert.strictEqual(none.status, 401);

  await sql.run("INSERT INTO platform_users (id, email, password_hash) VALUES (?, ?, ?)", ['__apps_check__pu', 'apps-check@platform.test', 'x']);
  await sql.run("INSERT INTO platform_sessions (id, platform_user_id, acting_organization_id, expires_at) VALUES (?, ?, NULL, ?)",
    ['__apps_check__ps', '__apps_check__pu', new Date(Date.now() + 3600e3).toISOString()]);
  await runWithOrganization(B, () => reportError('smtp', B, 'B mailbox down'));
  const ok = await platformAppsReport('__apps_check__ps');
  assert.strictEqual(ok.status, 200, `платформна сесія отримала ${ok.status}`);
  const report = await ok.json() as { connections: { organization_id: string; app: string; status: string; last_error: string | null }[]; wishes: { app: string; hotels: number }[] };
  const orgsSeen = new Set(report.connections.map((c) => c.organization_id));
  assert.ok(orgsSeen.has(A) && orgsSeen.has(B), `постачальник бачить ${JSON.stringify([...orgsSeen])} — мають бути обидва орендарі`);
  const bRow = report.connections.find((c) => c.organization_id === B && c.app === 'smtp');
  assert.strictEqual(bRow?.status, 'error');
  assert.strictEqual(bRow?.last_error, 'B mailbox down');
  const aFiskaly = report.connections.find((c) => c.organization_id === A && c.app === 'fiskaly');
  assert.strictEqual(aFiskaly?.status, 'error');
  const wishRow = report.wishes.find((w) => w.app === 'winhotel_import');
  assert.strictEqual(Number(wishRow?.hotels), 1, `попит Winhotel = ${wishRow?.hotels}, а натиснув один готель`);
  console.log('  ok  9. постачальник: власнику 401, платформі — обидва готелі й попит');
} finally {
  await cleanup();
}

// ── 11. Слово вендора не зʼявляється в застосунках ──────────────────────
//
// check-vendor-isolation тримає це на всьому src/; тут — та сама властивість
// названа для файлів цього блоку, щоб гейт блоку був самодостатнім.
for (const file of [
  'src/core/apps.ts',
  'src/core/app-connections.ts',
  'src/app/app/(dashboard)/settings/apps/page.tsx',
  'src/app/app/platform/apps/page.tsx',
]) {
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.ok(!/\bchannex\b/i.test(text), `${file}: імʼя вендора — тут «менеджер каналів» (И1)`);
}
console.log('  ok  11. менеджер каналів названий роллю, не вендором');

// Реєстр читається як маніфест: дані, які колись прийдуть із теки застосунку.
for (const a of APPS) {
  assert.ok(appById(a.id) === a);
  assert.ok(a.pricing === 'free' || a.pricing === 'paid' || a.pricing === 'included', `${a.id}: pricing ${a.pricing}`);
}
assert.strictEqual(appById('winhotel_import')?.pricing, 'free', 'З1: winhotel_import — безкоштовний');
console.log('  ok  застосунки: реєстр, ключі, стан звʼязку і постачальник кажуть одне');
