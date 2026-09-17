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
 * ── Мова ────────────────────────────────────────────────────────────────
 *
 * Тут віддається СИРОВИНА, а не готове слово: базова колонка, заповнені
 * колонки мов і кеш перекладів. Приводить їх до мови гостя екран —
 * `localisedContent` з `@core/i18n/content-field`, ті самі двері, що на
 * гостьовій сторінці.
 *
 * Чому не на сервері: перемикач мови в цьому застосунку живе в шапці й
 * видимий НА КОЖНОМУ кроці, зокрема на кроці послуг. Гість, який перемкнув
 * мову, стоячи над кошиком, мусить побачити зміну негайно — а список послуг
 * уже лежить у стані екрана. Приведення на сервері означало б або повторний
 * пошук вільних номерів заради назви сніданку, або застиглий німецький
 * список під чеськими кнопками.
 *
 * Колонки їдуть лише ЗАПОВНЕНІ (`pickContentColumns`): шість порожніх на
 * кожне з трьох полів — це 18 порожніх рядків на послугу в кожній відповіді,
 * і, гірше, порожній рядок у колонці читається як відповідь тим, хто не
 * подивиться (саме це стереже четвертий злом гейта дверей).
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
import { CONTENT_COLUMN_LANGS, contentColumns, pickContentColumns } from '@core/i18n/content-field';
import { getStoredTranslations, type StoredTranslations } from '@core/i18n/translate';
import { money } from '@core/money';

export interface GuestService extends Record<string, unknown> {
  id: string;
  /** Текст ГОТЕЛЮ, його мовою. Колонки мов їдуть поруч, окремими ключами. */
  name: string;
  description: string | null;
  /** Ціна за ОДИНИЦЮ. Скільки одиниць — вирішує гість. */
  price: number;
  currency: string;
  /**
   * «за особу/добу», «за добу» — текст готелю, не наш переказ.
   *
   * Імʼя ЗМІЇНЕ, як колонка, і це не недогляд: поруч їдуть `unit_label_cs`,
   * `unit_label_de` і решта, і двері шукають їх як `${поле}_${мова}`. Камельне
   * `unitLabel` означало б два імені на одну колонку — а далі когось потягне
   * додати `unitLabelCs`, і мови розійдуться з рештою.
   */
  unit_label: string;
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
): Promise<{ services: GuestService[]; translations: StoredTranslations }> {
  const sql = getSql();
  const rows = await sql.rows<Record<string, unknown>>(
    `SELECT s.id, s.name, s.description, s.price, s.currency, s.unit_label, s.category,
            ${contentColumns('s', 'name')},
            ${contentColumns('s', 'description')},
            ${contentColumns('s', 'unit_label')}
       FROM additional_services s
       JOIN properties p ON p.id = s.property_id
      WHERE s.property_id = ? AND p.organization_id = ?
        AND s.is_active = TRUE AND s.bookable_online = TRUE
      ORDER BY s.sort_order, s.name`,
    [propertyId, organizationId]);

  const out: GuestService[] = [];
  const texts = new Set<string>();
  for (const r of rows) {
    const rowCurrency = String(r.currency ?? '');
    if (currency && rowCurrency && rowCurrency !== currency) {
      console.error('[guest-app] послуга у валюті, відмінній від котирування — не показана',
        r.id, rowCurrency, currency);
      continue;
    }
    // Кеш питаємо лише про те, чого НЕ покривають колонки. Поле, у якого
    // заповнені всі шість мов, у кеші шукати нема чого: двері до нього не
    // дійдуть ніколи. `getStoredTranslations` робить запит НА КОЖЕН текст, і
    // готель, у якого все заповнено (Ґрайц), інакше платив би пʼятнадцятьма
    // зайвими запитами за кожен показ вітрини.
    const filled = {
      name: pickContentColumns(r, 'name'),
      description: pickContentColumns(r, 'description'),
      unit_label: pickContentColumns(r, 'unit_label'),
    };
    for (const field of ['name', 'description', 'unit_label'] as const) {
      if (Object.keys(filled[field]).length === CONTENT_COLUMN_LANGS.length) continue;
      const base = String(r[field] ?? '').trim();
      if (base.length > 1) texts.add(base);
    }
    out.push({
      id: String(r.id),
      name: String(r.name ?? ''),
      description: r.description == null ? null : String(r.description),
      price: Number(r.price),
      currency: rowCurrency,
      unit_label: String(r.unit_label ?? ''),
      category: String(r.category ?? ''),
      ...filled.name,
      ...filled.description,
      ...filled.unit_label,
    });
  }

  // Кеш — одним походом на всі тексти разом, і лише коли є про що питати.
  // Порожній список тут коштував би запиту на кожен показ порожньої вітрини.
  const translations = texts.size > 0
    ? await getStoredTranslations([...texts]).catch((e) => {
      // Кеш — прикраса, а не умова: готель без жодного перекладу мусить
      // показати послуги СВОЄЮ мовою, а не порожній крок.
      console.error('[guest-app] кеш перекладів не прочитався', (e as Error)?.message);
      return {} as StoredTranslations;
    })
    : {};

  return { services: out, translations };
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
