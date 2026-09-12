/**
 * `POST /api/apps/guest/offers` і `POST /api/apps/guest/hold` — «немає бронювання».
 *
 * ── Орендаря називає КЛЮЧ, а не тіло ────────────────────────────────────
 *
 * Обидва маршрути публічні: сесії немає за визначенням, тож організацію
 * називає ключ у адресі застосунку (0414) і ніщо інше (інваріанти 1 і 8).
 * `propertyId`, `unitTypeId`, `ratePlanId` з тіла — не джерело орендаря, а
 * лише уточнення ВСЕРЕДИНІ того, що відчинив ключ: кожен із них звіряється з
 * обʼєктом ключа, і чужий віддає 404 (інваріант 5).
 *
 * ── Ціна в тілі не читається ────────────────────────────────────────────
 *
 * Її там і немає. Сума, яку побачив гість, рахується заново на сервері — тим
 * самим `calculateQuote`, що показував пропозицію. Поле, яке приймають і
 * звіряють, рано чи пізно звіряють не з тим; поля, якого немає, підмінити
 * нічим.
 */
import { NextResponse } from 'next/server';
import { runWithOrganization } from '@core/auth/tenant-context';
import { handleError, refuse } from '@core/http/errors';
import { checkRateLimit } from '@core/security/rate-limit';
import { propertyByAppKey } from '../data/property.repo';
import { readGuestAppKey } from '../domain/key';
import { coreSource } from '../source/core.source';
import { holdStay, confirmStay } from '../data/booking.repo';

/** Хто стукає — для ліміту; той самий довід, що в пошуку. */
function clientKey(request: Request, action: string): string {
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? '');
  return `${action}:${ip || 'unknown'}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Дім, який відчиняє ключ із тіла, — або названа відмова 404. */
async function homeFrom(body: Record<string, unknown>) {
  const key = readGuestAppKey(body.key);
  if (!key) refuse('Не знайдено', 404);
  const home = await propertyByAppKey(key);
  if (!home) refuse('Не знайдено', 404);
  return home;
}

/** Дати з тіла — або названа відмова. Мовчазного дефолту немає (інваріант 8). */
function datesFrom(body: Record<string, unknown>): { from: string; to: string; adults: number } {
  const from = String(body.from ?? '');
  const to = String(body.to ?? '');
  if (!DATE.test(from) || !DATE.test(to)) refuse('Оберіть дати заїзду і виїзду', 400);
  if (!(to > from)) refuse('Дата виїзду має бути пізнішою за дату заїзду', 400);
  const adults = Number(body.adults ?? 0);
  if (!Number.isInteger(adults) || adults < 1 || adults > 10) refuse('Скільки гостей — не названо', 400);
  return { from, to, adults };
}

/** Що показати на кроці вибору: вільні номери з цінами (КІ24). */
export async function listOffers(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const home = await homeFrom(body);
    const { from, to, adults } = datesFrom(body);

    // Джерело правди обирає сам обʼєкт: готель на своїй системі обліку знає
    // наявність ТАМ, і питати її в нас означало б продавати чужі кімнати.
    // Адаптер `handoff` — крок 5; доти такий готель чесно каже, що бронювати
    // тут не можна, замість того щоб показати порожній список.
    if (home.systemOfRecord === 'external') {
      return NextResponse.json({ offers: [], handoff: home.walkinUrl ?? null });
    }

    const offers = await runWithOrganization(home.organizationId, () => coreSource.offers({
      organizationId: home.organizationId, propertyId: home.propertyId, from, to, adults,
    }));
    return NextResponse.json({ offers, handoff: null });
  } catch (error) {
    return handleError('apps/guest listOffers', error, 'Не вдалося показати вільні номери');
  }
}

/** Взяти номер під бронь і тримати його до підтвердження (КІ23). */
export async function holdOffer(request: Request): Promise<Response> {
  try {
    // Ліміт ПЕРШИМ, до читання тіла: кожна успішна спроба знімає ніч із
    // продажу на пів години, тож дорогою тут є саме вона, а не помилка.
    const limit = await checkRateLimit(clientKey(request, 'guest_hold'), 'guest_hold', 5, 15);
    if (!limit.allowed) refuse('Забагато спроб. Спробуйте за чверть години', 429);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const home = await homeFrom(body);
    if (home.systemOfRecord === 'external') refuse('Бронювання цього готелю — на його власній сторінці', 409);
    const { from, to, adults } = datesFrom(body);

    const held = await runWithOrganization(home.organizationId, () => holdStay({
      organizationId: home.organizationId,
      propertyId: home.propertyId,
      unitTypeId: String(body.unitTypeId ?? ''),
      ratePlanId: body.ratePlanId ? String(body.ratePlanId) : null,
      from, to, adults,
      firstName: String(body.firstName ?? ''),
      lastName: String(body.lastName ?? ''),
      phone: String(body.phone ?? ''),
      email: body.email ? String(body.email) : null,
      lang: String(body.lang ?? 'de'),
    }));

    // Ідентифікатор броні назовні не їде: далі гість ходить лише за токеном,
    // як і той, хто знайшов свою бронь пошуком.
    return NextResponse.json({
      token: held.token,
      unitName: held.unitName,
      total: held.total,
      currency: held.currency,
      nights: held.nights,
      holdExpiresAt: held.holdExpiresAt,
    }, { status: 201 });
  } catch (error) {
    return handleError('apps/guest holdOffer', error, 'Не вдалося забронювати');
  }
}

/** Гість підтвердив: бронь стає справжньою, строк знімається. */
export async function confirmHold(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const home = await homeFrom(body);
    const token = String(body.token ?? '');
    if (!token) refuse('Не знайдено', 404);

    const ok = await runWithOrganization(home.organizationId, () => confirmStay(token));
    // `false` — строк минув і номер уже звільнено. Це не 4xx і не 5xx: гостю
    // треба сказати про кімнату, а не про код. Екран на це відповідає
    // поверненням до вибору дат.
    return NextResponse.json({ confirmed: ok });
  } catch (error) {
    return handleError('apps/guest confirmHold', error, 'Не вдалося підтвердити бронювання');
  }
}
