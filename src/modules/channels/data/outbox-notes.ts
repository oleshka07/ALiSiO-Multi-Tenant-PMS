import type { Sql } from '@core/db/async';
import { connectionsForProperty } from './connections.repo';
import { connectionMirror } from './mappings.repo';
import { enqueueChange, OUTBOX_HORIZON_DAYS } from './outbox.repo';
// Вузькі двері, не повний фасад: `@pricing` тягне HTTP-обробники, а з ними
// `next/server`, якого в продакшн-образі немає (`@pricing/plans`).
import { listRatePlans } from '@pricing/plans';
import type { RateField } from '../domain/ari-batch.ts';

/**
 * «Змінилось» → координата в черзі кожного зʼєднання обʼєкта.
 *
 * Логіка дверей `@channels/outbox` — там і документація. Живе в data/, бо її
 * кличуть і власні писачі модуля (вхідні броні, iCal), а data/ не імпортує
 * api/.
 */
/** Ночі проживання, ОБИДВІ включно: для броні це `check_in`..`check_out − 1`. */
export interface AvailabilityNote {
  propertyId: string;
  unitTypeId: string;
  from: string;
  /** Порожньо — до горизонту (номер зʼявився, зник, змінив стан). */
  to?: string | null;
}

export interface RateNote {
  propertyId: string;
  /** Порожньо — усі типи обʼєкта (матриця без типу). */
  unitTypeId?: string | null;
  /** Порожньо — усі тарифи на цих типах (базова ціна типу міняє кожен). */
  ratePlanId?: string | null;
  from: string;
  /** Порожньо — до горизонту. */
  to?: string | null;
  /**
   * Які поля ціни змінились — маска координати (Блок 0.5). `null` або
   * відсутнє — усі; порожній масив — відмова черги (нічого не змінилось —
   * не кличте двері). Писач календаря ставить її з різниці з рядком у базі
   * (ціна — на пару тарифу, обмеження — на всі пари типу); матриця й тири —
   * `['prices']`; зміна тарифу, типу, повний синк — усі.
   */
  fields?: readonly RateField[] | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Обрізати сьогоднішнім днем і горизонтом. `null` — не лишилось жодної ночі. */
export function clipToHorizon(
  from: string,
  to: string | null | undefined,
  today: string,
): { from: string; to: string } | null {
  const start = from < today ? today : from;
  const horizon = addDays(today, OUTBOX_HORIZON_DAYS - 1);
  const end = to == null || to > horizon ? horizon : to;
  return end < start ? null : { from: start, to: end };
}

/** Скільки координат лягло в чергу — по одній на зʼєднання, де тип змаплений. */
export async function noteAvailabilityChanged(
  t: Sql,
  note: AvailabilityNote,
  today: string = todayIso(),
): Promise<number> {
  const span = clipToHorizon(note.from, note.to ?? null, today);
  if (!span) return 0;

  let written = 0;
  for (const connection of await connectionsForProperty(note.propertyId)) {
    const mirror = await connectionMirror(connection.id);
    const mapped = mirror.some((m) => m.entityType === 'unit_type' && m.localId === note.unitTypeId);
    if (!mapped) continue;
    await enqueueChange(t, connection.id, {
      kind: 'availability', unitTypeId: note.unitTypeId, date: span.from, dateTo: span.to,
    });
    written++;
  }
  return written;
}

/** Скільки координат лягло — по одній на змаплену ПАРУ тип × тариф (Ц10) на кожному зʼєднанні. */
export async function noteRatesChanged(
  t: Sql,
  note: RateNote,
  today: string = todayIso(),
): Promise<number> {
  const span = clipToHorizon(note.from, note.to ?? null, today);
  if (!span) return 0;

  // Б3 (лист Channex 05.09): зміна ТИПУ — базова ціна, матриця, місткість —
  // не розсилається на пари ЗНЯТИХ з продажу тарифів. Дзеркало їх памʼятає
  // (адресат є, Ц25), але зняття вже закрило їхні ночі; кожна нова
  // координата лише знову закривала б їх — і тримала б у каталозі вендора
  // тариф, якого готель не продає. Тариф, названий ЯВНО (`ratePlanId`), не
  // фільтрується: саме так зняття з продажу і шле своє «закрито». Пара, чий
  // тариф із таблиці зник, лишається — її ночі батчер закриє, і це безпечніше
  // за тишу (Ц16); розбіжність дзеркала показує `channex-mappings-live.mjs`.
  const retired = note.ratePlanId
    ? new Set<string>()
    : new Set((await listRatePlans(note.propertyId)).filter((p) => !p.isActive).map((p) => p.id));

  let written = 0;
  for (const connection of await connectionsForProperty(note.propertyId)) {
    const pairs = (await connectionMirror(connection.id)).filter((m) =>
      m.entityType === 'rate_plan'
      && (!note.unitTypeId || m.unitTypeId === note.unitTypeId)
      && (!note.ratePlanId || m.localId === note.ratePlanId)
      && !retired.has(m.localId));
    for (const pair of pairs) {
      await enqueueChange(t, connection.id, {
        kind: 'rate', unitTypeId: pair.unitTypeId, ratePlanId: pair.localId, date: span.from, dateTo: span.to,
        fields: note.fields ?? null,
      });
      written++;
    }
  }
  return written;
}

/** Остання ніч проживання: `check_out` — це ранок виїзду, а не ніч. Те саме для `date_to` блокування. */
export function lastNight(checkOut: string): string {
  return addDays(checkOut, -1);
}
