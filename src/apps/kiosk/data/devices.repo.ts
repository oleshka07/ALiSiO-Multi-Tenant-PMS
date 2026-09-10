/**
 * Термінали, коди парування і журнал доби — рядки застосунку `kiosk`.
 *
 * ── Парування: код на десять хвилин ─────────────────────────────────────
 *
 * Адмін на картці натискає «Додати термінал», називає його і обирає обʼєкт;
 * система показує ШЕСТИЗНАЧНИЙ код (§3.1). На терміналі цей код набирають
 * пальцем, і у відповідь термінал дістає довгий токен.
 *
 * Шість цифр — це мільйон значень, тобто сам код слабкий, і робить його
 * достатнім не довжина, а три речі разом:
 *
 *   строк         — 10 хвилин, після чого рядок мертвий;
 *   одноразовість — `used_at`; другий раз той самий код не парує нічого;
 *   ліміт частоти — на приймальному маршруті, `checkRateLimit` на IP.
 *
 * Прибрати будь-яку з трьох — і код стає підбірним. Тому вони не «на всяк
 * випадок»: без них шестизначного коду тут не було б.
 *
 * У базі лежить `sha256(код)`, не код. Дамп бази не парує нічого — і саме
 * хеш є тією перепусткою, яка відчиняє рядок приймальному маршруту
 * (інваріант 14, `PUBLIC_TOKEN_READ`): він не «схожий на секрет», він і є
 * секрет, тож звіряти його може сама політика.
 *
 * ── Чому `organization_id` названий у КОЖНОМУ запиті ────────────────────
 *
 * Інваріант 12 і AGENTS §7: на Postgres це зробила б політика, на SQLite
 * політик немає, а SQLite стоїть на кожній машині розробника й у завданні
 * `live`. Обидва двигуни мусять відмовляти однаково — інакше дірку побачить
 * лише прод.
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { runWithPublicToken } from '@core/auth/tenant-context';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';

/** §3.1: код живе десять хвилин. */
export const PAIRING_TTL_MINUTES = 10;

const CODE = /^[0-9]{6}$/;

export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export interface DeviceRow {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  paired_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  config_json: string | null;
}

/**
 * Завести код парування для НОВОГО термінала. Під контекстом орендаря.
 *
 * Рядок пристрою тут ще не створюється: пристрій зʼявляється тоді, коли
 * хтось справді набрав код. Інакше картка застосунку заростала б
 * терміналами, яких ніхто не вмикав, і «останній звʼязок — ніколи» стало б
 * звичайним станом, у якому справжня поломка непомітна.
 *
 * Повертає код — його показують ОДИН раз.
 */
export async function createPairing(input: {
  organizationId: string;
  propertyId: string;
  name: string;
}): Promise<{ code: string; pairingId: string; expiresAt: string }> {
  // `randomInt`, а не `Math.random()`: код — перепустка, і генератор для
  // нього мусить бути криптографічним, навіть коли значень усього мільйон.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const pairingId = newId('kp');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString();
  await getSql().run(`
    INSERT INTO kiosk_pairings (id, organization_id, property_id, name, code_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [pairingId, input.organizationId, input.propertyId, input.name, hashCode(code), expiresAt]);
  return { code, pairingId, expiresAt };
}

export interface PairingRow {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  expires_at: string;
  used_at: string | null;
}

/**
 * Знайти незужитий і нестрочений код — ще НЕ знаючи орендаря.
 *
 * Перепустка ставиться на ЗʼЄДНАННЯ (`runWithPublicToken`), політика звіряє
 * її сама, і вікно завширшки в один запит: прочитавши рядок, викликач знає
 * організацію і далі йде звичайним `runWithOrganization` (інваріант 14).
 *
 * Строк і зужитість перевіряються ТУТ, у тому самому запиті, а не після
 * нього: «знайшов рядок, потім подивився дату» — це два кроки, між якими
 * стоїть код, а отже й місце, де хтось колись забуде другий.
 */
export async function pairingByCode(code: string): Promise<PairingRow | null> {
  if (!CODE.test(code)) return null;
  const token = hashCode(code);
  const now = new Date().toISOString();
  const row = await runWithPublicToken(token, () =>
    getSql().row<PairingRow>(`
      SELECT id, organization_id, property_id, name, expires_at, used_at
        FROM kiosk_pairings
       WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
    `, [token, now]));
  return row ?? null;
}

/**
 * Обміняти код на пристрій: рядок термінала + позначка «код зужито».
 *
 * Однією транзакцією, і позначка йде УМОВНО (`used_at IS NULL`): два
 * термінали, які набрали той самий код одночасно, дають одного пристрою, а
 * не двох. Без цієї умови другий отримав би власний токен на той самий код.
 */
export async function redeemPairing(pairing: PairingRow): Promise<{ deviceId: string } | null> {
  const sql = getSql();
  const deviceId = newId('kd');
  const now = new Date().toISOString();
  let won = false;
  await sql.tx(async (t) => {
    const claimed = await t.run(
      'UPDATE kiosk_pairings SET used_at = ?, device_id = ? WHERE id = ? AND organization_id = ? AND used_at IS NULL',
      [now, deviceId, pairing.id, pairing.organization_id]);
    if (claimed.changes === 0) return;
    won = true;
    // `token_hash` порожній рядок навмисно: справжній секрет ставить
    // `issueDeviceToken` наступним кроком, і до того моменту пристрій не
    // відповідає нікому — порожній хеш не збігається з жодним sha256.
    await t.run(`
      INSERT INTO kiosk_devices (id, organization_id, property_id, name, token_hash)
      VALUES (?, ?, ?, ?, '')
    `, [deviceId, pairing.organization_id, pairing.property_id, pairing.name]);
  });
  return won ? { deviceId } : null;
}

/**
 * Термінали — для картки застосунку.
 *
 * Область приходить ТИПОМ (`PropertyScope`), а не необовʼязковим рядком.
 * Перша редакція мала `propertyId?: string | null` і склеювала `WHERE`
 * підстановкою — тобто статично не було видно, чи запит узагалі обмежений
 * будинком, а «усі будинки» означалось відсутністю аргументу, тобто
 * мовчазним дефолтом (інваріант 8). Тепер «усі» пишеться словом —
 * `ALL_PROPERTIES` — у того, хто це вирішує, а сюди приїздить готовий
 * фрагмент. Застосунок оголошений `scope: 'property'` (`core/apps.ts`), тож
 * звичайний виклик — один будинок.
 */
export async function listDevices(organizationId: string, scope: PropertyScope): Promise<DeviceRow[]> {
  const sql = getSql();
  const inScope = propertyScopeFilter(scope, 'kd');
  return (await sql.rows<DeviceRow>(`
    SELECT kd.id, kd.organization_id, kd.property_id, kd.name,
           kd.paired_at, kd.last_seen_at, kd.revoked_at, kd.config_json
      FROM kiosk_devices kd
     WHERE kd.organization_id = ? AND ${inScope.sql}
     ORDER BY kd.created_at DESC
  `, [organizationId, ...inScope.params])) as DeviceRow[];
}

/**
 * Відкликати термінал. Рядок лишається — разом із ним лишається доба, яку
 * він відпрацював. `DELETE` тут стер би журнал заразом із пристроєм.
 */
export async function revokeDevice(organizationId: string, deviceId: string): Promise<boolean> {
  const done = await getSql().run(
    'UPDATE kiosk_devices SET revoked_at = ? WHERE id = ? AND organization_id = ? AND revoked_at IS NULL',
    [new Date().toISOString(), deviceId, organizationId]);
  return done.changes > 0;
}

export type EventResult = 'ok' | 'refused' | 'error';

/**
 * Записати подію терміналу.
 *
 * `kind` — вільний рядок (`checkin`, `checkout`, `register`, `sign`,
 * `search_miss`, `pair`): словник подій росте швидше за міграції, а невідоме
 * слово в журналі нічого не відчиняє. `result` — троє, і CHECK у базі:
 * «сталося / відмовили / зламалось» це вісь, за якою читають екран доби, і
 * четверте слово там зробило б підсумок неправдивим.
 *
 * Подія пишеться і на ВІДМОВУ — саме вона й цінна: «шукав і не знайшов»
 * тридцять разів за вечір означає, що екран не працює, і без такого рядка
 * це видно лише зі скарги гостя.
 */
export async function noteEvent(input: {
  organizationId: string;
  deviceId: string;
  reservationId?: string | null;
  kind: string;
  result?: EventResult;
  detail?: string | null;
}): Promise<void> {
  await getSql().run(`
    INSERT INTO kiosk_events (id, organization_id, device_id, reservation_id, kind, result, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    newId('ke'), input.organizationId, input.deviceId, input.reservationId ?? null,
    input.kind, input.result ?? 'ok', input.detail ?? null,
  ]);
}

/** Події терміналів організації за добу — джерело екрана «Kiosk heute» (частина В). */
export async function eventsSince(organizationId: string, sinceIso: string): Promise<{
  id: string; device_id: string; reservation_id: string | null; kind: string; result: string; detail: string | null; at: string;
}[]> {
  return (await getSql().rows(`
    SELECT id, device_id, reservation_id, kind, result, detail, at
      FROM kiosk_events
     WHERE organization_id = ? AND at >= ?
     ORDER BY at DESC
  `, [organizationId, sinceIso])) as any[];
}
