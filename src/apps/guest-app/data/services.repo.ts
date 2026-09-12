/**
 * Що готель продає гостю на кроці бронювання — і чому це НЕ весь довідник.
 *
 * ── Довідник послуг це список нарахувань, а не вітрина ──────────────────
 *
 * У живого готелю в `additional_services` поруч зі сніданком і гаражем
 * лежать «втрачений ключ», «штраф за скасування», «неприїзд», «телефон
 * 0,20», «копія 0,10» і «знижка 10 %». Усі активні — рецепція справді ними
 * нараховує. Показати цей список гостю означало б запропонувати йому купити
 * штраф за власний неприїзд.
 *
 * Тому продається лише НАЗВАНЕ: `bookable_online` (0417), та сама ознака й
 * те саме слово, що в номерів. Дефолт порожній, тож жоден наявний готель не
 * почав продавати нічого від самої міграції.
 *
 * ── Валюта ──────────────────────────────────────────────────────────────
 *
 * Послуга з валютою, відмінною від валюти котирування, не показується: її
 * суму нема як додати до суми номера, а показати два числа в різних валютах
 * і назвати це підсумком — гірше, ніж не показати послугу. Це не тихий
 * пропуск: рядок іде в лог, бо це помилка налаштування готелю, а не
 * властивість гостя.
 */
import { getSql } from '@core/db/async';
import { money } from '@core/money';

export interface GuestService {
  id: string;
  name: string;
  description: string | null;
  /** Ціна за ОДИНИЦЮ. Скільки одиниць — вирішує гість. */
  price: number;
  currency: string;
  /** «за особу/добу», «за добу» — текст готелю, не наш переказ. */
  unitLabel: string;
  category: string;
}

/**
 * Послуги цього обʼєкта, які готель дозволив продавати онлайн.
 *
 * Кличеться ВСЕРЕДИНІ `runWithOrganization`; орендар названий і в запиті —
 * на SQLite політик немає, а SQLite це вся розробка (рід INC-014).
 */
export async function bookableServices(
  organizationId: string, propertyId: string, currency: string,
): Promise<GuestService[]> {
  const sql = getSql();
  const rows = await sql.rows<{
    id: string; name: string; description: string | null; price: number;
    currency: string; unit_label: string; category: string;
  }>(
    `SELECT s.id, s.name, s.description, s.price, s.currency, s.unit_label, s.category
       FROM additional_services s
       JOIN properties p ON p.id = s.property_id
      WHERE s.property_id = ? AND p.organization_id = ?
        AND s.is_active = TRUE AND s.bookable_online = TRUE
      ORDER BY s.sort_order, s.name`,
    [propertyId, organizationId]);

  const out: GuestService[] = [];
  for (const r of rows) {
    if (currency && r.currency && r.currency !== currency) {
      console.error('[guest-app] послуга у валюті, відмінній від котирування — не показана',
        r.id, r.currency, currency);
      continue;
    }
    out.push({
      id: r.id, name: r.name, description: r.description,
      price: Number(r.price), currency: r.currency,
      unitLabel: r.unit_label, category: r.category,
    });
  }
  return out;
}

/** Одна позиція вибору гостя: що і скільки. */
export interface ServicePick {
  serviceId: string;
  quantity: number;
}

/**
 * Перевірити вибір гостя і порахувати суму — ЦІНОЮ З БАЗИ.
 *
 * Ціни в тілі запиту немає й тут: сума рахується з рядка довідника. Поле,
 * яке приймають і звіряють, рано чи пізно звіряють не з тим.
 *
 * Послуга, якої немає, чужа, вимкнена або не продажна онлайн, — просто не
 * потрапляє у відповідь. Це не мовчазний пропуск: викликач порівнює
 * кількість, і розбіжність для нього — названа відмова.
 */
export async function priceServices(
  organizationId: string, propertyId: string, picks: readonly ServicePick[],
): Promise<{ lines: Array<{ serviceId: string; quantity: number; total: number }>; total: number }> {
  if (picks.length === 0) return { lines: [], total: 0 };
  const sql = getSql();
  const holes = picks.map(() => '?').join(', ');
  const rows = await sql.rows<{ id: string; price: number }>(
    `SELECT s.id, s.price
       FROM additional_services s
       JOIN properties p ON p.id = s.property_id
      WHERE s.property_id = ? AND p.organization_id = ?
        AND s.is_active = TRUE AND s.bookable_online = TRUE
        AND s.id IN (${holes})`,
    [propertyId, organizationId, ...picks.map((p) => p.serviceId)]);

  const priceById = new Map(rows.map((r) => [String(r.id), Number(r.price)]));
  const lines: Array<{ serviceId: string; quantity: number; total: number }> = [];
  let total = 0;
  for (const pick of picks) {
    const price = priceById.get(pick.serviceId);
    if (price === undefined) continue;
    // Округлення на позиції, не на підсумку: так рахують гроші всюди в
    // цьому проєкті (інваріант 9), і так само вийде в рахунку.
    const line = money(price * pick.quantity);
    lines.push({ serviceId: pick.serviceId, quantity: pick.quantity, total: line });
    total += line;
  }
  return { lines, total: money(total) };
}
