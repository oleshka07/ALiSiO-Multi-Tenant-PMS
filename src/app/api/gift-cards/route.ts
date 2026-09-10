import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { getSql } from '@core/db/async';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { requestPropertyScope } from '@core/auth/property-scope';
import { ALL_PROPERTIES, oneProperty, propertyScopeFilter, type PropertyScope } from '@core/property-scope';
import { handleError } from '@core/http/errors';
import { refuse } from '@core/http/refusal';
import { buildGiftCode, getGiftCardTemplate, calcExpiresAt, listGiftCardTemplates } from '@/modules/widget/domain/gift-card-builder';
import { organizationCurrency } from '@core/currency';

/**
 * Gift cards / vouchers.
 *
 * These routes never established who was calling: any logged-in user of any
 * hotel could list every hotel's vouchers with their buyer names and emails,
 * and mint new ones against any property_id they cared to send. The list
 * started from `WHERE 1=1`, and the auto-expire sweep updated every hotel's
 * rows at once.
 *
 * ── Вісь ОБʼЄКТА, і чому її не було видно (INC-029, 09.09.2026) ─────────
 *
 * Коментар вище описує полагоджену половину — ОРЕНДАРЯ, — і саме тому друга
 * половина прожила: `gift_cards.property_id` — `NOT NULL`, тобто ваучер
 * заведено ПІД БУДИНОК, а список звіряв лише рахунок.
 *
 * Обмеження в коді БУЛО, і воно ж було шпариною: `propertyId` читався з адреси
 * і вставлявся у фільтр без жодної перевірки власності. Чужий обʼєкт давав
 * ПОРОЖНІЙ список замість 404 (інваріанти 5 і 13), а слово `all`, яким
 * провайдер області пише «усі обʼєкти», приїхало б у фільтр як ідентифікатор
 * і дало б порожньо теж (Д49). Плюс розкол імен: читалось `propertyId`, тоді
 * як решта чотирнадцяти екранів шлють `property_id` (NAMING §8) — рівно той
 * шов, через який правка INC-037 без маршруту нічого б не змінила.
 */

/**
 * Область для списку: або сказана параметром, або взята від САЙТА.
 *
 * Два входи, бо екран ваучерів живе вкладкою сайта і питає `site_id`, а не
 * `property_id`. Сайт належить одному будинку (`booking_sites.property_id` —
 * `NOT NULL`), тож він називає обʼєкт точніше за перемикач у шапці; але
 * називає лише тоді, коли доведено, що сайт наш. Раніше тут стояв підзапит
 * `(SELECT property_id FROM booking_sites WHERE id = ?)` без орендаря: чужий
 * сайт давав порожній список — не помилку, а «ваучерів немає».
 */
async function listScope(req: Request, actor: Actor): Promise<PropertyScope> {
  const siteId = new URL(req.url).searchParams.get('site_id');
  if (!siteId) return requestPropertyScope(req, actor.organizationId);

  const site = await getSql().row<{ property_id: string }>(
    'SELECT property_id FROM booking_sites WHERE id = ? AND organization_id = ?',
    [siteId, actor.organizationId],
  );
  // 404, не порожній список: «такого сайту немає» і «ваучерів немає» — різні
  // відповіді, і саме їх злиття робить вісь непомітною.
  if (!site) refuse('Site not found', 404);
  return oneProperty(site.property_id);
}

/**
 * Тіло `GET` іменованою функцією — щоб його могла покликати сцена.
 *
 * Загорнутий маршрут із `.check.ts` недосяжний за побудовою: `withPermission`
 * кличе `currentActor()`, той — `cookies()` з `next/headers`, і поза запитом
 * Next це КИДАЄ. Той самий рух уже зроблено в `bookings/export-csv`,
 * `invoices/export` і `accounting/invoices/list` — і робиться саме тому, що
 * твердження про вісь мусить бути про МАРШРУТ, а не про запит, переписаний у
 * перевірку з памʼяті.
 */
export async function listGiftCards(req: Request, _ctx: unknown, actor: Actor) {
  try {
    const sql = getSql();
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search') || '';

    const axis = propertyScopeFilter(await listScope(req, actor), 'v');

    let statement = `
      SELECT v.*,
             r.check_in, r.check_out, r.unit_id
      FROM gift_cards v
      LEFT JOIN reservations r ON v.reservation_id = r.id
      WHERE v.organization_id = ? AND ${axis.sql}
    `;
    const params: (string | number)[] = [actor.organizationId, ...axis.params];

    if (status && status !== 'all') {
      statement += ' AND v.status = ?';
      params.push(status);
    }
    if (search) {
      statement += ' AND (v.code LIKE ? OR v.name LIKE ? OR v.recipient_name LIKE ? OR v.buyer_name LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    statement += ' ORDER BY v.created_at DESC';

    const giftCards = await sql.rows(statement, params);

    // Auto-expire: оновити статус прострочених ваучерів
    // UTC, because that is what SQLite's date('now') returned here.
    //
    // Осі обʼєкта тут немає СВІДОМО: строк ваучера — властивість дати, а не
    // будинку. Ваучер обʼєкта Б простроченим є й тоді, коли відкрито вкладку
    // обʼєкта А, і звузити цей UPDATE означало б лишати прострочені рядки
    // «активними» доти, доки хтось не гляне саме на їхній будинок.
    const today = new Date().toISOString().slice(0, 10);
    await sql.run(`
      UPDATE gift_cards SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ?
        AND status IN ('active', 'paid')
        AND expires_at IS NOT NULL
        AND expires_at < ?
    `, [actor.organizationId, today]);

    // Шаблони ЦЬОГО готелю. Раніше сюди йшла спільна константа, тобто прайс
    // одного кемпінгу віддавався кожному, хто відкриє екран.
    //
    // Ключ `giftCards`, а не `gift_cards`: решта родини (`POST`, `[id]`,
    // `activate`) віддає `giftCard`, і ЄДИНИЙ читач цієї відповіді
    // (`SiteGiftCardsTab.tsx:78`) читає `d.giftCards`. Тобто список ваучерів
    // на вкладці сайта не показував НІЧОГО й ніколи — і лічильник на самій
    // вкладці лишався нулем, бо `onCountChange` кличеться з тієї ж гілки.
    // Знайдено при переведенні осі; `check-dead-fetch` цього роду не бачить —
    // він стереже виклик без читача, а не читача, що бере не той ключ.
    return NextResponse.json({
      giftCards,
      templates: await listGiftCardTemplates(actor.organizationId),
    });
  } catch (err: unknown) {
    // `handleError`, а не глухий 500: `PropertyNotFound` і відмова «сайт не
    // наш» — це названі 404, і вони мусять доїхати своїм статусом (Ц43).
    return handleError('gift-cards GET', err, 'Failed to fetch gift cards');
  }
}

export const GET = await withPermission('manage_bookings', listGiftCards);

// POST /api/gift-cards — створити ваучер
export const POST = await withPermission('manage_bookings', async (req: Request, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const body = await req.json();
    let { property_id } = body;
    const {
      site_id,
      template_id,
      name,
      type,
      value_type,
      face_value,
      currency,
      recipient_name,
      recipient_email,
      buyer_name,
      buyer_email,
      buyer_phone,
      message,
      expires_at,
      config_json,
      notes,
      status = 'active',
    } = body;

    // Resolve site_id to property_id if property_id is not directly provided
    if (!property_id && site_id) {
      const site = await sql.row<{ property_id: string }>(`
        SELECT s.property_id FROM booking_sites s
        JOIN properties p ON p.id = s.property_id
        WHERE s.id = ? AND p.organization_id = ?
      `, [site_id, actor.organizationId]);
      if (site) property_id = site.property_id;
    }

    // The property_id arrives in the request body, so it is verified against
    // the session's organization rather than trusted.
    try {
      property_id = await requirePropertyId(property_id);
    } catch (e: unknown) {
      return handleError('gift-cards POST', e);
    }

    // Визначаємо параметри з шаблону або з тіла запиту
    const tpl = template_id ? await getGiftCardTemplate(actor.organizationId, template_id) : null;
    const resolvedName = name || tpl?.name || 'Ваучер';
    const resolvedType = type || tpl?.type || 'open_date';
    const resolvedValueType = value_type || tpl?.value_type || 'fixed_czk';
    const resolvedFaceValue = face_value ?? tpl?.face_value ?? 0;
    // Валюта готелю, якщо не сказали інше — не крони.
    //
    // `tpl?.currency` приходить із GIFT_CARD_TEMPLATES: шість шаблонів із
    // цінами й валютами ОДНОГО клієнта (див. нотатку в
    // modules/widget/domain/gift-card-builder.ts). Поки вони там, вони
    // виграють у цьому виразі; коли шаблони стануть даними готелю, лишиться
    // тільки те, що вибрав оператор, і валюта його готелю.
    const resolvedCurrency = currency || tpl?.currency || await organizationCurrency(actor.organizationId);
    const resolvedConfig = config_json ?? tpl?.config_json ?? {};
    const resolvedExpires = expires_at
      || (tpl ? calcExpiresAt(tpl.validityMonths) : calcExpiresAt(12));

    // Генерація коду. It only has to be unique inside this organization —
    // a code is redeemed on one hotel's site, and two hotels may both issue
    // the same string.
    //
    // Але ПО ВСІХ ОБʼЄКТАХ рахунку, і це сказано словом, а не пропущено.
    // Звузити перевірку будинком означало б дозволити двом будинкам одного
    // готелю видати однаковий код: гість приносить його на рецепцію, а вона
    // знаходить два ваучери з різними номіналами і не має як обрати. Унікальність
    // тут — властивість рахунку, бо погашення шукає код саме по рахунку.
    const ACROSS_PROPERTIES = propertyScopeFilter(ALL_PROPERTIES, 'v');
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = buildGiftCode();
      const existing = await sql.row(
        `SELECT v.id FROM gift_cards v WHERE v.code = ? AND v.organization_id = ? AND ${ACROSS_PROPERTIES.sql}`,
        [candidate, actor.organizationId, ...ACROSS_PROPERTIES.params],
      );
      if (!existing) { code = candidate; break; }
    }
    if (!code) {
      return NextResponse.json({ error: 'Failed to generate unique giftCard code' }, { status: 500 });
    }

    // RETURNING * rather than RETURNING id plus a SELECT: the row it hands back
    // is the row that was just written, defaults and all.
    const gift_card = await sql.row(`
      INSERT INTO gift_cards (
        organization_id, property_id, code, template_id, name, type, value_type,
        face_value, currency, status,
        recipient_name, recipient_email,
        buyer_name, buyer_email, buyer_phone,
        message, expires_at, config_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      actor.organizationId, property_id, code, template_id || 'custom', resolvedName,
      resolvedType, resolvedValueType, resolvedFaceValue, resolvedCurrency,
      status, recipient_name || null, recipient_email || null,
      buyer_name || null, buyer_email || null, buyer_phone || null,
      message || null, resolvedExpires, JSON.stringify(resolvedConfig), notes || null,
    ]);
    return NextResponse.json({ giftCard: gift_card }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/gift-cards error:', message);
    return NextResponse.json({ error: 'Failed to create gift card' }, { status: 500 });
  }
});
