/**
 * Фірма й ЇЇ РЕКВІЗИТИ на броні — або обидва, або жодного. Третього не буває.
 *
 *   node src/modules/bookings/api/payer-consistency.check.ts
 *
 * ── Дефект, проти якого це написано ─────────────────────────────────────
 *
 * Платника на картці броні правили ДВА місця, і вони писали різне:
 *
 *   * `PayerPicker` шле `company_id` — сервер сам переписує знімок
 *     `invoice_company_*` із довідника (або чистить його при поверненні до
 *     гостя);
 *   * блок «🏢 На компанію» шле САМІ `invoice_company_*` і `company_id`
 *     не згадує ЖОДНОГО разу.
 *
 * Тобто зняти галочку означало почистити знімок і лишити `company_id`. Бронь
 * після цього має фірму — вона рахується в лічильнику картки фірми й стоїть
 * у списку її гостей (Д74), — а на документі фірми немає. Два екрани про
 * одну бронь кажуть протилежне, і жоден не бреше: вони читають різні колонки.
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 * Не «блок правильно чистить», а ВЛАСТИВІСТЬ рядка: `company_id` порожній
 * тоді й лише тоді, коли порожній знімок. Стан «фірма є, реквізитів немає»
 * не досяжний ЖОДНИМ зі шляхів — тому обидва й перевіряються тут поруч.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. Обидва шляхи: вибір із довідника І пряма правка знімка. З одним
 *    твердження зелене й на коді, де другий писач лишився як був.
 * 2. Обидва напрямки: поставити фірму і ЗНЯТИ її. Дефект був саме на знятті.
 * 3. Правка знімка ПОВЕРХ обраної фірми — законна (разова адреса на
 *    документі) і НЕ мусить знімати фірму: інакше лікування гірше за хворобу.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-payer-consistency-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { createCompanyForTests } = await import('@companies/kernel.ts');
const { updateReservationHandler } = await import('./reservation.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const RES = fx.a.reservationIds[0];

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

let CO = '';
await runWithOrganization(ORG, async () => {
  CO = await createCompanyForTests(ORG, {
    name: 'Фірма-платник', business_id: '77770000', vat_id: 'CZ77770000',
    address_street: 'Вулиця 1', address_zip: '10000', address_city: 'Місто',
    address_country: 'CZ', email: 'pay@example.test',
  });
});

const actor = { organizationId: ORG, user: { id: 'u', permissions: ['manage_bookings'] } } as never;
const patch = (body: Record<string, unknown>) => runWithOrganization(ORG, async () => {
  const res = await updateReservationHandler(
    { json: async () => body, url: `http://local/api/bookings/${RES}` } as never,
    { params: Promise.resolve({ id: RES }) } as never, actor);
  return res.status;
});

/** Стан рядка одним поглядом: чи є фірма і чи є знімок. */
const state = () => runWithOrganization(ORG, async () => {
  const r = await sql.row<any>(
    `SELECT company_id, invoice_company_name, invoice_company_ico, invoice_company_email
       FROM reservations WHERE id = ?`, [RES]);
  return {
    company: r?.company_id ?? null,
    name: r?.invoice_company_name ?? null,
    ico: r?.invoice_company_ico ?? null,
    email: r?.invoice_company_email ?? null,
  };
});

// ── 1. Вибір із довідника ставить ОБИДВА ──────────────────────────────────
say(await patch({ company_id: CO }) === 200, 'фірму обрано з довідника');
let s = await state();
say(s.company === CO && s.name === 'Фірма-платник' && s.ico === '77770000',
  `і фірма, і реквізити на місці (${s.company ? 'фірма' : 'НЕМАЄ'} / ${s.name})`);

// ── 2. Правка знімка ПОВЕРХ фірми — законна, фірму не знімає ──────────────
//
// Разова адреса на документі: фірма та сама, рядок у бланку інший.
say(await patch({ invoice_company_address: 'Інша вулиця 9' }) === 200, 'знімок правиться руками');
s = await state();
say(s.company === CO, 'і фірма при цьому ЛИШАЄТЬСЯ — правка бланка не є зміною платника');

// ── 3. І ГОЛОВНЕ: зняти фірму знімком — стану «фірма без реквізитів» нема ──
//
// Саме так робив блок «🏢 На компанію»: чистив сім колонок знімка й не
// згадував `company_id`.
say(await patch({
  invoice_company_name: null, invoice_company_ico: null, invoice_company_dic: null,
  invoice_company_address: null, invoice_company_city: null, invoice_company_country: null,
  invoice_company_email: null,
}) === 200, 'знімок почищено руками');
s = await state();
say(s.name === null, 'реквізитів справді немає');
say(s.company === null,
  `і фірми теж немає — інакше картка фірми рахує цю бронь, а документ про фірму не знає (${s.company ?? 'порожньо'})`);

// ── 4. Зворотний шлях: `company_id: null` чистить і знімок ────────────────
await patch({ company_id: CO });
say(await patch({ company_id: null }) === 200, 'повернення до платника-гостя');
s = await state();
say(s.company === null && s.name === null && s.email === null,
  `обидва порожні (${s.company ?? 'порожньо'} / ${s.name ?? 'порожньо'})`);

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\npayer-consistency: ${fails.length} червоних`); process.exit(1); }
console.log('payer-consistency: фірма і знімок на броні — або обидва, або жодного; правка бланка платника не змінює');
