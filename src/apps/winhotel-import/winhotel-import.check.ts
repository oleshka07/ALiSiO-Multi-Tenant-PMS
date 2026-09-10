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
      mandant: 1, tax_codes: 3, unit_types: 3, units: 4, services: 7, service_groups: 4, rate_codes: 3, seasons: 2, prices: 3,
      price_splits: 1, segments: 2, address_types: 2, age_bands: 3, payment_methods: 5, consent_types: 2, addresses: 4,
      bookings: 5, occupancy: 4, booking_refs: 1, folio_lines: 5, invoices: 3, invoice_lines: 3, invoice_ledger: 2,
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
    assert.match(result.numbers.open_guest_balances.value, /^2 283\.5/, `відкриті сальдо: ${result.numbers.open_guest_balances.value}`);
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
    for (const name of ['Frühstück-Speisen', 'Frühstück-Getränke']) {
      await sql.run('INSERT INTO additional_services (id, property_id, name, price) VALUES (?, ?, ?, ?)', [`${A}_svc_${name.length}`, PROP, name, 12]);
    }
    for (const [code, rate] of [['zero', 0], ['reduced', 7], ['standard', 19]] as const) {
      await sql.run('INSERT INTO fin_tax_rates (id, organization_id, property_id, code, rate, valid_from) VALUES (?, ?, ?, ?, ?, ?)', [`${A}_tax_${code}`, A, null, code, rate, '2020-01-01']);
    }
    await sql.run('INSERT INTO booking_sources (id, property_id, name, code) VALUES (?, ?, ?, ?)', [`${A}_src`, PROP, 'Direkt', 'direct']);
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
  assert.strictEqual(r1.entities.guest.imported, 3, `гостей ${r1.entities.guest.imported}, адрес без DEBI_NR у стабі 3 (четверта — компанія)`);
  assert.strictEqual(r1.entities.company.imported, 1, 'компанія з DEBI_NR не імпортована');
  assert.strictEqual(r1.entities.folio_line.imported, 5, `рядків рахунку ${r1.entities.folio_line.imported}, живих у стабі 5`);
  assert.strictEqual(r1.entities.payment.imported, 1, `оплат у фоліо ${r1.entities.payment.imported} — лише ваучер проходить фіскальну варту`);
  assert.strictEqual(r1.entities.payment.staged, 3, `оплат у staging ${r1.entities.payment.staged} — готівка й картка на DE без TSE`);
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
  assert.strictEqual(res102?.payment_status, 'partial', `оплата 102: ваучер 100 з 327 у фоліо → partial, а є ${res102?.payment_status}`);
  const res104 = await runWithOrganization(A, () => sql.row<any>('SELECT status FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:104']));
  assert.strictEqual(res104?.status, 'cancelled', 'сторнована з датою 104 не cancelled');
  const res106 = await runWithOrganization(A, () => sql.row<any>('SELECT unit_id, unit_type_id FROM reservations WHERE organization_id = ? AND external_uid = ?', [A, 'winhotel:GASTKONT:106']));
  assert.strictEqual(res106?.unit_id, null, 'бронь на псевдо-номері 9999 дістала номер');
  assert.strictEqual(res106?.unit_type_id, `${A}_dzd`);
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
  assert.strictEqual(stagedOf('payment', 'fiscal_guard'), 3);
  console.log('  ok  Б2. імпорт: 5 броней, 3 адреси → 3 reservation_guests, 141.000 → 423 за 3 ночі, ÜF/ü у ядрі, Sammelrechnung → staging, готівка DE → staging');

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

  console.log('  ok  winhotel-import: знімок доходить лише зі своїм токеном, лягає під орендаря і витягається');
} finally {
  await cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
}
