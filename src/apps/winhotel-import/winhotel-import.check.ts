/**
 * Знімок Winhotel доходить, лягає під орендаря і витягається — і нічого з
 * цього не відбувається без токена, з чужим токеном або з битим файлом.
 *
 *   node src/apps/winhotel-import/winhotel-import.check.ts
 *   DB_DRIVER=postgres DATABASE_URL=… node src/apps/winhotel-import/winhotel-import.check.ts
 *
 * Сцени 1–11 — частина А (прийом і витяг); сцени Б1–Б6 — частина Б (§2.5–2.6):
 * незнайдений код категорії зупиняє імпорт і називається; майбутня бронь із
 * трьома адресами → три reservation_guests; 141.000 × 3 ночі → 423 у ядрі;
 * той самий знімок двічі → нуль нових рядків у ядрі й у refs; новіша дата
 * виїзду → одна бронь, нова дата; бронь, якої в знімку більше немає, →
 * cancelled; Sammelrechnung і всі фактури → staging з лічильником; готівка
 * на DE без TSE → staging; гість A невидимий із B через refs і таблиці.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Дві організації: A — застосунок увімкнено, B — вимкнено; в обох є токен,
 * тож «чужий токен» і «вимкнений застосунок» — різні відмови (401 проти
 * 404), а не одна. Два тіла: справжнє й підмінене (sha256 не збігається).
 * Два стани знімка на томі: `.extracted` і `.failed`. У стабі бази — по два
 * значення на кожній осі перетворення: жива/видалена, 1899-12-30/справжня
 * дата, 141.000/89.500 (домени NUMERIC(12,3), як у живій базі — рецензія А),
 * ASCII/умлаут.
 *
 * ── Що доводиться живим Firebird, а що без нього ────────────────────────
 *
 * Перетворення (CP1252, десяткові домени як є, нуль Delphi) — на чистих функціях мосту, без
 * бази. Властивість «TA_STATUS >= 1000 не витягається» — на СПРАВЖНЬОМУ
 * `gbak -c` + `isql` зі стабом `fixture/stub-db.sql`, якщо бінарники є в
 * системі; якщо їх немає (CI без Firebird), сцена пропускається з названим
 * рядком, і покриття тримає локальний прогін та `bridge-local.sh --stub`
 * (звіт блоку цитує вихід). Мовчазного «зелено» тут немає: рядок «пропущено»
 * друкується великими літерами.
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import '../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-winhotel-'));
process.env.ALISIO_DATA_DIR = tmp;
process.env.APP_SECRET_KEY ||= '0'.repeat(64);

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { setFeature } = await import('@core/features.ts');
const { listConnections } = await import('@core/app-connections.ts');
const { ALL_PROPERTIES } = await import('@core/property-scope.ts');
const tokens = await import('./data/agent-token.ts');
const repo = await import('./data/snapshots.repo.ts');
const { snapshotPaths, snapshotRoot } = await import('./storage.ts');
const handlers = await import('./api/snapshots.handlers.ts');
const refsRepo = await import('./data/refs.repo.ts');
const findRefB = (org: string) => refsRepo.findRef(org, 'address', 2);
const convert = await import('../../../deploy/bridge/lib/convert.mjs');

const sql = getSql();
const A = '__whi_check__a';
const B = '__whi_check__b';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const SQL_DIR = path.join(ROOT, 'apps/winhotel-import/sql');
const isPg = process.env.DB_DRIVER === 'postgres';

async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM winhotel_snapshots WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM winhotel_refs WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM winhotel_staging WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM reservations WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM guests WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM fin_tax_rates WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM app_connections WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM channel_credentials WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
for (const org of [A, B]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
}
await runWithOrganization(A, () => setFeature(A, 'winhotel_import', true));
await runWithOrganization(B, () => setFeature(B, 'winhotel_import', false));
const tokenA = await runWithOrganization(A, () => tokens.issueAgentToken(A));
const tokenB = await runWithOrganization(B, () => tokens.issueAgentToken(B));

// Тіло знімка: справжній стаб-бекап, якщо Firebird є; інакше — випадкові байти
// (для прийому важливі лише байти й sha256).
const FIREBIRD = (() => {
  try { execFileSync('which', ['gbak']); execFileSync('which', ['isql-fb']); return true; } catch { return false; }
})();
const stubFbk = path.join(tmp, 'stub.fbk');
if (FIREBIRD) execFileSync('bash', [path.join(ROOT, 'apps/winhotel-import/fixture/make-stub.sh'), stubFbk], { stdio: 'pipe' });
const raw = FIREBIRD ? fs.readFileSync(stubFbk) : crypto.randomBytes(70000);
const body = zlib.gzipSync(raw);
const sha = crypto.createHash('sha256').update(body).digest('hex');

function post(headers: Record<string, string>, payload: Buffer | null = body): Promise<Response> {
  return handlers.receiveSnapshot(new Request('http://alisio.test/api/apps/winhotel-import/snapshots', {
    method: 'POST',
    headers: { 'content-type': 'application/gzip', ...headers },
    body: payload ? new Uint8Array(payload) : null,
    // @ts-expect-error — undici вимагає duplex для тіла-потоку; Next це ставить сам
    duplex: 'half',
  }));
}
const good = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  'x-winhotel-sha256': sha,
  'x-winhotel-mode': 'gbak',
  'x-winhotel-taken-at': '2026-09-10T03:00:00Z',
  'x-winhotel-hostname': 'stub-host',
  ...extra,
});
const filesOf = (org: string) => (fs.existsSync(path.join(snapshotRoot(), org)) ? fs.readdirSync(path.join(snapshotRoot(), org)) : []);
const rowsOf = (org: string) => runWithOrganization(org, () => repo.listSnapshots(org, 100));

try {
  // ── 1. Без токена / з чужим секретом → 401, і жоден байт не лягає ────────
  let res = await post({ 'x-winhotel-sha256': sha, 'x-winhotel-mode': 'gbak' });
  assert.strictEqual(res.status, 401, `без токена очікували 401, отримали ${res.status}`);
  res = await post(good('garbage'));
  assert.strictEqual(res.status, 401, `зі сміттям замість токена очікували 401, отримали ${res.status}`);
  // Префікс A, секрет B: рядок ключів A прочитано, хеш не той.
  const secretB = tokens.parseBearer(`Bearer ${tokenB}`)!.secret;
  res = await post(good(`${A}.${secretB}`));
  assert.strictEqual(res.status, 401, `A з секретом B очікували 401, отримали ${res.status}`);
  assert.deepStrictEqual(filesOf(A), [], `після 401 у теці A лежить ${JSON.stringify(filesOf(A))}`);
  assert.strictEqual((await rowsOf(A)).length, 0, 'після 401 у A зʼявився рядок знімка');
  console.log('  ok  1. без токена, зі сміттям, із чужим секретом — 401; файлів і рядків немає');

  // ── 2. Токен справжній, застосунок вимкнено → 404 ────────────────────────
  res = await post(good(tokenB));
  assert.strictEqual(res.status, 404, `вимкнений застосунок: очікували 404, отримали ${res.status}`);
  assert.deepStrictEqual(filesOf(B), [], 'вимкнений застосунок, а файл лягло');
  assert.strictEqual((await rowsOf(B)).length, 0, 'вимкнений застосунок, а рядок є');
  console.log('  ok  2. токен B справжній, застосунок у B вимкнено — 404, нічого не лягло');

  // ── 3. sha256 не збігається → 400, файла немає, рядка немає, помилка на картці ──
  const bad = crypto.createHash('sha256').update('not this body').digest('hex');
  res = await post(good(tokenA, { 'x-winhotel-sha256': bad }));
  assert.strictEqual(res.status, 400, `битий sha256: очікували 400, отримали ${res.status}`);
  const text = ((await res.json()) as { error: string }).error;
  assert.match(text, /Контрольна сума/, `текст відмови: «${text}»`);
  assert.deepStrictEqual(filesOf(A).filter((f) => !f.endsWith('.keep')), [], `після 400 у теці A лишилось ${JSON.stringify(filesOf(A))}`);
  assert.strictEqual((await rowsOf(A)).length, 0, 'після 400 у A зʼявився рядок');
  let conn = (await runWithOrganization(A, () => listConnections(A, ALL_PROPERTIES))).find((c) => c.app === 'winhotel_import');
  assert.ok(conn && conn.status === 'error' && /Контрольна сума/.test(conn.last_error ?? ''), `стан звʼязку після 400: ${JSON.stringify(conn)}`);
  // Режим невідомий і sha не hex — теж названі відмови, до першого байта.
  res = await post(good(tokenA, { 'x-winhotel-mode': 'ftp' }));
  assert.strictEqual(res.status, 400, `невідомий режим: очікували 400, отримали ${res.status}`);
  res = await post(good(tokenA, { 'x-winhotel-sha256': 'zz' }));
  assert.strictEqual(res.status, 400, `sha не hex: очікували 400, отримали ${res.status}`);
  console.log('  ok  3. sha256 не збігається — 400 з текстом, файл видалено, рядка немає, картка каже чому');

  // ── 4. Справжній знімок → 201, файл + .ready, рядок received, картка connected ──
  res = await post(good(tokenA));
  const createdText = await res.text();
  assert.strictEqual(res.status, 201, `справжній знімок: очікували 201, отримали ${res.status} ${createdText}`);
  const created = JSON.parse(createdText) as { snapshotId: string; status: string };
  assert.match(created.snapshotId, /^whs_\d{8}_[0-9a-f]{8}$/, `id знімка ${created.snapshotId}`);
  const p = snapshotPaths(A, created.snapshotId);
  assert.ok(fs.existsSync(p.archive), 'файл знімка не лежить на томі');
  assert.ok(fs.existsSync(p.ready), 'маркера .ready немає — міст його не візьме');
  assert.ok(!fs.existsSync(p.part), 'лишився .part');
  assert.strictEqual(fs.readFileSync(p.archive).length, body.length, 'файл на диску не того розміру');
  const ready = JSON.parse(fs.readFileSync(p.ready, 'utf8')) as { mode: string; sha256: string; takenAt: string };
  assert.strictEqual(ready.mode, 'gbak');
  assert.strictEqual(ready.sha256, sha);
  let rows = await rowsOf(A);
  assert.strictEqual(rows.length, 1, `після прийому рядків ${rows.length}`);
  assert.strictEqual(rows[0].status, 'received');
  assert.strictEqual(Number(rows[0].size_bytes), body.length);
  assert.strictEqual(rows[0].sha256, sha);
  assert.strictEqual(String(rows[0].taken_at).slice(0, 16), '2026-09-10 03:00', `taken_at = ${rows[0].taken_at}`);
  conn = (await runWithOrganization(A, () => listConnections(A, ALL_PROPERTIES))).find((c) => c.app === 'winhotel_import');
  assert.strictEqual(conn?.status, 'connected', `стан звʼязку після прийому: ${conn?.status}`);
  assert.strictEqual(conn?.last_error, null, 'після успіху last_error не порожній');
  console.log('  ok  4. знімок прийнято: 201, файл і .ready на томі, рядок received, картка connected');

  // ── 5. Той самий знімок удруге → 200 з тим самим id, рядок один; інший того ж дня → 409 ──
  res = await post(good(tokenA));
  assert.strictEqual(res.status, 200, `повтор: очікували 200, отримали ${res.status}`);
  const again = (await res.json()) as { snapshotId: string; duplicate: boolean };
  assert.strictEqual(again.snapshotId, created.snapshotId, 'повтор віддав інший id');
  assert.strictEqual(again.duplicate, true);
  rows = await rowsOf(A);
  assert.strictEqual(rows.length, 1, `після повтору рядків ${rows.length}`);
  assert.strictEqual(filesOf(A).filter((f) => f.endsWith('.fbk.gz')).length, 1, 'після повтору файлів два');
  const other = zlib.gzipSync(Buffer.concat([raw, Buffer.from('x')]));
  const otherSha = crypto.createHash('sha256').update(other).digest('hex');
  res = await post(good(tokenA, { 'x-winhotel-sha256': otherSha }), other);
  assert.strictEqual(res.status, 409, `другий знімок за добу: очікували 409, отримали ${res.status}`);
  assert.strictEqual((await rowsOf(A)).length, 1, 'другий знімок за добу створив рядок');
  console.log('  ok  5. повтор того самого sha256 — 200 і той самий id; другий інший за добу — 409');

  // ── 6. Чужа організація не бачить знімка A ───────────────────────────────
  assert.strictEqual((await rowsOf(B)).length, 0, 'B бачить знімок A через репозиторій');
  assert.deepStrictEqual(filesOf(B), [], 'у теці B зʼявились файли');
  if (isPg) {
    const seen = await runWithOrganization(B, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM winhotel_snapshots'));
    assert.strictEqual(Number(seen?.n), 0, 'політика winhotel_snapshots не тримає: B бачить рядок A голим запитом');
  }
  console.log(`  ok  6. B не бачить знімка A${isPg ? ' — і політикою теж' : ' (політика — у check:pg)'}`);

  // ── 7. Маркери мосту переводять стан: .extracted з числами, .failed з текстом ──
  fs.writeFileSync(p.extracting, 'now');
  await runWithOrganization(A, () => repo.syncMarkers(A));
  rows = await rowsOf(A);
  assert.strictEqual(rows[0].status, 'extracting', `після .extracting стан ${rows[0].status}`);
  fs.mkdirSync(p.out, { recursive: true });
  const aggregates = { snapshot: { id: created.snapshotId }, entities: { bookings: 5, units: 4 }, numbers: { bookings_live: { label: 'x', value: '4' } } };
  fs.writeFileSync(path.join(p.out, 'aggregates.json'), JSON.stringify(aggregates));
  fs.writeFileSync(path.join(p.out, 'bookings.jsonl'), '{"lnr":101}\n');
  fs.writeFileSync(p.extracted, '{}');
  fs.rmSync(p.extracting);
  await runWithOrganization(A, () => repo.syncMarkers(A));
  rows = await rowsOf(A);
  assert.strictEqual(rows[0].status, 'extracted', `після .extracted стан ${rows[0].status}`);
  const counts = JSON.parse(rows[0].counts_json ?? '{}') as { winhotel: Record<string, number> };
  assert.strictEqual(counts.winhotel?.bookings, 5, `counts_json = ${rows[0].counts_json}`);
  assert.strictEqual(counts.winhotel?.units, 4);
  // Другий знімок (наступної «доби» — підставляємо рядок напряму) падає в мосту.
  const failedId = repo.newSnapshotId(new Date('2026-09-11T03:00:00Z'));
  await runWithOrganization(A, () => repo.insertSnapshot({ id: failedId, organizationId: A, takenAt: null, mode: 'copy', sha256: otherSha, sizeBytes: 7 }));
  const pf = snapshotPaths(A, failedId);
  fs.writeFileSync(pf.failed, 'gbak -c відмовив (код 1): bad backup header');
  await runWithOrganization(A, () => repo.syncMarkers(A));
  const failed = await runWithOrganization(A, () => repo.findSnapshot(A, failedId));
  assert.strictEqual(failed?.status, 'failed');
  assert.match(failed?.error ?? '', /gbak -c відмовив/, `текст відмови мосту: ${failed?.error}`);
  console.log('  ok  7. маркери мосту: .extracting → extracting, .extracted → extracted з числами, .failed → failed з текстом');

  // ── 8. «Імпортувати знімок» — частина Б: названа відмова, не вдаваний успіх ──
  const importRes = await runWithOrganization(A, async () => {
    // Прямий виклик під контекстом орендаря: сесії тут немає, варта withOwner
    // доводиться check-route-guards; тут — поведінка самого хендлера.
    const inner = await import('./api/snapshots.handlers.ts');
    return inner.importSnapshot;
  });
  assert.strictEqual(typeof importRes, 'function');
  console.log('  ok  8. хендлер імпорту існує; поведінка (409 з назвою частини Б) — під withOwner, сцена в частині Б');

  // ── 9. Перетворення мосту: CP1252, /1000, нуль Delphi, порожнє → null ────
  assert.strictEqual(convert.convertValue('text', Buffer.from([0xdc, 0x46])), 'ÜF', 'CP1252 0xDC не став Ü');
  assert.strictEqual(convert.convertValue('text', Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72])), 'Müller');
  // Домени NUMERIC(12,3)/(12,2): isql віддає вже масштабоване число — читається як є.
  // Перша редакція ділила на 1000 і на живій базі давала 0.141 (рецензія А).
  assert.strictEqual(convert.convertValue('amount', '141.000'), 141, '141.000 (N_BETRAG) не став 141');
  assert.strictEqual(convert.convertValue('amount', '12.50'), 12.5, '12.50 (BETRAG2) не став 12.5');
  assert.strictEqual(convert.convertValue('amount', '-1.500'), -1.5, '-1.500 не став -1.5');
  assert.strictEqual(convert.convertValue('amount', '0.038'), 0.038, '0.038 (три знаки) не лишився 0.038');
  assert.strictEqual(convert.convertValue('amount', '141.0010'), 141.001, 'DECIMAL(12,4) не читається як є');
  assert.strictEqual(convert.convertValue('amount', '1.000000'), 1, 'NUMERIC(12,6) курс 1.000000 не став 1');
  assert.strictEqual(convert.convertValue('amount', '141000'), 141000, 'ціле без крапки — це 141000, а не «×1000»');
  assert.strictEqual(convert.convertValue('date', '1899-12-30'), null, 'нуль Delphi не став null');
  assert.strictEqual(convert.convertValue('date', '2027-03-10'), '2027-03-10');
  assert.strictEqual(convert.convertValue('ts', '1899-12-30 00:00:00.0000'), null);
  assert.strictEqual(convert.convertValue('ts', '2026-09-09 08:11:00.0000'), '2026-09-09 08:11:00');
  assert.strictEqual(convert.convertValue('bool', '-1'), true, 'ZIMMERART -1 не став true');
  assert.strictEqual(convert.convertValue('bool', '0'), false);
  assert.strictEqual(convert.convertValue('int', ''), null);
  assert.strictEqual(convert.convertValue('text', '   '), null);
  const cols = convert.parseColumns('-- columns: lnr:int, name:text, betrag:amount, d:date');
  const rec = Buffer.concat([Buffer.from('7\x1f'), Buffer.from([0xdc, 0x46]), Buffer.from('\x1f141.000\x1f1899-12-30')]);
  assert.deepStrictEqual(convert.convertRecord(cols, rec), { lnr: 7, name: 'ÜF', betrag: 141, d: null });
  assert.throws(() => convert.convertRecord(cols, Buffer.from('7\x1fx')), /полів/, 'запис із меншою кількістю полів пройшов');
  assert.throws(() => convert.parseColumns('-- columns: lnr:integer'), /type/, 'невідомий тип колонки пройшов');
  console.log('  ok  9. перетворення: ÜF з CP1252, 141.000 → 141 і 12.50 → 12.5 без ділення, 1899-12-30 → null, -1 → true, порожнє → null');

  // ── 10. Кожен SQL сутності називає TA_STATUS, або його виняток названий словами ──
  const NO_FILTER = new Set(['services', 'rate_codes', 'payment_methods', 'invoices', 'invoice_lines', 'invoice_ledger']);
  const sqlFiles = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql') && f !== 'aggregates.sql');
  assert.ok(sqlFiles.length >= 27, `SQL-файлів ${sqlFiles.length} — план має 14 кроків і 27 сутностей`);
  for (const f of sqlFiles) {
    const text = fs.readFileSync(path.join(SQL_DIR, f), 'utf8');
    const entity = convert.parseHeader(text, 'entity');
    assert.ok(entity, `${f}: без -- entity:`);
    convert.parseColumns(text);
    const where = text.match(/^WHERE (.+);$/m)?.[1] ?? '';
    const kept = convert.parseHeader(text, 'deleted');
    if (NO_FILTER.has(entity!)) {
      assert.ok(kept && /^kept — .{10,}/.test(kept), `${f}: видалене береться, а «-- deleted: kept — <чому>» у шапці немає`);
    } else {
      assert.strictEqual(kept, null, `${f}: шапка каже kept, а гейт цього винятку не знає`);
      assert.match(where, /TA_STATUS < 1000/, `${f}: WHERE «${where}» не відсікає видалене`);
    }
    assert.match(text, /ASCII_CHAR\(30\)/, `${f}: без термінатора запису`);
  }
  console.log(`  ok  10. ${sqlFiles.length} SQL сутностей: TA_STATUS < 1000 або названий виняток, термінатор запису є`);

  // ── 11. Живий Firebird: стаб → gbak -c → isql → jsonl, і видалене не витягається ──
  if (FIREBIRD) {
    const { processSnapshot } = await import('../../../deploy/bridge/lib/extract.mjs');
    const out = path.join(tmp, 'extract');
    const result = await processSnapshot({ archive: p.archive, mode: 'gbak', sqlDir: SQL_DIR, outDir: out, workDir: path.join(tmp, 'work') }) as { entities: Record<string, number>; numbers: Record<string, { value: string }> };
    const expect: Record<string, number> = {
      mandant: 1, tax_codes: 3, unit_types: 3, units: 4, services: 10, service_groups: 6, rate_codes: 3, seasons: 2, prices: 3,
      price_splits: 1, segments: 2, address_types: 2, age_bands: 3, payment_methods: 5, consent_types: 2, addresses: 5,
      bookings: 5, occupancy: 4, booking_refs: 1, folio_lines: 7, invoices: 3, invoice_lines: 3, invoice_ledger: 2,
      payments: 4, cash_book: 1, consents: 2, day_closings: 2,
    };
    for (const [entity, n] of Object.entries(expect)) {
      assert.strictEqual(result.entities[entity], n, `${entity}: витягнуто ${result.entities[entity]}, стаб має ${n} живих`);
    }
    const jsonl = (e: string) => fs.readFileSync(path.join(out, `${e}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const units = jsonl('units');
    assert.ok(!units.some((u) => u.zinr === '104'), 'номер 104 (TA_STATUS 1000) витягнуто');
    assert.ok(units.some((u) => u.zinr === '9999' && u.stock === 99), 'псевдо-номер 9999 має бути у витягу (застосунок вирішує сам)');
    const bookings = jsonl('bookings');
    assert.ok(!bookings.some((b) => b.lnr === 105), 'бронь 105 (видалена без дати сторно) витягнуто');
    assert.ok(bookings.some((b) => b.lnr === 104 && b.storno_datum === '2025-01-15' && b.ta_status === 1000), 'сторнована з датою 104 має бути у витягу');
    const b101 = bookings.find((b) => b.lnr === 101)!;
    assert.deepStrictEqual([b101.gastnr_1, b101.gastnr_2, b101.gastnr_3], [1, 2, 5], 'три адреси броні 101');
    assert.strictEqual(b101.anza_betrag, 50, 'депозит N_BETRAG 50.000 → 50');
    assert.strictEqual(b101.bemerk, 'Späte Anreise', `умлаут у примітці броні: ${b101.bemerk}`);
    const services = jsonl('services');
    const uef = services.find((s) => s.lnr === 67)!;
    assert.strictEqual(uef.kurzbez, 'ÜN', `KURZBEZ ${uef.kurzbez}`);
    assert.strictEqual(uef.bezeichn, 'ÜF Übernachtung/Frühstück', `BEZEICHN ${uef.bezeichn}`);
    assert.strictEqual(uef.betrag, 141, '141.000 у послузі не став 141');
    assert.ok(services.some((s) => s.lnr === 91 && s.ta_status === 1000), 'вимкнена послуга 91 мусить бути у витягу (історія посилається)');
    const lines = jsonl('folio_lines');
    const l1001 = lines.find((l) => l.lnr === 1001)!;
    assert.strictEqual(l1001.gbetrag, 423, `GBETRAG 423.000 → ${l1001.gbetrag}`);
    assert.strictEqual(l1001.e_preis, 141);
    assert.strictEqual(l1001.bezeichn, 'ÜF 2 Personen');
    assert.ok(!lines.some((l) => l.lnr === 1006), 'видалений рядок рахунку 1006 витягнуто');
    const addresses = jsonl('addresses');
    const a1 = addresses.find((a) => a.lnr === 1)!;
    assert.strictEqual(a1.gebdat, null, `1899-12-30 у GEBDAT → ${a1.gebdat}`);
    const a2 = addresses.find((a) => a.lnr === 2)!;
    assert.strictEqual(a2.name1, 'Müller-Stub');
    assert.strictEqual(a2.bemerk, 'Stammgast\r\nruhiges Zimmer', `BLOB з переносом: ${JSON.stringify(a2.bemerk)}`);
    assert.ok(!('iban' in a1) && !('kontonr' in a1) && !('passwort' in a1), 'банк/пароль потрапили у витяг адрес');
    const occ = jsonl('occupancy');
    assert.strictEqual(occ.find((o) => o.lnr === 4)!.anreise, null, 'сміттєва дата BELEGUNG не стала null');
    const payments = jsonl('payments');
    assert.strictEqual(payments.find((x) => x.lnr === 4)!.betrag, -1.5, 'повернення -1.500 → -1.5');
    assert.strictEqual(payments.find((x) => x.lnr === 1)!.uhrzeit, '10:05:00');
    assert.strictEqual(result.numbers.invoice_no_generator.value, '22591', `генератор фактур: ${result.numbers.invoice_no_generator.value}`);
    assert.strictEqual(result.numbers.bookings_future.value, '2', `майбутніх броней: ${result.numbers.bookings_future.value}`);
    assert.strictEqual(result.numbers.occupancy_junk_dates.value, '1');
    assert.match(result.numbers.open_guest_balances.value, /^2 321\.5/, `відкриті сальдо: ${result.numbers.open_guest_balances.value}`);
    assert.ok(!fs.existsSync(path.join(tmp, 'work')), 'робоча тека з відновленою базою лишилась');
    console.log(`  ok  11. живий Firebird: стаб → ${Object.keys(result.entities).length} сутностей; видалене не витягнуто, умлаути, домени сум і нуль Delphi — правильні, база прибрана`);
  } else {
    console.log('  ПРОПУЩЕНО 11. живий Firebird (gbak/isql-fb) у системі немає — сцену витягу тримає локальний прогін і bridge-local.sh --stub');
  }

  // ══ Частина Б — імпорт у ядро (§2.5–2.7) ═══════════════════════════════
  //
  // Стаб мосту — `fixture/extracted/*.jsonl` (те, що міст робить зі стаба бази;
  // без Firebird у CI саме вони й є витягом). Готель A сіється рівно тим, що
  // імпорт має ЗНАЙТИ: категорії, номери, послуги, ставки; нічого з цього
  // імпорт не створює.
  const { importSnapshotNow } = handlers;
  const FIX = path.join(ROOT, 'apps/winhotel-import/fixture/extracted');
  const PROP = `${A}_prop`;
  const CAT = `${A}_cat`;
  await runWithOrganization(A, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, ?, ?, ?)', [PROP, A, 'Stub Hotel', PROP, 'DE']);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Zimmer', 'room']);
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)', [`${A}_dzd`, PROP, CAT, 'Doppelzimmer Deluxe', 'DZD']);
    for (const code of ['102', '103']) {
      await sql.run('INSERT INTO units (id, property_id, unit_type_id, category_id, name, code) VALUES (?, ?, ?, ?, ?, ?)', [`${A}_u${code}`, PROP, `${A}_dzd`, CAT, code, code]);
    }
    for (const name of ['Frühstück – Speisen', 'Frühstück-Getränke']) {
      await sql.run('INSERT INTO additional_services (id, property_id, name, price) VALUES (?, ?, ?, ?)', [`${A}_svc_${name.length}`, PROP, name, 12]);
    }
    for (const [code, rate] of [['zero', 0], ['reduced', 7], ['standard', 19]] as const) {
      await sql.run('INSERT INTO fin_tax_rates (id, organization_id, property_id, code, rate, valid_from) VALUES (?, ?, ?, ?, ?, ?)', [`${A}_tax_${code}`, A, null, code, rate, '2020-01-01']);
    }
    await sql.run('INSERT INTO booking_sources (id, property_id, name, code) VALUES (?, ?, ?, ?)', [`${A}_src`, PROP, 'Direkt', 'direct']);
    await sql.run('INSERT INTO booking_sources (id, property_id, name, code) VALUES (?, ?, ?, ?)', [`${A}_src_bk`, PROP, 'Booking.com', 'booking_com']);
  });
  // Знімок для імпорту: рядок + витяг зі стаба мосту + маркер.
  const IMP = repo.newSnapshotId(new Date('2026-09-12T03:00:00Z'));
  const fxSha = crypto.createHash('sha256').update('fixture-extracted').digest('hex');
  await runWithOrganization(A, () => repo.insertSnapshot({ id: IMP, organizationId: A, takenAt: '2026-09-09 08:11:00', mode: 'gbak', sha256: fxSha, sizeBytes: 1 }));
  const pi = snapshotPaths(A, IMP);
  const stageFixture = () => {
    fs.rmSync(pi.out, { recursive: true, force: true });
    fs.mkdirSync(pi.out, { recursive: true });
    for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(pi.out, f));
    fs.writeFileSync(pi.extracted, '{}');
  };
  stageFixture();
  await runWithOrganization(A, () => repo.syncMarkers(A));
  assert.strictEqual((await runWithOrganization(A, () => repo.findSnapshot(A, IMP)))?.status, 'extracted');
  if (FIREBIRD) {
    // Витяг зі стаба живим Firebird = закоміченому стабу мосту: лічильники ті самі.
    const live = JSON.parse(fs.readFileSync(path.join(tmp, 'extract', 'aggregates.json'), 'utf8')) as { entities: Record<string, number> };
    const committed = JSON.parse(fs.readFileSync(path.join(FIX, 'aggregates.json'), 'utf8')) as { entities: Record<string, number> };
    assert.deepStrictEqual(live.entities, committed.entities, 'fixture/extracted розійшовся зі стабом бази — перегенеруйте bridge-local.sh --stub');
  }
  const countA = async (q: string, params: unknown[] = []) => Number((await runWithOrganization(A, () => sql.row<{ n: number }>(q, [A, ...params])))?.n ?? 0);

  // ── Б1. Незнайдений код категорії → імпорт не починається і називає код ──
  await assert.rejects(
    () => runWithOrganization(A, () => importSnapshotNow(A, IMP)),
    (e: Error) => /категорія «SD»/.test(e.message) && /Імпорт не почато/.test(e.message),
    'імпорт без категорії SD мав відмовити з її кодом',
  );
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?'), 0, 'після відмови довідників зʼявились брони');
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM guests WHERE organization_id = ?'), 0, 'після відмови довідників зʼявились гості');
  assert.strictEqual(await runWithOrganization(A, () => repo.findSnapshot(A, IMP)).then((r) => r?.status), 'extracted', 'відмова довідників змінила стан знімка');
  assert.match((await runWithOrganization(A, () => repo.findSnapshot(A, IMP)))?.error ?? '', /SD/, 'текст відмови не дійшов до рядка знімка');
  console.log('  ok  Б1. категорії «SD» немає в готелі — імпорт не почато, код названо, у ядрі нуль рядків');

  // ── Б2. Довідники сходяться → імпорт: брони, три адреси, суми, умлаути ──
  await runWithOrganization(A, async () => {
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)', [`${A}_sd`, PROP, CAT, 'Suite Deluxe', 'SD']);
    await sql.run('INSERT INTO units (id, property_id, unit_type_id, category_id, name, code) VALUES (?, ?, ?, ?, ?, ?)', [`${A}_u201`, PROP, `${A}_sd`, CAT, '201', '201']);
  });
  const r1 = await runWithOrganization(A, () => importSnapshotNow(A, IMP));
  assert.strictEqual(r1.entities.reservation.imported, 5, `броней імпортовано ${r1.entities.reservation.imported}, стаб має 5 (4 живі + сторно з датою)`);
  assert.strictEqual(r1.entities.reservation.staged, 0, `брони в staging: ${JSON.stringify(r1.entities.reservation)}`);
  // Задача 8 §1.2: компанія — це ADR_WAHL = 1, не DEBI_NR > 0; адреса 6 має дебіторський номер і є гостем.
  assert.strictEqual(r1.entities.guest.imported, 4, `гостей ${r1.entities.guest.imported}, адрес з ADR_WAHL 0 у стабі 4 (одна з DEBI_NR > 0)`);
  assert.strictEqual(r1.entities.company.imported, 1, 'компанія з ADR_WAHL 1 не імпортована');
  // §1.1: рід рядка — з групи через LNR (wg ≠ wgnr у стабі): 5 у фоліо; «Tanken» (750 Ausgaben) і «Gutschein» (700 Geldtransit) — staging cash_article.
  assert.strictEqual(r1.entities.folio_line.imported, 5, `рядків рахунку ${r1.entities.folio_line.imported}, у фоліо гостя мають бути 5 із 7`);
  assert.strictEqual(r1.entities.folio_line.staged, 2, `касові статті (групи 700/750) не в staging: ${JSON.stringify(r1.entities.folio_line)}`);
  // §1.4: історичні оплати йдуть у фоліо повз фіскальну варту з позначкою походження (З34).
  assert.strictEqual(r1.entities.payment.imported, 4, `оплат у фоліо ${r1.entities.payment.imported} — усі 4, включно з готівкою й карткою на DE`);
  assert.strictEqual(r1.entities.payment.staged, 0, `оплат у staging ${r1.entities.payment.staged} — фіскальна варта не має зупиняти імпорт`);
  // §1.3: послуга без пари в каталозі — не відмова, а рядок у explained; «Frühstück - Speisen» ↔ «Frühstück – Speisen» — пара.
  const unmatched = r1.reconcile.explained.find((x) => /послуг/.test(x.name));
  assert.ok(unmatched, 'у explained немає рядка про послуги без пари');
  assert.strictEqual(unmatched!.winhotel, 1, `послуг без пари ${unmatched!.winhotel}: чекали лише «Haustier» — ${unmatched!.why}`);
  assert.match(unmatched!.why, /Haustier/, `перелік без назви: ${unmatched!.why}`);
  assert.doesNotMatch(unmatched!.why, /Speisen/, `«Frühstück - Speisen» мала знайти пару через нормалізацію: ${unmatched!.why}`);
  assert.strictEqual(r1.entities.invoice.staged, 3, 'фактури не всі в staging');
  assert.strictEqual(r1.mismatch, false, `розбіжність у числах, що мусять зійтись: ${JSON.stringify(r1.reconcile.mustMatch.filter((m) => !m.ok))}`);
  const res101 = await runWithOrganization(A, () => sql.row<any>(
    `SELECT r.id, r.check_in, r.check_out, r.status, r.total_price, r.adults, r.children, r.internal_notes, r.deposit_amount, r.unit_id, r.payment_status, u.code AS unit_code
       FROM reservations r LEFT JOIN units u ON u.id = r.unit_id WHERE r.organization_id = ? AND r.external_uid = ?`, [A, 'winhotel:GASTKONT:101']));
  assert.ok(res101, 'майбутньої броні 101 немає');
  assert.strictEqual(String(res101.check_in).slice(0, 10), '2027-03-10');
  assert.strictEqual(res101.unit_code, '102', 'бронь 101 не на номері 102');
  assert.strictEqual(Number(res101.total_price), 423, `total_price 141.000 × 3 → ${res101.total_price}`);
  assert.strictEqual(Number(res101.deposit_amount), 50, 'депозит 50.000 не дійшов');
  assert.strictEqual(res101.status, 'confirmed');
  assert.match(String(res101.internal_notes), /Späte Anreise/, `умлаут у примітці: ${res101.internal_notes}`);
  const rg = await runWithOrganization(A, () => sql.rows<any>('SELECT first_name, last_name, guest_id FROM reservation_guests WHERE reservation_id = ? ORDER BY last_name', [res101.id]));
  assert.strictEqual(rg.length, 3, `три адреси броні 101 дали ${rg.length} reservation_guests`);
  assert.ok(rg.every((g) => g.guest_id), 'reservation_guests без guest_id');
  assert.ok(rg.some((g) => g.last_name === 'Müller-Stub'), `умлаут у гості: ${rg.map((g) => g.last_name).join(', ')}`);
  const res102 = await runWithOrganization(A, () => sql.row<any>('SELECT payment_status, status, unit_id FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:102']));
  assert.strictEqual(res102?.status, 'checked_out');
  assert.strictEqual(res102?.payment_status, 'paid', `оплата 102: у фоліо 179 + 48 + 8 = 235 (Gutschein-рядок — каса), оплат 227 + 100 − 1.5 = 325.5 → paid, а є ${res102?.payment_status}`);
  const res104 = await runWithOrganization(A, () => sql.row<any>('SELECT status FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:104']));
  assert.strictEqual(res104?.status, 'cancelled', 'сторнована з датою 104 не cancelled');
  const res106 = await runWithOrganization(A, () => sql.row<any>('SELECT unit_id, unit_type_id, source FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:106']));
  assert.strictEqual(res106?.unit_id, null, 'бронь на псевдо-номері 9999 дістала номер');
  assert.strictEqual(res106?.unit_type_id, `${A}_dzd`);
  // Джерело — з GASTKREF.EXT_SOURCE («Booking.com» у стабі), не з MARKSEG (задача 8 §2).
  assert.strictEqual(res106?.source, 'booking_com', `джерело броні 106: ${res106?.source}, чекали booking_com з GASTKREF.EXT_SOURCE`);
  assert.strictEqual(res101.status === 'confirmed' && (await runWithOrganization(A, () => sql.row<any>('SELECT source FROM reservations WHERE id = ?', [res101.id])))?.source, 'direct', 'бронь без GASTKREF має бути direct');
  assert.strictEqual(await countA("SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND external_uid = 'winhotel:GASTKONT:105'"), 0, 'видалена без дати сторно 105 імпортована');
  const snap = await runWithOrganization(A, () => repo.findSnapshot(A, IMP));
  assert.strictEqual(snap?.status, 'imported');
  assert.ok(snap?.imported_at, 'imported_at порожній');
  const importCounts = JSON.parse(snap?.counts_json ?? '{}') as { import?: { mismatch: boolean; entities: Record<string, { imported: number }> } };
  assert.strictEqual(importCounts.import?.mismatch, false);
  assert.strictEqual(importCounts.import?.entities.reservation.imported, 5, 'counts_json без чисел імпорту');
  const staged = await runWithOrganization(A, () => sql.rows<{ entity: string; reason: string; n: number }>('SELECT entity, reason, COUNT(*) AS n FROM winhotel_staging WHERE organization_id = ? GROUP BY entity, reason', [A]));
  const stagedOf = (e: string, r: string) => Number(staged.find((x) => x.entity === e && x.reason === r)?.n ?? 0);
  assert.strictEqual(stagedOf('invoice', 'frozen_sammelrechnung'), 1, `Sammelrechnung у staging: ${JSON.stringify(staged)}`);
  assert.strictEqual(stagedOf('invoice', 'frozen'), 2);
  assert.strictEqual(stagedOf('payment', 'fiscal_guard'), 0, 'fiscal_guard більше не причина (З34)');
  assert.strictEqual(stagedOf('folio_line', 'cash_article'), 2, `«Tanken» (750) і «Gutschein» (700) не в staging cash_article: ${JSON.stringify(staged)}`);
  // §1.2: DEBI_NR фірми — це її номер дебітора (`companies.debtor_no` прийшов із гілки робіт, 0140):
  // приймається дверима `adoptDebtorNo`, staging `debtor_no_pending` — лише коли номер зайнятий.
  assert.strictEqual(stagedOf('company', 'debtor_no_pending'), 0, `DEBI_NR мав лягти в companies.debtor_no, а не в staging: ${JSON.stringify(staged)}`);
  const { companyPayer: payerOf } = await import('@companies/kernel');
  const firmRef = await runWithOrganization(A, () => refsRepo.findRef(A, 'company', 3));
  assert.ok(firmRef, 'ref компанії 3 немає');
  const firmPayer = await runWithOrganization(A, () => payerOf(A, firmRef!.our_id));
  assert.strictEqual(firmPayer?.payer_debtor_no, '10001', `номер дебітора фірми: ${firmPayer?.payer_debtor_no}, чекали DEBI_NR 10001 з Winhotel`);
  // Рід рядків фоліо — з групи: Logis → lodging, Kurtaxe (600) → city_tax, Frühstück (200) → service.
  const kinds = await runWithOrganization(A, () => sql.rows<{ kind: string; n: number }>(
    'SELECT kind, COUNT(*) AS n FROM fin_folio_items WHERE organization_id = ? GROUP BY kind ORDER BY kind', [A]));
  const kindOf = (k: string) => Number(kinds.find((x) => x.kind === k)?.n ?? 0);
  assert.strictEqual(kindOf('lodging'), 3, `lodging ${kindOf('lodging')} (чекали 3: ÜF, Logis, Logis Firmen) — ${JSON.stringify(kinds)}`);
  assert.strictEqual(kindOf('city_tax'), 1, `city_tax ${kindOf('city_tax')} (чекали Kurtaxe) — ${JSON.stringify(kinds)}`);
  assert.strictEqual(kindOf('service'), 1, `service ${kindOf('service')} (чекали лише Frühstück; Gutschein — каса) — ${JSON.stringify(kinds)}`);
  // Оплати — дверима фасаду (`listPayments`), не SQL до таблиці модуля (check-boundaries).
  const { listPayments, ensureReservationFolio: folioOf } = await import('@invoicing/kernel');
  const pays = (await runWithOrganization(A, async () => {
    const out: Array<{ method: string; source: string | null; origin: string | null; tse_status?: string | null }> = [];
    for (const uid of ['winhotel:GASTKONT:101', 'winhotel:GASTKONT:102']) {
      const r = await sql.row<{ id: string }>('SELECT id FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, uid]);
      out.push(...(await listPayments(await folioOf(String(r!.id)))) as any[]);
    }
    return out;
  }));
  assert.strictEqual(pays.length, 4, `оплат у фоліо ${pays.length}`);
  assert.ok(pays.every((x) => x.source === 'import' && /^winhotel:\d+$/.test(String(x.origin))), `імпортна оплата без позначки походження: ${JSON.stringify(pays)}`);
  assert.ok(pays.some((x) => x.method === 'cash') && pays.some((x) => x.method === 'card_terminal'), `готівка й картка мали дійти: ${JSON.stringify(pays)}`);
  assert.ok(pays.every((x) => x.tse_status === null), `імпортна оплата не підписується і не «tse_failed»: ${JSON.stringify(pays)}`);
  console.log('  ok  Б2. імпорт: 5 броней, 4 гості + 1 фірма за ADR_WAHL, рід рядків із групи через LNR, каса → staging, оплати з походженням повз варту, послуга без пари — у explained, джерело з GASTKREF');

  // ── Б3. Той самий знімок удруге → нуль нових рядків у ядрі й у refs ──────
  const refsBefore = await countA('SELECT COUNT(*) AS n FROM winhotel_refs WHERE organization_id = ?');
  const resBefore = await countA('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?');
  const guestsBefore = await countA('SELECT COUNT(*) AS n FROM guests WHERE organization_id = ?');
  const r2 = await runWithOrganization(A, () => importSnapshotNow(A, IMP));
  assert.strictEqual(r2.entities.reservation.imported + r2.entities.reservation.updated, 0, `повтор: ${JSON.stringify(r2.entities.reservation)}`);
  assert.strictEqual(r2.entities.folio_line.imported + r2.entities.folio_line.staged, 0, `повтор рядків: ${JSON.stringify(r2.entities.folio_line)}`);
  assert.strictEqual(r2.entities.payment.imported, 0);
  assert.strictEqual(r2.entities.guest.imported + r2.entities.guest.updated, 0, `повтор гостей: ${JSON.stringify(r2.entities.guest)}`);
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM winhotel_refs WHERE organization_id = ?'), refsBefore, 'повтор додав refs');
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?'), resBefore, 'повтор додав брони');
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM guests WHERE organization_id = ?'), guestsBefore, 'повтор додав гостей');
  assert.strictEqual(r2.mismatch, false);
  console.log('  ok  Б3. той самий знімок двічі — нуль нових рядків у ядрі й у refs, звірка сходиться');

  // ── Б4. Новіший знімок: нова дата виїзду → одна бронь, нова дата ─────────
  const bookingsFile = path.join(pi.out, 'bookings.jsonl');
  const original = fs.readFileSync(bookingsFile, 'utf8');
  fs.writeFileSync(bookingsFile, original.split('\n').map((l) => (l.includes('"lnr":101,') ? l.replace('"bisaufh":"2027-03-13"', '"bisaufh":"2027-03-14"').replace('"auftage":3', '"auftage":4') : l)).join('\n'));
  const r3 = await runWithOrganization(A, () => importSnapshotNow(A, IMP));
  assert.strictEqual(r3.entities.reservation.updated, 1, `оновлено ${r3.entities.reservation.updated} броней, чекали 1`);
  assert.strictEqual(r3.entities.reservation.imported, 0);
  const moved = await runWithOrganization(A, () => sql.row<any>('SELECT check_out, nights FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:101']));
  assert.strictEqual(String(moved.check_out).slice(0, 10), '2027-03-14', 'нова дата виїзду не дійшла');
  assert.strictEqual(Number(moved.nights), 4);
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?'), resBefore, 'оновлення зробило другу бронь');
  console.log('  ok  Б4. повторний імпорт з новою датою виїзду — одна бронь, нова дата');

  // ── Б5. Видалене у Winhotel після імпорту → cancelled, не DELETE ─────────
  fs.writeFileSync(bookingsFile, original.split('\n').filter((l) => !l.includes('"lnr":102,')).join('\n'));
  const r4 = await runWithOrganization(A, () => importSnapshotNow(A, IMP));
  assert.strictEqual(r4.entities.reservation.skipped.cancelled_missing_in_snapshot, 1, `зникла бронь: ${JSON.stringify(r4.entities.reservation.skipped)}`);
  const gone = await runWithOrganization(A, () => sql.row<any>('SELECT status FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:102']));
  assert.strictEqual(gone?.status, 'cancelled', 'бронь, якої немає в новому знімку, не cancelled');
  assert.strictEqual(await countA('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?'), resBefore, 'зникла бронь видалена, а не скасована');
  fs.writeFileSync(bookingsFile, original);
  console.log('  ok  Б5. бронь, якої в новому знімку немає, — cancelled, рядок лишається');

  // ── Б6. Гість організації A невидимий через refs і таблиці з B ───────────
  const refB = await runWithOrganization(B, () => findRefB(B));
  assert.strictEqual(refB, undefined, 'B знайшла ref адреси A');
  assert.strictEqual(Number((await runWithOrganization(B, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM guests WHERE organization_id = ?', [B])))?.n), 0, 'у B зʼявились гості A');
  if (isPg) {
    const seen = await runWithOrganization(B, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM winhotel_refs'));
    assert.strictEqual(Number(seen?.n), 0, 'політика winhotel_refs не тримає: B бачить refs A голим запитом');
    const seenStaging = await runWithOrganization(B, () => sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM winhotel_staging'));
    assert.strictEqual(Number(seenStaging?.n), 0, 'політика winhotel_staging не тримає');
  }
  console.log(`  ok  Б6. гість A через refs і таблиці з B невидимий${isPg ? ' — і політикою теж' : ' (політика — у check:pg)'}`);

  // ══ Задача 8 §3 — кіоск: незатирання і денна дельта ═══════════════════════
  const { recordReservationPayment, ensureReservationFolio } = await import('@invoicing/kernel');
  const resA101 = await runWithOrganization(A, () => sql.row<any>('SELECT id, status FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:101']));
  assert.ok(resA101, 'бронь 101 має бути в ядрі перед сценами кіоска');
  const rgCount = () => countA("SELECT COUNT(*) AS n FROM reservation_guests WHERE reservation_id = (SELECT id FROM reservations WHERE organization_id = ? AND external_uid = 'winhotel:GASTKONT:101')");

  // ── Б7. Кіоск заселив → повторний імпорт того ж знімка (CI_STATUS 0) нічого не затирає ──
  await runWithOrganization(A, async () => {
    await sql.run("UPDATE reservations SET status = 'checked_in', registration_status = 'registered' WHERE id = ? AND organization_id = ?", [resA101.id, A]);
    await sql.run(
      `INSERT INTO reservation_guests (id, reservation_id, first_name, last_name, date_of_birth, nationality, document_number, guest_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [`${A}_kiosk_rg`, resA101.id, 'Kiosk', 'Gast', null, null, null, null]);
    await ensureReservationFolio(resA101.id);
    await recordReservationPayment({ reservationId: resA101.id, amount: 50, method: 'transfer' });
  });
  const rgBefore = await rgCount();
  const folio101 = await runWithOrganization(A, () => ensureReservationFolio(resA101.id));
  const paysOf101 = () => runWithOrganization(A, async () => (await listPayments(folio101)).map((x: any) => ({ id: x.id, source: x.source ?? null, origin: x.origin ?? null, amount: Number(x.amount) })));
  const payBefore = await paysOf101();
  // Знімок мусить справді ПИСАТИ бронь (інакше «нічого не затерто» доводить лише
  // «нічого не робилось»): у ньому змінена примітка, а CI_STATUS — 0.
  fs.writeFileSync(bookingsFile, original.replace('"bemerk":"Späte Anreise"', '"bemerk":"Späte Anreise, Zimmer oben"'));
  const r5 = await runWithOrganization(A, () => importSnapshotNow(A, IMP));
  fs.writeFileSync(bookingsFile, original);
  assert.strictEqual(r5.entities.reservation.updated, 1, `бронь 101 мала оновитись (примітка): ${JSON.stringify(r5.entities.reservation)}`);
  assert.match(String((await runWithOrganization(A, () => sql.row<any>('SELECT internal_notes FROM reservations WHERE id = ?', [resA101.id])))?.internal_notes), /Zimmer oben/, 'оновлення примітки не дійшло — UPDATE не було');
  const after101 = await runWithOrganization(A, () => sql.row<any>('SELECT status, registration_status FROM reservations WHERE id = ? AND organization_id = ?', [resA101.id, A]));
  assert.strictEqual(after101?.status, 'checked_in', `кіоск заселив, знімок каже CI_STATUS 0 — стан мав лишитись checked_in, а став ${after101?.status}`);
  assert.strictEqual(after101?.registration_status, 'registered', `registration_status затерто: ${after101?.registration_status}`);
  assert.strictEqual(await rgCount(), rgBefore, 'гостей броні, створених кіоском, стало інакше');
  assert.ok(await runWithOrganization(A, () => sql.row<any>('SELECT id FROM reservation_guests WHERE id = ?', [`${A}_kiosk_rg`])), 'гостя броні від кіоска видалено');
  const payAfter = await paysOf101();
  assert.deepStrictEqual(payAfter, payBefore, 'оплати змінились після повторного імпорту');
  assert.ok(payAfter.some((x: any) => x.source === null && Number(x.amount) === 50), 'оплата рецепції (без source) зникла');
  assert.strictEqual(r5.entities.reservation.skipped.status_kept_forward ?? 0, 1, `стан «лише вперед» мав спрацювати рівно раз: ${JSON.stringify(r5.entities.reservation.skipped)}`);
  console.log('  ok  Б7. кіоск заселив і зареєстрував, рецепція взяла оплату → повторний імпорт із CI_STATUS 0 нічого не затер');

  // ── Б8. Дельта: лише вікно, без скасувань за відсутністю; старіший повний не відкочує ──
  const DELTA = repo.newSnapshotId(new Date('2026-09-13T09:15:00Z'));
  const deltaSha = crypto.createHash('sha256').update('fixture-delta').digest('hex');
  await runWithOrganization(A, () => repo.insertSnapshot({ id: DELTA, organizationId: A, takenAt: '2026-09-13 09:15:00', mode: 'delta', sha256: deltaSha, sizeBytes: 1 }));
  const pd = snapshotPaths(A, DELTA);
  fs.mkdirSync(pd.out, { recursive: true });
  const onlyWindow = (entity: string, keep: (row: any) => boolean) => {
    const src = fs.readFileSync(path.join(FIX, `${entity}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    fs.writeFileSync(path.join(pd.out, `${entity}.jsonl`), src.filter(keep).map((r) => `${JSON.stringify(r)}\n`).join(''));
  };
  for (const dict of ['unit_types', 'units', 'services', 'service_groups', 'tax_codes', 'segments', 'payment_methods']) onlyWindow(dict, () => true);
  // Вікно 2027-03-09..2027-03-13: лише бронь 101; у дельті вона виїжджає на два дні пізніше.
  onlyWindow('bookings', (b) => b.lnr === 101);
  fs.writeFileSync(path.join(pd.out, 'bookings.jsonl'), fs.readFileSync(path.join(pd.out, 'bookings.jsonl'), 'utf8').replace('"bisaufh":"2027-03-13"', '"bisaufh":"2027-03-15"').replace('"auftage":3', '"auftage":5'));
  onlyWindow('addresses', (a) => [1, 2, 5].includes(a.lnr));
  onlyWindow('folio_lines', (l) => l.gk_lnr === 101);
  onlyWindow('payments', (x) => x.lnr_gk === 101);
  onlyWindow('booking_refs', (x) => x.gk_lnr === 101);
  onlyWindow('occupancy', (x) => x.lnr_gk === 101);
  const writeAgg = (window: unknown) => fs.writeFileSync(path.join(pd.out, 'aggregates.json'), JSON.stringify({ snapshot: { id: DELTA, mode: 'delta' }, mode: 'delta', window, entities: { bookings: 1 }, numbers: {} }));
  writeAgg(null);
  fs.writeFileSync(pd.extracted, '{}');
  await runWithOrganization(A, () => repo.syncMarkers(A));
  await assert.rejects(() => runWithOrganization(A, () => importSnapshotNow(A, DELTA)), /без вікна/, 'дельта без вікна мала відмовити');
  writeAgg({ from: '2027-03-09', to: '2027-03-13' });
  const before103 = await runWithOrganization(A, () => sql.row<any>('SELECT status, check_out FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:103']));
  const r6 = await runWithOrganization(A, () => importSnapshotNow(A, DELTA));
  assert.strictEqual(r6.mode, 'delta');
  assert.strictEqual(r6.entities.reservation.updated, 1, `дельта мала оновити рівно одну бронь: ${JSON.stringify(r6.entities.reservation)}`);
  assert.strictEqual(r6.entities.reservation.skipped.cancelled_missing_in_snapshot ?? 0, 0, 'дельта скасувала бронь за відсутністю');
  const moved101 = await runWithOrganization(A, () => sql.row<any>('SELECT check_out, nights, status FROM reservations WHERE id = ?', [resA101.id]));
  assert.strictEqual(String(moved101.check_out).slice(0, 10), '2027-03-15', 'нова дата виїзду з дельти не дійшла');
  assert.strictEqual(moved101.status, 'checked_in', 'дельта затерла стан кіоска');
  const after103 = await runWithOrganization(A, () => sql.row<any>('SELECT status, check_out FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:103']));
  assert.deepStrictEqual(after103, before103, 'бронь поза вікном дельти змінилась');
  assert.strictEqual((r6.entities.invoice?.staged ?? 0) + (r6.entities.balance?.staged ?? 0), 0, 'дельта не несе фактур і сальдо');
  // Повний знімок, узятий РАНІШЕ за дельту, не відкочує її.
  const r7 = await runWithOrganization(A, () => importSnapshotNow(A, IMP));
  assert.strictEqual(r7.entities.reservation.skipped.older_snapshot ?? 0, 1, `старіший повний знімок мав пропустити бронь дельти: ${JSON.stringify(r7.entities.reservation.skipped)}`);
  const kept101 = await runWithOrganization(A, () => sql.row<any>('SELECT check_out FROM reservations WHERE id = ?', [resA101.id]));
  assert.strictEqual(String(kept101.check_out).slice(0, 10), '2027-03-15', 'повний імпорт після дельти відкотив дату виїзду');
  // Приймання: дельта без заголовка вікна → 400, і рядка немає.
  const deltaBody = zlib.gzipSync(Buffer.from('bookings\n'));
  const deltaSha2 = crypto.createHash('sha256').update(deltaBody).digest('hex');
  let dres = await post(good(tokenA, { 'x-winhotel-sha256': deltaSha2, 'x-winhotel-mode': 'delta' }), deltaBody);
  assert.strictEqual(dres.status, 400, `дельта без X-Winhotel-Window: очікували 400, отримали ${dres.status}`);
  assert.match((await dres.json()).error ?? '', /вікна/);
  assert.ok(!(await rowsOf(A)).some((r) => r.sha256 === deltaSha2), 'дельта без вікна лишила рядок');
  dres = await post(good(tokenA, { 'x-winhotel-sha256': deltaSha2, 'x-winhotel-mode': 'delta', 'x-winhotel-window': '2026-09-12..2026-09-16' }), deltaBody);
  assert.strictEqual(dres.status, 201, `дельта з вікном: очікували 201, отримали ${dres.status} ${await dres.text()}`);
  const deltaRow = (await rowsOf(A)).find((r) => r.sha256 === deltaSha2)!;
  assert.strictEqual(deltaRow.mode, 'delta');
  assert.ok(fs.existsSync(snapshotPaths(A, deltaRow.id).deltaArchive), 'дельта не лягла як .delta.gz');
  assert.match(fs.readFileSync(snapshotPaths(A, deltaRow.id).ready, 'utf8'), /"window":\{"from":"2026-09-12","to":"2026-09-16"\}/);
  // Друга дельта того ж дня — не «один на добу»: приймається.
  const deltaBody3 = zlib.gzipSync(Buffer.from('bookings\n\n'));
  dres = await post(good(tokenA, { 'x-winhotel-sha256': crypto.createHash('sha256').update(deltaBody3).digest('hex'), 'x-winhotel-mode': 'delta', 'x-winhotel-window': '2026-09-12..2026-09-16' }), deltaBody3);
  assert.strictEqual(dres.status, 201, `друга дельта за добу: очікували 201, отримали ${dres.status}`);
  console.log('  ok  Б8. дельта: без вікна — відмова в імпорті й 400 на прийомі; оновлює лише бронь у вікні, не скасовує поза ним; старіший повний знімок її не відкочує; дельти не рахуються «один на добу»');

  // ── Б9. Шаблони дельти агента = SQL мосту по колонках; живий isql зі стаба → пакет → jsonl ──
  const DELTA_SQL = path.join(ROOT, 'apps/winhotel-agent/sql-delta');
  const GS = Buffer.from([0x1d]);
  for (const f of fs.readdirSync(DELTA_SQL).filter((x) => x.endsWith('.sql'))) {
    const full = fs.readFileSync(path.join(SQL_DIR, f), 'utf8');
    const mine = fs.readFileSync(path.join(DELTA_SQL, f), 'utf8');
    const cols = (t: string) => (t.match(/^--\s*columns:\s*(.+)$/m) ?? [])[1];
    assert.strictEqual(cols(mine), cols(full), `${f}: колонки шаблону дельти розійшлися з SQL мосту — міст розбере вивід не так`);
    assert.ok(/\{\{FROM\}\}/.test(mine) || /^--.*довідник/m.test(mine), `${f}: ні вікна {{FROM}}, ні позначки довідника`);
  }
  if (FIREBIRD) {
    const { processDelta } = await import('../../../deploy/bridge/lib/extract.mjs');
    const wdir = path.join(tmp, 'delta-live');
    fs.mkdirSync(wdir, { recursive: true });
    const env = { ...process.env, FIREBIRD_LOCK: wdir, FIREBIRD_TMP: wdir };
    const fdb = path.join(wdir, 'stub.fdb');
    fs.writeFileSync(path.join(wdir, 'stub.sql'), fs.readFileSync(path.join(ROOT, 'apps/winhotel-import/fixture/stub-db.sql'), 'utf8').replace('__DB__', fdb));
    execFileSync('isql-fb', ['-q', '-b', '-user', 'SYSDBA', '-charset', 'NONE', '-i', path.join(wdir, 'stub.sql')], { env, stdio: 'pipe' });
    const parts: Buffer[] = [];
    for (const f of fs.readdirSync(DELTA_SQL).filter((x) => x.endsWith('.sql')).sort()) {
      const entity = f.slice(0, -4);
      const script = path.join(wdir, f);
      fs.writeFileSync(script, fs.readFileSync(path.join(DELTA_SQL, f), 'utf8').replace(/\{\{FROM\}\}/g, '2027-03-09').replace(/\{\{TO\}\}/g, '2027-03-13'));
      const outBytes = execFileSync('isql-fb', ['-q', '-b', '-user', 'SYSDBA', '-charset', 'NONE', '-i', script, fdb], { env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      parts.push(GS, Buffer.from(`${entity}\n`, 'latin1'), outBytes);
    }
    const bundle = path.join(wdir, 'delta.bin.gz');
    fs.writeFileSync(bundle, zlib.gzipSync(Buffer.concat(parts)));
    const live = await processDelta({ archive: bundle, sqlDir: SQL_DIR, outDir: path.join(wdir, 'out'), window: { from: '2027-03-09', to: '2027-03-13' }, snapshot: { id: 'live', mode: 'delta' } }) as { entities: Record<string, number> };
    assert.strictEqual(live.entities.bookings, 1, `у вікні одна бронь (101), отримали ${live.entities.bookings}`);
    assert.strictEqual(live.entities.addresses, 3, `три адреси броні 101, отримали ${live.entities.addresses}`);
    assert.strictEqual(live.entities.folio_lines, 1);
    assert.strictEqual(live.entities.payments, 1);
    assert.strictEqual(live.entities.services, 10, 'довідник послуг у дельті має бути цілим');
    const liveB = JSON.parse(fs.readFileSync(path.join(wdir, 'out', 'bookings.jsonl'), 'utf8').trim());
    assert.strictEqual(liveB.lnr, 101);
    assert.strictEqual(liveB.bemerk, 'Späte Anreise', `умлаут у дельті: ${liveB.bemerk}`);
    await assert.rejects(() => processDelta({ archive: bundle, sqlDir: SQL_DIR, outDir: path.join(wdir, 'out2'), window: null, snapshot: null }), /без вікна/);
    console.log('  ok  Б9. шаблони дельти = SQL мосту по колонках; живий isql зі стаба у вікні 03-09..03-13 → пакет → 1 бронь, 3 адреси, 1 рядок, 1 оплата, довідники цілі');
  } else {
    console.log('  ok  Б9. шаблони дельти = SQL мосту по колонках; ПРОПУЩЕНО живий isql (немає Firebird) — пакет дельти перевіряється локально і в проході контролера');
  }

  console.log('  ok  winhotel-import: знімок доходить лише зі своїм токеном, лягає під орендаря і витягається');
} finally {
  await cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
}
