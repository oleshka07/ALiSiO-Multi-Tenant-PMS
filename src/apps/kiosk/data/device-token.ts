/**
 * Токен термінала — перепустка екрана, який стоїть у холі без нагляду.
 *
 * ── Форма: `<організація>.<обʼєкт>.<пристрій>.<секрет>` ─────────────────
 *
 * Та сама причина, що в токена агента Winhotel
 * (`src/apps/winhotel-import/data/agent-token.ts`): маршрут кіоска сесії не
 * має, а `kiosk_devices` — під політикою орендаря, тож рядок із хешем не
 * прочитати, доки орендар невідомий. Токен називає орендаря сам.
 *
 * Різниця з Winhotel — два середні сегменти. Там рядок ключів ОДИН на
 * організацію, тут терміналів у готелі кілька, і кожен мусить відкликатися
 * окремо: «відкликати той, що в холі корпусу B» не має гасити той, що в
 * головному. Без імені пристрою в токені довелося б перебирати всі рядки
 * організації й порівнювати хеші по черзі — тобто робити довжину відповіді
 * залежною від того, скільки терміналів у готелі.
 *
 * Обʼєкт у токені — вісь БУДИНКУ (INC-029), і вона тут не для лічильника.
 * Термінал стоїть у холі одного корпусу, і рядок пристрою читається з
 * `property_id` у самому запиті: токен, у якому корпус підмінили, не
 * знаходить нічого. Без цього сегмента запит мусив би СПИТАТИ базу, у якому
 * корпусі стоїть термінал, — тобто читати таблицю з `property_id`, нічим не
 * обмежену по цій осі, і саме таке читання цей проєкт рахує недоведеним.
 *
 * Ні ідентифікатор організації, ні обʼєкта, ні пристрою НЕ секрети (усі три
 * стоять в адресах кабінету), право доводить секрет — 32 випадкові байти.
 * Розбір іде з КІНЦЯ: секрет — після останньої крапки, пристрій і обʼєкт —
 * два сегменти перед ним; решта, хоч би скільки в ній крапок, — організація.
 *
 * ── У базі — хеш, і лише він ────────────────────────────────────────────
 *
 * `sha256(секрет)` під `seal()`, як усі ключі (інваріант 7). Значення
 * показується один раз — терміналу, у відповідь на код парування. Витік бази
 * не дає токена; загублений термінал відкликається `revoked_at`, і його
 * події лишаються в журналі.
 *
 * ── Що токен НЕ дає ─────────────────────────────────────────────────────
 *
 * Він називає організацію І ОБʼЄКТ. Усе, що читає кіоск, звіряється з
 * `property_id` пристрою, а не лише з організацією: термінал у холі одного
 * будинку не знаходить броней сусіднього (вісь INC-029, §3.4).
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { seal, unseal } from '@core/integration-credentials';
import { runWithOrganization } from '@core/auth/tenant-context';

const SECRET_HEX = /^[0-9a-f]{64}$/;

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Пристрій, чий це токен. Форма відповіді — те, чим кіоск себе обмежує. */
export interface KioskDevice {
  id: string;
  organizationId: string;
  propertyId: string;
  name: string;
  configJson: string | null;
}

/**
 * Новий секрет для наявного рядка пристрою. Викликається під контекстом
 * орендаря. Повертає значення, яке показують ОДИН раз.
 */
export async function issueDeviceToken(
  organizationId: string,
  propertyId: string,
  deviceId: string,
): Promise<string> {
  const secret = crypto.randomBytes(32).toString('hex');
  const stored = seal(hashSecret(secret));
  const sql = getSql();
  await sql.run(`
    UPDATE kiosk_devices
       SET token_hash = ?, paired_at = ?, revoked_at = NULL
     WHERE id = ? AND organization_id = ? AND property_id = ?
  `, [stored, new Date().toISOString(), deviceId, organizationId, propertyId]);
  return `${organizationId}.${propertyId}.${deviceId}.${secret}`;
}

/** Розібрати `Authorization: Bearer <організація>.<обʼєкт>.<пристрій>.<секрет>`. */
export function parseBearer(header: string | null | undefined): {
  organizationId: string; propertyId: string; deviceId: string; secret: string;
} | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  let rest = m[1].trim();
  const take = () => {
    const dot = rest.lastIndexOf('.');
    if (dot <= 0) return null;
    const tail = rest.slice(dot + 1).trim();
    rest = rest.slice(0, dot);
    return tail || null;
  };
  const secret = take();
  const deviceId = take();
  const propertyId = take();
  const organizationId = rest.trim();
  if (!secret || !deviceId || !propertyId || !organizationId) return null;
  if (!SECRET_HEX.test(secret)) return null;
  return { organizationId, propertyId, deviceId, secret };
}

/**
 * Пристрій за токеном, або null. Один рядок під `runWithOrganization` тієї
 * організації, яку токен назвав; порівняння хешів — сталим часом.
 *
 * Відкликаний пристрій — теж null, і саме тому `revoked_at` перевіряється
 * ТУТ, а не в кожному хендлері: забути його в одному з дванадцяти маршрутів
 * означало б, що відкликаний термінал і далі відповідає рівно там.
 */
export async function deviceByToken(header: string | null | undefined): Promise<KioskDevice | null> {
  const parsed = parseBearer(header);
  if (!parsed) return null;

  const row = await runWithOrganization(parsed.organizationId, () =>
    getSql().row<{
      id: string; organization_id: string; property_id: string; name: string;
      token_hash: string; revoked_at: string | null; config_json: string | null;
    }>(`
      SELECT id, organization_id, property_id, name, token_hash, revoked_at, config_json
        FROM kiosk_devices
       WHERE id = ? AND organization_id = ? AND property_id = ?
    `, [parsed.deviceId, parsed.organizationId, parsed.propertyId]));

  if (!row || row.revoked_at) return null;

  const stored = unseal(row.token_hash);
  if (!stored) return null;
  const a = Buffer.from(hashSecret(parsed.secret), 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    name: row.name,
    configJson: row.config_json ?? null,
  };
}

/**
 * Відмітити, що термінал озвався. Окремо від звірки токена: на картці
 * «останній звʼязок» мусить рухатись від КОЖНОГО виклику, а звірка бігає і
 * там, де запис зайвий (сцени гейта).
 */
export async function touchDevice(device: KioskDevice): Promise<void> {
  await runWithOrganization(device.organizationId, () =>
    getSql().run('UPDATE kiosk_devices SET last_seen_at = ? WHERE id = ? AND organization_id = ?',
      [new Date().toISOString(), device.id, device.organizationId]));
}
