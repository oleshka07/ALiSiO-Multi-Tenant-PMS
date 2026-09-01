import type { Sql } from '@core/db/async';
import { connectionsForProperty } from './connections.repo';
import { connectionMirror } from './mappings.repo';
import { enqueueChange, OUTBOX_HORIZON_DAYS } from './outbox.repo';

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

  let written = 0;
  for (const connection of await connectionsForProperty(note.propertyId)) {
    const pairs = (await connectionMirror(connection.id)).filter((m) =>
      m.entityType === 'rate_plan'
      && (!note.unitTypeId || m.unitTypeId === note.unitTypeId)
      && (!note.ratePlanId || m.localId === note.ratePlanId));
    for (const pair of pairs) {
      await enqueueChange(t, connection.id, {
        kind: 'rate', unitTypeId: pair.unitTypeId, ratePlanId: pair.localId, date: span.from, dateTo: span.to,
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
