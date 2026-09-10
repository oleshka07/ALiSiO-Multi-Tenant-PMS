/**
 * «Схоже, це одна людина» — ПРОПОЗИЦІЯ злиття, ніколи не саме злиття (INC-303).
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * `mergeGuests(keepId, dropId)` вимагає, щоб хтось назвав пару. На імпорті
 * 34 795 адрес такого «хтось» немає, а в щоденній роботі дублікати робить
 * портьє. Тут — шукач кандидатів; рішення лишається за людиною.
 *
 * ── Чому НЕ автоматичне злиття ──────────────────────────────────────────
 *
 * Злиття двох різних людей незворотне і виявляється на видачі чужої фактури.
 * Тому цей файл не має жодного `UPDATE`: він лише читає й пропонує.
 *
 * ── Пошта САМА ПО СОБІ — не ознака, і це суперечність із планом ─────────
 *
 * `IMPORT-PLAN.md` §2.7 каже: «однаковий `E_MAIL` (не порожній) → один гість».
 * Це неправильно для готелю, який приймає СІМʼЇ: подружжя і діти живуть під
 * однією поштою, і за цим правилом вони стали б однією людиною. Тому пошта
 * тут працює лише В ПАРІ з іменем, а суперечність названа у звіті, а не
 * вирішена мовчки.
 *
 * ── Чого тут немає навмисно ─────────────────────────────────────────────
 *
 * Відстані редагування («схожі прізвища») немає: на німецьких прізвищах вона
 * дає сотні хибних пар, і робити її без ВИМІРЮВАННЯ заборонено задачею. Коли
 * зʼявиться свіжий витяг — `scripts/winhotel-duplicate-signals.mjs` порахує,
 * скільки пар дає кожна ознака окремо, і тоді про неї можна буде говорити.
 *
 * ── Нормалізація імені — не здогад ──────────────────────────────────────
 *
 * Winhotel сам тримає `SUCHNAME` у складеному вигляді: `Müller-Stub` там
 * лежить як `MUELLER-STUB` (видно в живому витягу). Тобто згортання умлаутів —
 * поведінка ДЖЕРЕЛА, а не наша вигадка, і ми повторюємо саме її.
 */
import { getSql } from '@core/db/async';

/**
 * Наскільки впевнена пара. Порядок — від найсильнішого.
 *
 * `document` перший, бо номер документа — це ідентифікатор особи, а не її
 * контакт: двоє людей із одним номером паспорта не бувають.
 */
export type DuplicateTier = 'document' | 'email_and_name' | 'phone_and_name' | 'name_and_dob' | 'name_only';

/** Пари, які можна показувати як «майже напевно одне»; решта — на око. */
export const STRONG_TIERS: readonly DuplicateTier[] = ['document', 'email_and_name', 'phone_and_name', 'name_and_dob'];

export interface DuplicateCandidate {
  keepId: string;
  dropId: string;
  tier: DuplicateTier;
  /** Речення для людини: що саме збіглося. */
  says: string;
}

/** `Müller-Stub` → `MUELLER-STUB`, як це робить саме джерело. */
export function searchName(first: string | null, last: string | null): string {
  const raw = `${last ?? ''} ${first ?? ''}`;
  return raw
    .toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/[^A-ZА-ЯЇІЄҐ0-9]+/g, ' ')
    .trim();
}

interface GuestRow {
  id: string; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; date_of_birth: string | null;
  document_type: string | null; document_number: string | null;
}

const clean = (v: string | null) => (v ?? '').trim().toLowerCase();
const digits = (v: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Кандидати на злиття серед ЖИВИХ гостей рахунку.
 *
 * Порівняння в памʼяті, не в SQL: ознак пʼять, і кожна вимагає своєї
 * нормалізації (умлаути, лише цифри телефону, регістр пошти). Робити це
 * діалектним SQL означало б п'ять різних запитів на двох рушіях; на 35 тисячах
 * рядків один прохід у памʼяті дешевший за це і, головне, читається.
 */
export async function guestDuplicateCandidates(organizationId: string): Promise<DuplicateCandidate[]> {
  const sql = getSql();
  const rows = await sql.rows<GuestRow>(
    `SELECT id, first_name, last_name, email, phone, date_of_birth, document_type, document_number
       FROM guests
      WHERE organization_id = ? AND merged_into IS NULL
      ORDER BY id`,
    [organizationId]);

  const found = new Map<string, DuplicateCandidate>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  /** Згрупувати за ключем і видати пари — з рангом, який не перебиває сильніший. */
  const group = (key: (g: GuestRow) => string | null, tier: DuplicateTier, says: (g: GuestRow) => string) => {
    const buckets = new Map<string, GuestRow[]>();
    for (const g of rows) {
      const k = key(g);
      if (!k) continue;
      const list = buckets.get(k);
      if (list) list.push(g); else buckets.set(k, [g]);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const k = pairKey(list[i].id, list[j].id);
          const already = found.get(k);
          // Перший, хто знайшов пару, і є найсильнішим: групи йдуть за рангом.
          if (already) continue;
          found.set(k, { keepId: list[i].id, dropId: list[j].id, tier, says: says(list[i]) });
        }
      }
    }
  };

  const name = (g: GuestRow) => searchName(g.first_name, g.last_name) || null;

  group((g) => (clean(g.document_number) && clean(g.document_type)
    ? `${clean(g.document_type)}#${clean(g.document_number)}` : null),
  'document', (g) => `той самий документ ${g.document_type} ${g.document_number}`);

  // Пошта ЛИШЕ в парі з іменем — сімʼя під однією поштою не одна людина.
  group((g) => (clean(g.email) && name(g) ? `${clean(g.email)}#${name(g)}` : null),
    'email_and_name', (g) => `та сама пошта ${g.email} і те саме імʼя`);

  group((g) => (digits(g.phone).length >= 6 && name(g) ? `${digits(g.phone)}#${name(g)}` : null),
    'phone_and_name', (g) => `той самий телефон ${g.phone} і те саме імʼя`);

  group((g) => (clean(g.date_of_birth) && name(g) ? `${clean(g.date_of_birth)}#${name(g)}` : null),
    'name_and_dob', (g) => `те саме імʼя і дата народження ${g.date_of_birth}`);

  // Найслабша: саме лише імʼя. Ніколи не «майже напевно» — однофамільці бувають.
  group((g) => name(g), 'name_only', (g) => `лише те саме імʼя (${searchName(g.first_name, g.last_name)})`);

  return [...found.values()];
}
