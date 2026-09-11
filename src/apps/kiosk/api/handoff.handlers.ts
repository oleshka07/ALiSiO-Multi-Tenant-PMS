/**
 * Передача заселення на телефон гостя: намалювати QR — і прийняти того, хто
 * його відсканував.
 *
 * Два маршрути, і вони по різні боки паркана:
 *
 *   `startHandoff`  — за токеном ПРИСТРОЮ. Тільки термінал готелю має право
 *                     випустити перепустку на свій будинок;
 *   `handoffFind`   — БЕЗ сесії й без токена пристрою: на тому кінці телефон
 *                     гостя, який щойно підійшов до екрана. Право доводить
 *                     сам токен передачі (`readHandoff`), і він називає
 *                     організацію та БУДИНОК — тобто вісь, без якої пошук
 *                     розлазиться на сусідній корпус (INC-029).
 *
 * ── Що телефон дістає у відповідь ──────────────────────────────────────
 *
 * Не бронь. Посилання на ГОСТЬОВИЙ ПОРТАЛ (`/guest/<токен>`) — те саме, що
 * готель шле листом, і далі гість іде звичайним шляхом, який уже вміє і
 * документ, і згоду, і підпис. Другого заселення тут не пишеться: цей файл
 * нічого не змінює в броні, крім одного — видає порталу токен, якщо його ще
 * немає, тим самим правилом, яким його видає підтвердження броні.
 *
 * Маскування те саме, що на терміналі: у відповідь їде «M… F…», а не прізвище.
 */
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { runWithOrganization } from '@core/auth/tenant-context';
import { handleError, refuse } from '@core/http/errors';
import { checkRateLimit } from '@core/security/rate-limit';
import { getSql } from '@core/db/async';
import { generateGuestToken } from '@core/db';
import { requireDevice } from './session.handlers';
import { findStays } from '../data/stay.repo';
import { noteEvent } from '../data/devices.repo';
import { buildHandoff, readHandoff, HANDOFF_TTL_MINUTES } from '../domain/handoff';
import {
  decideSearch, enoughFactors, maskName, namedFactors, stayWindow, type SearchInput,
} from '../domain/search';

/** Сьогодні за календарем сервера, `YYYY-MM-DD`. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Адреса, за якою телефон знайде цю сторінку.
 *
 * Береться з ЗАПИТУ, а не з налаштування: термінал уже стоїть на цьому хості,
 * і будь-яке інше значення означало б QR, що веде не туди, куди дивиться сам
 * екран. `x-forwarded-proto` за nginx, інакше — те, чим прийшов запит.
 */
function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** Термінал просить QR для свого будинку. */
export async function startHandoff(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const ticket = buildHandoff({
      organizationId: device.organizationId,
      propertyId: device.propertyId,
    });
    const url = `${originOf(request)}/kiosk/go/${ticket}`;
    // QR малюється НА СЕРВЕРІ: інакше екран тягнув би бібліотеку в браузер
    // термінала, а вона там більше ні для чого.
    const image = await QRCode.toDataURL(url, { margin: 1, width: 640 });
    await noteEvent({
      organizationId: device.organizationId, deviceId: device.id, kind: 'handoff',
    });
    return NextResponse.json({ url, image, expiresInMinutes: HANDOFF_TTL_MINUTES });
  } catch (error) {
    return handleError('apps/kiosk startHandoff', error, 'Не вдалося підготувати QR');
  }
}

/** Хто стукає з телефона. Той самий ключ, що в паруванні. */
function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? '');
  return `kiosk_handoff:${ip || 'unknown'}`;
}

/**
 * Телефон гостя шукає бронь за тим самим правилом, що термінал.
 *
 * Два чинники, цей будинок, вікно ±1 день — усе з домену, жодної своєї копії:
 * послаблення тут означало б, що обійти правило термінала можна, просто
 * сфотографувавши його екран.
 */
export async function handoffFind(request: Request): Promise<Response> {
  try {
    // Ліміт СУВОРІШИЙ за термінальний: біля термінала стоїть людина в холі, а
    // сюди стукають із будь-якого телефона в місті.
    const limit = await checkRateLimit(clientKey(request), 'kiosk_handoff', 20, 10);
    if (!limit.allowed) refuse('Забагато спроб. Спробуйте пізніше', 429);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const pass = readHandoff(body.ticket);
    // «Строк вийшов» і «підроблено» — та сама відповідь: перша інакше стає
    // підказкою для другої.
    if (!pass) refuse('Посилання більше не дійсне. Підійдіть до термінала ще раз', 400);

    const search: SearchInput = {
      lastName: body.lastName as string,
      checkIn: body.checkIn as string,
      confirmation: body.confirmation as string,
    };
    if (!enoughFactors(namedFactors(search))) refuse('need_factors', 400);

    return await runWithOrganization(pass.organizationId, async () => {
      const rows = await findStays({
        organizationId: pass.organizationId,
        propertyId: pass.propertyId,
        search,
        window: stayWindow(today()),
      });
      const outcome = decideSearch(rows);
      if (outcome.kind !== 'found') {
        return NextResponse.json({ found: false, reason: outcome.kind });
      }

      const row = rows[0];
      // Токен порталу видається тим самим правилом, яким його видає
      // підтвердження броні (`reservation.handlers`): якщо його ще немає —
      // завести. Гість довів два чинники, свій будинок і вікно доби, тобто
      // рівно те, за чим термінал пускає його заселятись.
      let token = row.guest_page_token;
      if (!token) {
        // ТОЙ САМИЙ генератор, що всюди (`@core/db`), а не свій
        // `randomBytes`: другий виробник тих самих токенів розійшовся б із
        // першим у довжині чи абетці, і пошук за токеном з листа перестав би
        // збігатися з токеном, виданим тут.
        token = generateGuestToken();
        await getSql().run(
          'UPDATE reservations SET guest_page_token = ? WHERE id = ? AND organization_id = ?',
          [token, row.id, pass.organizationId]);
      }
      return NextResponse.json({
        found: true,
        // Імʼя маскою — сторінку тримає в руках гість, але читають її через
        // плече так само, як екран у холі.
        guest: `${maskName(row.first_name)} ${maskName(row.last_name)}`.trim(),
        checkIn: row.check_in.slice(0, 10),
        checkOut: row.check_out.slice(0, 10),
        portalPath: `/guest/${token}`,
      });
    });
  } catch (error) {
    return handleError('apps/kiosk handoffFind', error, 'Не вдалося знайти бронь');
  }
}
