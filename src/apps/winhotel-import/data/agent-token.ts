/**
 * Токен агента — перепустка, з якою сервер готелю приносить знімок.
 *
 * ── Форма: `<організація>.<секрет>` ─────────────────────────────────────
 *
 * Приймальний маршрут не має сесії, а `channel_credentials` — під політикою
 * орендаря: рядок із хешем не прочитати, доки орендар невідомий. Два виходи:
 * відкрити таблицю ключів для читання за токеном (`PUBLIC_TOKEN_READ` у
 * `pg-schema.mjs` — це рядок із СЕКРЕТАМИ, і відчиняти його ще одним
 * способом не хочеться) або назвати організацію в самому токені. Друге:
 * ідентифікатор організації не секрет (він у кожній адресі кабінету), а
 * право доводить секрет — 32 випадкові байти, — і звіряється він уже під
 * `runWithOrganization` тієї організації, яку токен назвав. Чужий префікс
 * із чужим секретом упирається в чужий хеш і дістає 401, не читаючи нічого,
 * крім одного рядка ключів.
 *
 * ── У базі — хеш, і лише він ────────────────────────────────────────────
 *
 * Значення показується один раз, при створенні. Зберігається
 * `sha256(секрет)` — під `seal()`, як і решта ключів у `channel_credentials`
 * (інваріант 7; §3 задачі: «токен агента — хеш у базі, значення показується
 * раз»). Витік бази не дає токена; втрачений токен замінюється новим — старий
 * при цьому перестає діяти, бо рядок один на організацію.
 *
 * Сховище те саме, що в fiskaly/smtp (`channel_credentials`, канал
 * `winhotel_import`, колонка `access_token`), але писач свій: загальний
 * `saveIntegrationCredentials` пише лише поля з маніфесту, а в маніфесті
 * полів немає навмисно — токен генерують, не вставляють (`core/apps.ts`).
 * Читання — загальне, `integrationCredentials`, щоб розпечатування й
 * запасні гілки лишались в одному місці.
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { integrationCredentials, seal } from '@core/integration-credentials';
import { runWithOrganization } from '@core/auth/tenant-context';

const CHANNEL = 'winhotel_import';
const SECRET_HEX = /^[0-9a-f]{64}$/;

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Новий токен для організації. Викликається під контекстом орендаря
 * (`withOwner`). Повертає значення, яке показують один раз.
 */
export async function issueAgentToken(organizationId: string): Promise<string> {
  const secret = crypto.randomBytes(32).toString('hex');
  const stored = seal(hashSecret(secret));
  const sql = getSql();
  const existing = await sql.row<{ id: string }>(
    'SELECT id FROM channel_credentials WHERE organization_id = ? AND channel = ?',
    [organizationId, CHANNEL],
  );
  if (existing) {
    await sql.run(
      'UPDATE channel_credentials SET access_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
      [stored, existing.id, organizationId],
    );
  } else {
    await sql.run(`
      INSERT INTO channel_credentials (id, organization_id, channel, environment, access_token, created_at, updated_at)
      VALUES (?, ?, ?, 'production', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [`cred_${CHANNEL}_${organizationId}`.slice(0, 60), organizationId, CHANNEL, stored]);
  }
  return `${organizationId}.${secret}`;
}

/** Чи має організація токен (без значення — лише факт). Під контекстом орендаря. */
export async function hasAgentToken(organizationId: string): Promise<boolean> {
  const creds = await integrationCredentials(CHANNEL, organizationId);
  return !!creds?.accessToken;
}

/** Розібрати `Authorization: Bearer <організація>.<секрет>`; не та форма — null. */
export function parseBearer(header: string | null): { organizationId: string; secret: string } | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const dot = m[1].lastIndexOf('.');
  if (dot <= 0) return null;
  const organizationId = m[1].slice(0, dot).trim();
  const secret = m[1].slice(dot + 1).trim();
  if (!organizationId || !SECRET_HEX.test(secret)) return null;
  return { organizationId, secret };
}

/**
 * Організація, чий це токен, або null. Читає один рядок ключів під
 * `runWithOrganization` названої організації і звіряє хеш сталим часом.
 */
export async function organizationByAgentToken(header: string | null): Promise<string | null> {
  const parsed = parseBearer(header);
  if (!parsed) return null;
  const creds = await runWithOrganization(parsed.organizationId, () => integrationCredentials(CHANNEL, parsed.organizationId));
  const stored = creds?.perOrganization ? creds.accessToken : null;
  if (!stored) return null;
  const a = Buffer.from(hashSecret(parsed.secret), 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return parsed.organizationId;
}
