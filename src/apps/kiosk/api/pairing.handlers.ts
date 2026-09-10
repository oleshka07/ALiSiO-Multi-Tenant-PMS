/**
 * Парування термінала — публічний маршрут, право доводить КОД.
 *
 * `POST /api/apps/kiosk/pair`, тіло `{ "code": "481902" }`. Сесії тут немає
 * за визначенням: у холі стоїть екран, а не людина з паролем. Право доводить
 * шестизначний код, який адмін щойно побачив на картці; сам код у базі не
 * лежить — лежить його sha256, і саме хеш є перепусткою, якою рядок
 * читається до того, як відомий орендар (інваріант 14).
 *
 * Порядок відмов і те, чому вони ОДНАКОВІ:
 *
 *   не шість цифр               → 400 «код невірний»;
 *   немає / зужитий / строчений → 400 «код невірний»;
 *   застосунок вимкнено         → 400 «код невірний».
 *
 * Три різні причини, одна відповідь. Різні тексти перетворили б цей маршрут
 * на довідник: «код не той» проти «код той, але прострочений» каже, що код
 * ІСНУЄ, тобто підтверджує половину підбору. Ліміт частоти на IP додає до
 * цього ціну спроби (10 спроб на 10 хвилин).
 *
 * Успіх віддає токен ОДИН раз — іншого способу його дізнатися немає.
 *
 * ── Чому окремим файлом від картки застосунку ───────────────────────────
 *
 * Не заради охайності. `check-public-routes` читає ТЕКСТ модуля, у який веде
 * маршрут, і шукає в ньому двері. Поки цей публічний хендлер і три хендлери
 * власника лежали в одному файлі, гейт бачив в одному тексті і `withOwner`, і
 * `pairingByCode` — тож маршрути картки виходили «доведені токеном» (неправда),
 * а після виправлення переліку варт публічне парування вийшло б «під вартою
 * власника» (теж неправда). Один файл — одна відповідь на питання «чим цей
 * маршрут доводить право».
 */
import { NextResponse } from 'next/server';
import { runWithOrganization } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { checkRateLimit } from '@core/security/rate-limit';
import { noteEvent, pairingByCode, redeemPairing } from '../data/devices.repo';
import { issueDeviceToken } from '../data/device-token';

const APP = 'kiosk';

/** Одна відповідь на всі причини — див. шапку. */
const BAD_CODE = 'Код невірний або вже використаний';

/**
 * Хто стукає. `x-forwarded-for` за проксі, інакше — нічого: ключ ліміту без
 * адреси стає одним відром на всіх, і це чесніше, ніж вигадана адреса.
 */
function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? '');
  return `kiosk_pair:${ip || 'unknown'}`;
}

export async function pairDevice(request: Request): Promise<Response> {
  try {
    const limit = await checkRateLimit(clientKey(request), 'kiosk_pair', 10, 10);
    if (!limit.allowed) refuse('Забагато спроб. Спробуйте за десять хвилин', 429);

    const body = await request.json().catch(() => ({}));
    const code = String((body as { code?: unknown }).code ?? '').trim();

    const pairing = await pairingByCode(code);
    if (!pairing) refuse(BAD_CODE, 400);

    // Застосунок вимкнено — той самий текст: термінал не мусить дізнатися,
    // що код правильний, а куплений не той застосунок.
    if (!(await hasFeature(pairing.organization_id, APP))) refuse(BAD_CODE, 400);

    return await runWithOrganization(pairing.organization_id, async () => {
      const claimed = await redeemPairing(pairing);
      if (!claimed) refuse(BAD_CODE, 400);
      const token = await issueDeviceToken(pairing.organization_id, pairing.property_id, claimed.deviceId);
      await noteEvent({
        organizationId: pairing.organization_id, deviceId: claimed.deviceId, kind: 'pair',
      });
      return NextResponse.json({
        token,
        deviceId: claimed.deviceId,
        name: pairing.name,
        propertyId: pairing.property_id,
      });
    });
  } catch (error) {
    return handleError('apps/kiosk pairDevice', error, 'Не вдалося спарувати термінал');
  }
}
