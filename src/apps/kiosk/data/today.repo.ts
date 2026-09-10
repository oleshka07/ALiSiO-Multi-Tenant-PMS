/**
 * «Kiosk heute» — що термінали зробили за ДОБУ ГОТЕЛЮ.
 *
 * ── Доба готелю, не UTC ─────────────────────────────────────────────────
 *
 * Гість заселився о 23:40 за місцевим часом. У Берліні влітку це 21:40 UTC —
 * та сама доба; узимку о 00:40 місцевого це 23:40 UTC ПОПЕРЕДНЬОЇ доби. Лист
 * о 7:00 із «нуль заселень» у ранок після зміни, коли їх було троє, — це не
 * дрібниця обліку: рецепція вирішує за цим листом, кому виставляти фактуру.
 *
 * Тому межі доби рахує `todayIn(timezone)` (`@core/hotel-day`), а не
 * `new Date().toISOString()`.
 *
 * ── Чому підсумок рахується ТУТ, а не в листі ───────────────────────────
 *
 * Лист і екран показують одне й те саме: якби кожен рахував сам, вони
 * розійшлися б при першій же правці, і рецепція побачила б на екрані одне, а
 * в пошті інше. Форма одна, читачів двоє.
 */
import { getSql } from '@core/db/async';
import { organizationTimezone, todayIn } from '@core/hotel-day';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';

export interface KioskDayEvent {
  id: string;
  device_id: string;
  device_name: string | null;
  property_id: string | null;
  reservation_id: string | null;
  kind: string;
  result: string;
  detail: string | null;
  at: string;
}

export interface KioskDay {
  /** Доба готелю, `YYYY-MM-DD`. */
  day: string;
  timezone: string;
  events: KioskDayEvent[];
  counts: {
    checkedIn: number;
    registered: number;
    checkedOut: number;
    ordered: number;
    errors: number;
  };
  /**
   * Виїзди, фактуру за якими виставляє ЧУЖА система (фаза `external`).
   * Це і є «список для рецепції» — не підрахунок, а перелік рядків.
   */
  invoiceElsewhere: KioskDayEvent[];
}

/** Межі доби готелю в тому вигляді, у якому лежить `kiosk_events.at` (ISO). */
export function dayBounds(day: string, timezone: string): { from: string; to: string } {
  // Зсув зони на цю добу: беремо полудень, щоб не потрапити в саму годину
  // переводу стрілок — о 12:00 зсув однозначний у будь-якій зоні.
  const noonUtc = new Date(`${day}T12:00:00Z`);
  const local = new Date(noonUtc.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMs = local.getTime() - noonUtc.getTime();
  const startLocal = new Date(`${day}T00:00:00Z`).getTime() - offsetMs;
  return {
    from: new Date(startLocal).toISOString(),
    to: new Date(startLocal + 86_400_000).toISOString(),
  };
}

/**
 * Доба одного готелю.
 *
 * Область приходить ТИПОМ (`PropertyScope`), а не необовʼязковим рядком.
 * Перша редакція мала `propertyId?: string | null` і склеювала `WHERE`
 * підстановкою: статично не було видно, чи запит узагалі обмежений будинком,
 * а «весь рахунок» означалось ВІДСУТНІСТЮ аргументу — тобто мовчазним
 * дефолтом (інваріант 8). Тепер «усі будинки» пишеться словом
 * (`ALL_PROPERTIES`) у того, хто це вирішує: картка дивиться на будинок,
 * лист о 7:00 — теж (він іде на адресу ОБʼЄКТА), а весь рахунок питає лише
 * той, хто справді хоче весь рахунок.
 *
 * Вісь будинку йде через ПРИСТРІЙ: сама подія будинку не знає, вона знає
 * термінал, а термінал стоїть в одному холі.
 */
export async function kioskDay(input: {
  organizationId: string;
  scope: PropertyScope;
  /** Доба готелю; не передано — сьогоднішня за зоною організації. */
  day?: string | null;
}): Promise<KioskDay> {
  const timezone = await organizationTimezone(input.organizationId);
  const day = input.day ?? todayIn(timezone);
  const { from, to } = dayBounds(day, timezone);
  const inScope = propertyScopeFilter(input.scope, 'd');

  const events = (await getSql().rows<KioskDayEvent>(`
    SELECT e.id, e.device_id, d.name AS device_name, d.property_id,
           e.reservation_id, e.kind, e.result, e.detail, e.at
      FROM kiosk_events e
      LEFT JOIN kiosk_devices d ON d.id = e.device_id AND d.organization_id = e.organization_id
     WHERE e.organization_id = ? AND e.at >= ? AND e.at < ? AND ${inScope.sql}
     ORDER BY e.at
  `, [input.organizationId, from, to, ...inScope.params])) as KioskDayEvent[];

  const ok = (kind: string) => events.filter((e) => e.kind === kind && e.result === 'ok').length;
  return {
    day,
    timezone,
    events,
    counts: {
      checkedIn: ok('checkin'),
      registered: ok('register'),
      checkedOut: ok('checkout'),
      ordered: ok('order'),
      // Помилки — і відмови, і поломки: рецепції важливо «скільки разів
      // екран не спрацював», а не наша класифікація причин.
      errors: events.filter((e) => e.result !== 'ok').length,
    },
    invoiceElsewhere: events.filter((e) => e.kind === 'invoice_elsewhere' && e.result === 'ok'),
  };
}
