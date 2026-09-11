/**
 * VIP — це КОЛОНКА, а не слово в примітках; блокування називає причину.
 *
 *   node src/modules/guests/data/guest-flags.check.ts
 *
 * ── Дефект, проти якого це написано ─────────────────────────────────────
 *
 * Екран гостей виводив корону з підрядка: `notes.toLowerCase().includes('vip')`.
 * Ознака, виведена з вільного тексту, залежить не від рішення готелю, а від
 * того, як портьє сформулював речення — і помиляється в ОБИДВА боки.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. Гість із прапорцем і ПОРОЖНІМИ примітками — проти гостя БЕЗ прапорця,
 *    у чиїх примітках слово «VIP» Є («VIP-паркінг НЕ входить»). Це рівно та
 *    пара, на якій старе прочитання й нове дають ПРОТИЛЕЖНІ відповіді; з
 *    одним гостем твердження зелене й на підрядку.
 * 2. Заблокований проти незаблокованого — інакше «блокування видно» істинне
 *    й на читачі, який завжди каже «так».
 * 3. Два готелі: гість сусіда не блокується й не отримує корони.
 *
 * ── І окремо: поля НЕ ГУБЛЯТЬСЯ по дорозі ───────────────────────────────
 *
 * `updateGuest` збирає зміни мапою, і ключ, якого в мапі немає, МОВЧКИ
 * зникає: форма каже «збережено», колонка лишається старою. Той самий клас,
 * що `property_type: ''` у `property-lodging-kind.check`. Тому тут є прохід
 * «записали → прочитали назад» по кожному новому текстовому полю.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-guest-flags-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { setVip, blacklistGuest, unblacklistGuest } = await import('./guest-flags.repo.ts');
const { createGuest, updateGuest } = await import('./guests.repo.ts');
const { isRefusal } = await import('@core/http/refusal.ts');

const sql = getSql();
const ORG = '__gf__org';
const NEIGHBOUR = '__gf__neighbour';

// Прибирання ПЕРЕД засівом — на Postgres база спільна на весь `check:pg`.
for (const org of [ORG, NEIGHBOUR]) {
  await runWithOrganization(org, () => sql.run("DELETE FROM guests WHERE organization_id = ?", [org]));
  await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
}
for (const org of [ORG, NEIGHBOUR]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
}

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

let CROWNED = '';
let NOTED = '';
let ALIEN = '';

await runWithOrganization(ORG, async () => {
  // Справжній VIP — і в примітках про це НІ СЛОВА.
  CROWNED = await createGuest(ORG, { firstName: 'Олена', lastName: 'Корона' } as never);
  // Не VIP — а слово «VIP» у примітках Є, і саме в запереченні.
  NOTED = await createGuest(ORG, {
    firstName: 'Богдан', lastName: 'Примітка', notes: 'VIP-паркінг НЕ входить у тариф',
  } as never);
});
await runWithOrganization(NEIGHBOUR, async () => {
  ALIEN = await createGuest(NEIGHBOUR, { firstName: 'Сусід', lastName: 'Сусідов' } as never);
});

const vipOf = (org: string, id: string) => runWithOrganization(org, async () => {
  const row = await sql.row<{ is_vip: unknown }>(
    'SELECT is_vip FROM guests WHERE id = ? AND organization_id = ?', [id, org]);
  return row?.is_vip === true || Number(row?.is_vip) === 1;
});

await runWithOrganization(ORG, async () => {
  // ── 1. Прапорець ставиться і ЗНІМАЄТЬСЯ ────────────────────────────────
  say(!(await vipOf(ORG, CROWNED)), 'новий гість не VIP за замовчуванням');
  say(await setVip(ORG, CROWNED, true), 'VIP поставлено');
  say(await vipOf(ORG, CROWNED), 'і прапорець справді стоїть');

  // Зняття — окреме твердження: `false || null` у мапі полів записало б NULL
  // у NOT NULL колонку, і саме тому писач окремий.
  say(await setVip(ORG, CROWNED, false), 'VIP знято');
  say(!(await vipOf(ORG, CROWNED)), 'і прапорець справді знято, а не записано NULL');
  await setVip(ORG, CROWNED, true);

  // ── 2. Слово в примітках НЕ робить VIP-ом ──────────────────────────────
  //
  // Це і є та пара, заради якої колонка заводилась: старе прочитання дало б
  // ПРОТИЛЕЖНІ відповіді на обох рядках.
  say(!(await vipOf(ORG, NOTED)),
    'гість із приміткою «VIP-паркінг НЕ входить» — НЕ VIP');
  const noted = await sql.row<any>('SELECT notes FROM guests WHERE id = ?', [NOTED]);
  say(String(noted?.notes ?? '').toLowerCase().includes('vip'),
    'а слово «vip» у його примітках справді є — інакше твердження вище порожнє');

  // ── 3. Блокування називає причину ──────────────────────────────────────
  let refused = false; let status = 0;
  for (const empty of ['', '   ']) {
    try {
      await blacklistGuest({ organizationId: ORG, guestId: NOTED, reason: empty, by: 'u1' });
    } catch (e) { refused = true; status = isRefusal(e) ? (e as { status: number }).status : 0; }
  }
  say(refused && status === 400, `блокування без причини — названа відмова (${status})`);
  const stillClean = await sql.row<any>('SELECT blacklisted_at FROM guests WHERE id = ?', [NOTED]);
  say(!stillClean?.blacklisted_at, 'і відмова НІЧОГО не записала');

  say(await blacklistGuest({ organizationId: ORG, guestId: NOTED, reason: 'Пошкодив номер', by: 'u1' }),
    'блокування з причиною прийнято');
  const blocked = await sql.row<any>(
    'SELECT blacklisted_at, blacklisted_by, blacklist_reason FROM guests WHERE id = ?', [NOTED]);
  say(!!blocked?.blacklisted_at && blocked?.blacklisted_by === 'u1' && blocked?.blacklist_reason === 'Пошкодив номер',
    `три колонки їдуть разом (${blocked?.blacklisted_by} / ${blocked?.blacklist_reason})`);

  // Сусідній рядок не ворухнувся — інакше «заблокований» нічого не звужує.
  const other = await sql.row<any>('SELECT blacklisted_at FROM guests WHERE id = ?', [CROWNED]);
  say(!other?.blacklisted_at, 'інший гість готелю не заблокований заодно');

  // ── 4. Зняття чистить ВСІ ТРИ ──────────────────────────────────────────
  say(await unblacklistGuest(ORG, NOTED), 'блокування знято');
  const cleared = await sql.row<any>(
    'SELECT blacklisted_at, blacklisted_by, blacklist_reason FROM guests WHERE id = ?', [NOTED]);
  say(!cleared?.blacklisted_at && !cleared?.blacklisted_by && !cleared?.blacklist_reason,
    `жодного сліду не лишилось (${cleared?.blacklist_reason ?? 'порожньо'})`);

  // ── 5. Нові ТЕКСТОВІ поля доїжджають через `updateGuest` ───────────────
  //
  // Ключ, якого немає в мапі полів, зникає МОВЧКИ — екран каже «збережено».
  await updateGuest(ORG, CROWNED, {
    salutation: 'пані', middleName: 'Петрівна', vehiclePlate: 'AA1234BB',
  });
  const back = await sql.row<any>('SELECT salutation, middle_name, vehicle_plate FROM guests WHERE id = ?', [CROWNED]);
  say(back?.salutation === 'пані', `звернення записалось (${back?.salutation ?? 'зникло'})`);
  say(back?.middle_name === 'Петрівна', `по-батькові записалось (${back?.middle_name ?? 'зникло'})`);
  say(back?.vehicle_plate === 'AA1234BB', `номер авто записався (${back?.vehicle_plate ?? 'зник'})`);
});

// ── 6. Вісь орендаря ──────────────────────────────────────────────────────
await runWithOrganization(ORG, async () => {
  say(!(await setVip(ORG, ALIEN, true)), 'гість сусіда не отримує корони з нашого боку');
  say(!(await blacklistGuest({ organizationId: ORG, guestId: ALIEN, reason: 'будь-яка', by: 'u1' })),
    'і не блокується з нашого боку');
});
await runWithOrganization(NEIGHBOUR, async () => {
  const row = await sql.row<any>('SELECT is_vip, blacklisted_at FROM guests WHERE id = ?', [ALIEN]);
  const vip = row?.is_vip === true || Number(row?.is_vip) === 1;
  say(!vip && !row?.blacklisted_at, 'у сусіда його гість як був — без корони й без блокування');
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nguest-flags: ${fails.length} червоних`); process.exit(1); }
console.log('guest-flags: VIP — колонка, не підрядок; блокування називає причину, автора й час і знімається цілком');
