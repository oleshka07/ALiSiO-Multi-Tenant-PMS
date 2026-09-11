/**
 * Сесія термінала: «хто я, де я стою і що мені дозволено».
 *
 * `GET /api/apps/kiosk/session` — перше, що робить екран у холі після
 * перезавантаження браузера. Сесії людини тут немає: право доводить токен
 * пристрою в `Authorization: Bearer` (`data/device-token.ts`).
 *
 * ── Що віддається і чого тут НЕМАЄ ──────────────────────────────────────
 *
 * Віддається рівно те, від чого залежить ПЕРШИЙ екран: назва обʼєкта, мови,
 * адреса walk-in (К8 — власний онлайн-модуль готелю, CDSoft Onlinebuchung;
 * порожня = кнопки немає), політика оплати при заселенні (К1 — від неї
 * залежить текст «оплата вранці на рецепції») і робоча смуга з `config_json`
 * (§3.2).
 *
 * Немає — жодного рядка гостя, жодної броні, жодного коду скриньки. Термінал
 * стоїть у холі, і його відповідь читає будь-хто, хто зазирне в екран або
 * підключиться до тієї самої мережі: усе, що він знає ДО того, як гість
 * назвався, стає публічним за визначенням.
 *
 * ── Ліміт частоти — на ПРИСТРОЇ ─────────────────────────────────────────
 *
 * Не на IP: усі термінали готелю сидять за одним вихідним, і спільне відро
 * зробило б повільним холом кожен другий. Ключ — id пристрою, тобто те, що
 * токен уже довів.
 */
import { NextResponse } from 'next/server';
import { runWithOrganization } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { checkRateLimit } from '@core/security/rate-limit';
import { readCheckinPolicy, readSystemOfRecord } from '@bookings/kernel';
import { deviceByToken, touchDevice, type KioskDevice } from '../data/device-token';

const APP = 'kiosk';

/** §3.2: кнопки в межах смуги, дефолт 35–85 % висоти екрана. */
export const DEFAULT_TOUCH_BAND = { top: 35, bottom: 85 };

/**
 * Смуга з `config_json`, приведена до придатної.
 *
 * Експортована як `readTouchBand` навмисно: сцена гейта мусить читати ТУ САМУ
 * функцію, що й сесія термінала. Копія правила в перевірці доводила б, що
 * правильна копія правильна.
 */
// Правило адреси — одне на запис і на читання, у домені. Тут лише
// переекспорт: сцена гейта питає сесію, писач картки — домен, функція та сама.
export { readAppearance } from '../domain/appearance';
import { readAppearance as appearanceOf } from '../domain/appearance';

export function readTouchBand(configJson: string | null): { top: number; bottom: number } {
  if (!configJson) return DEFAULT_TOUCH_BAND;
  try {
    const parsed = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
    const band = (parsed as { touch_band?: { top?: unknown; bottom?: unknown } })?.touch_band;
    // Число — саме `number`, а не «те, що `Number()` зуміє привести».
    //
    // `Number(null)` це 0, а `JSON.stringify({top: NaN})` дає саме `null` —
    // тобто смуга, записана з NaN, поверталася б із бази як `{top: 0}`:
    // скінченне, у межах, «правильне». Кнопки лягли б на весь екран від
    // самого верху, і жодна перевірка меж цього не помітила б. Те саме
    // зробили б `''`, `[]` і `false`.
    const num = (v: unknown): number | null =>
      (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const top = num(band?.top);
    const bottom = num(band?.bottom);
    // Смуга, яка не смуга (нечисла, перевернуті межі, поза екраном), — це
    // дефолт, а не порожній екран: кнопки мусять бути десь.
    if (top === null || bottom === null) return DEFAULT_TOUCH_BAND;
    if (top < 0 || bottom > 100 || top >= bottom) return DEFAULT_TOUCH_BAND;
    return { top, bottom };
  } catch {
    return DEFAULT_TOUCH_BAND;
  }
}

/**
 * Пристрій за заголовком — або названа відмова.
 *
 * Одні двері на всі маршрути кіоска: токена немає / чужий / відкликаний →
 * 401; застосунок вимкнено → 404 (інваріант 5 — вимкнений застосунок для
 * термінала не існує). Далі викликач працює під `runWithOrganization`.
 */
export async function requireDevice(request: Request): Promise<KioskDevice> {
  const device = await deviceByToken(request.headers.get('authorization'));
  if (!device) refuse('Термінал не розпізнано', 401);
  if (!(await hasFeature(device.organizationId, APP))) refuse('Не знайдено', 404);
  const limit = await checkRateLimit(`kiosk_device:${device.id}`, 'kiosk_device', 120, 1);
  if (!limit.allowed) refuse('Забагато запитів', 429);
  await touchDevice(device);
  return device;
}

export async function deviceSession(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    return await runWithOrganization(device.organizationId, async () => {
      const property = await getSql().row<{
        name: string; checkin_payment_policy: string | null;
        system_of_record: string | null; kiosk_walkin_url: string | null;
      }>(`
        SELECT name, checkin_payment_policy, system_of_record, kiosk_walkin_url
          FROM properties WHERE id = ? AND organization_id = ?
      `, [device.propertyId, device.organizationId]);
      // Обʼєкта немає — терміналу немає де стояти. Відмова, не порожній
      // екран із дефолтами (інваріант 13).
      if (!property) refuse('Не знайдено', 404);

      return NextResponse.json({
        device: { id: device.id, name: device.name },
        property: { id: device.propertyId, name: property.name },
        // Мови екрана — DE + EN (К7). Список, а не одне слово: перемикач
        // на екрані читає саме його.
        languages: ['de', 'en'],
        checkinPaymentPolicy: readCheckinPolicy(property.checkin_payment_policy),
        systemOfRecord: readSystemOfRecord(property.system_of_record),
        // Порожня адреса = walk-in вимкнено (К8). `null`, а не порожній
        // рядок: екран питає «чи є», а не «чи не порожньо». Сторінка за цією
        // адресою забороняє iframe, тож відкриває її оболонка кіоска окремою
        // сторінкою — це справа частини Б, тут лише адреса.
        walkinUrl: property.kiosk_walkin_url?.trim() || null,
        touchBand: readTouchBand(device.configJson),
        // Вигляд — звідти ж, звідки смуга: лого й фон цього ГОТЕЛЮ, а не
        // картинка в коді (інваріант 20).
        ...appearanceOf(device.configJson),
      });
    });
  } catch (error) {
    return handleError('apps/kiosk deviceSession', error, 'Не вдалося прочитати стан термінала');
  }
}
