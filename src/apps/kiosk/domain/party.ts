/**
 * Склад броні: хто вже вписаний і кого щойно назвали.
 *
 * ── Навіщо це окреме правило ────────────────────────────────────────────
 *
 * `saveRegistrations` (`@guests`) ЗАМІНЮЄ список броні цілком: `DELETE` і
 * заново. Для гостьового порталу це правильно — там одна форма на всю
 * сімʼю, і вона надсилає всіх разом. Термінал у холі влаштований інакше:
 * біля нього стоїть по одній людині, кожна вписує себе і відходить.
 *
 * Доки памʼять про попередніх жила на ЕКРАНІ, склад тримався на тому, що
 * гість не відходить від термінала: скидання за бездіяльністю (60 с) чистить
 * React-стан, і другий натиск стирав першого гостя. Обидві відповіді —
 * `ok`, бронь не ставала зареєстрованою ніколи, заселення відмовляло
 * `not_registered`. Найгірший рід вади: обидві половини працюють, не працює
 * тільки разом.
 *
 * Тому памʼять — у БАЗІ, а тут правило, як накласти нове на збережене.
 * Правило чисте й окремо перевіряється: у хендлері воно було б перемішане
 * з токеном пристрою і транзакцією.
 *
 * ── Правило ─────────────────────────────────────────────────────────────
 *
 * Особа — це пара «імʼя + прізвище», без огляду на регістр і пробіли:
 * «anna beispiel» і «Anna  Beispiel» це одна людина, і другий запис не
 * подвоює склад, а ВИПРАВЛЯЄ перший. Порожнє поле в новому записі не стирає
 * збереженого: гість, який вписався з паспортом на порталі, не втрачає
 * номер документа тому, що на терміналі це поле не питають.
 */

export interface PartyGuest {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  address?: string | null;
  nationality?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  purposeOfStay?: string | null;
  visaNumber?: string | null;
}

/** Рядок `reservation_guests` так, як його віддає `stayGuests`. */
export interface SavedGuestRow {
  first_name: string;
  last_name: string;
  nationality: string | null;
  document_type: string | null;
  document_number: string | null;
  date_of_birth: string | null;
  address: string | null;
  purpose_of_stay: string | null;
  visa_number: string | null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const orNull = (v: unknown): string | null => text(v) || null;

/** Ключ особи: регістр і зайві пробіли не роблять з людини двох. */
export function personKey(g: { firstName?: unknown; lastName?: unknown }): string {
  return `${text(g.firstName).toLowerCase().replace(/\s+/g, ' ')}|${text(g.lastName).toLowerCase().replace(/\s+/g, ' ')}`;
}

/** Збережений рядок у формі, яку приймає писач. */
export function fromSaved(row: SavedGuestRow): PartyGuest {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    address: row.address,
    nationality: row.nationality,
    documentType: row.document_type,
    documentNumber: row.document_number,
    purposeOfStay: row.purpose_of_stay,
    visaNumber: row.visa_number,
  };
}

/**
 * Що надіслати писачеві: збережені плюс названі щойно.
 *
 * Порядок — збережені як були, нові в кінець: перший вписаний лишається
 * первинним гостем броні (`is_primary`), і другий натиск не міняє, на кого
 * виписаний Meldeschein.
 *
 * Запис без імені або без прізвища відкидається мовчки: писач на такому
 * кидає виняток, і один недописаний рядок завалив би реєстрацію всієї
 * сімʼї — разом із тими, хто вже стояв у базі.
 */
export function mergeParty(saved: SavedGuestRow[], incoming: unknown[]): PartyGuest[] {
  const out: PartyGuest[] = [];
  const at = new Map<string, number>();

  for (const row of saved) {
    const g = fromSaved(row);
    if (!text(g.firstName) || !text(g.lastName)) continue;
    at.set(personKey(g), out.length);
    out.push(g);
  }

  for (const raw of incoming) {
    const src = (raw ?? {}) as Record<string, unknown>;
    const firstName = text(src.firstName);
    const lastName = text(src.lastName);
    if (!firstName || !lastName) continue;

    const next: PartyGuest = {
      firstName,
      lastName,
      dateOfBirth: orNull(src.dateOfBirth),
      address: orNull(src.address),
      nationality: orNull(src.nationality),
      documentType: orNull(src.documentType),
      documentNumber: orNull(src.documentNumber),
      purposeOfStay: orNull(src.purposeOfStay),
      visaNumber: orNull(src.visaNumber),
    };

    const seen = at.get(personKey(next));
    if (seen === undefined) {
      at.set(personKey(next), out.length);
      out.push(next);
      continue;
    }
    // Той самий гість удруге: нове значення перемагає, порожнє — лишає старе.
    const was = out[seen];
    out[seen] = {
      firstName, lastName,
      dateOfBirth: next.dateOfBirth ?? was.dateOfBirth ?? null,
      address: next.address ?? was.address ?? null,
      nationality: next.nationality ?? was.nationality ?? null,
      documentType: next.documentType ?? was.documentType ?? null,
      documentNumber: next.documentNumber ?? was.documentNumber ?? null,
      purposeOfStay: next.purposeOfStay ?? was.purposeOfStay ?? null,
      visaNumber: next.visaNumber ?? was.visaNumber ?? null,
    };
  }

  return out;
}
