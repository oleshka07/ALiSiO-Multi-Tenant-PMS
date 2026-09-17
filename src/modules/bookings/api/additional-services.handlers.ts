/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { requestPropertyScope } from '@core/auth/property-scope';
import { getSql } from '@core/db/async';
import { withActor, withPermission } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { CONTENT_COLUMN_LANGS } from '@core/i18n/content-field';
import { extractServiceTexts, translateAndStore } from '@core/i18n/translate';
import { listServicesOf } from '../data/lists.repo';
import { handleError } from '@core/http/errors';

/**
 * `additional_services` has no organization column — it reaches the tenant
 * through `property_id → properties`, exactly like `price_calendar` does
 * through `unit_types`. Postgres has a policy that says so; SQLite has none,
 * and SQLite is where development, demos and the .check.ts files run. Named in
 * the SQL as well, so both databases give the same answer.
 */
const OWNED = 'property_id IN (SELECT id FROM properties WHERE organization_id = ?)';

/**
 * Колонки мов, які довідник послуг приймає й зберігає, — з РЕЄСТРУ, не списком
 * поруч.
 *
 * Тут стояло три імені руками: `name_en`, `name_cs`, `name_de`. Колонок у
 * таблиці вісімнадцять (три поля × шість мов), і решта пʼятнадцять не мали
 * писача взагалі — тобто польський, нідерландський і французький гість не мав
 * шансу побачити свою мову, хоч би скільки її перекладали. Мовчки: колонка є,
 * форма її не питає, запит її не пише, екран її не знаходить.
 */
const CONTENT_FIELDS = ['name', 'description', 'unit_label'] as const;
const LANG_COLUMNS: string[] = CONTENT_FIELDS
  .flatMap((field) => CONTENT_COLUMN_LANGS.map((code) => `${field}_${code}`));

/**
 * Перекласти те, що готель щойно написав, — у тлі, як це робить збереження
 * гостьової сторінки.
 *
 * Це ЄДИНЕ місце, де назви послуг узагалі потрапляють у `content_translations`.
 * Доти таблицю наповнювало лише збереження конфігурації сторінки, а читання
 * (`extractServiceTexts` у гостьовому порталі) питало її про назви послуг — і
 * діставало порожньо завжди, бо писати їх туди не було кому.
 *
 * У тлі й з проковтнутою помилкою навмисно: збереження послуги не має падати
 * від того, що в OpenAI закінчилась квота. Без ключа функція просто нічого не
 * робить — і тоді лишаються колонки мов, заповнені руками.
 */
function translateInBackground(service: unknown, organizationId: string): void {
  const texts = extractServiceTexts([service]);
  if (texts.length === 0) return;
  translateAndStore(texts, false, organizationId)
    .catch((e) => console.error('[translate] послуга:', (e as Error)?.message));
}

export const listAdditionalServices = withActor(async (request, _ctx, actor) => {
  try {
    // Який ОБʼЄКТ, а не лише який орендар (INC-029): послуга продається в
    // конкретному будинку і має там свою ціну. Запит — у `data/lists.repo.ts`,
    // щоб на нього можна було написати сцену: `withActor` кличе `cookies()`.
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json(await listServicesOf(actor.organizationId, scope));
  } catch (error: any) {
    // Названа відмова їде своїм статусом (інваріант 6, Ц43). Тут це не
    // дрібниця: чужий `property_id` кидає `PropertyNotFound` — 404, — і
    // глухий 500 перетворював «не той будинок» на «сервер зламався».
    return handleError('modules/bookings/api/additional-services listAdditionalServices', error);
  }
});

/** The three roles fin_tax_rates knows. A service points at one, never at a number. */
const isTaxCode = (v: unknown): boolean =>
  typeof v === 'string' && ['standard', 'reduced', 'zero'].includes(v);


/**
 * Запис нового рядка довідника.
 *
 * Винесено з хендлера ІМЕНОВАНОЮ функцією рівно з тієї причини, що в
 * `list-export-scope.check`: `withPermission` кличе `cookies()` з
 * `next/headers`, а той поза запитом Next кидає — тобто загорнутий маршрут
 * неможливо покликати з `.check.ts` під голим node. А покликати треба:
 * список колонок тут ДИНАМІЧНИЙ (скільки мов заповнено, стільки й слотів),
 * і помилка на одиницю в ньому — це 500 на кожне створення послуги, якого
 * не бачить ні `tsc` (SQL це рядок), ні `check-dialect` (він читає, не
 * виконує).
 */
export async function writeNewService(
  id: string, propertyId: string, body: Record<string, any>,
): Promise<void> {
  const sql = getSql();
  // Колонки мов — списком із реєстру, а не трьома іменами руками. Порядок
  // тут і порядок значень нижче беруться з ОДНОГО масиву, тож розійтись
  // вони не можуть.
  //
  // Порожнє значення пропускається: форма шле `''` за кожне поле, якого не
  // торкались, і порожній рядок у колонці читається як відповідь тим, хто не
  // подивиться (див. четвертий злом `content-field.check`).
  const langCols = LANG_COLUMNS.filter((c) => body[c] != null && String(body[c]).trim() !== '');
  await sql.run(`
    INSERT INTO additional_services (id, property_id, name, description, price, currency, unit_label, icon, category, available_for, is_active, sort_order, service_type, duration_minutes, vat_code${langCols.map((c) => `, ${c}`).join('')})
    -- Валюта послуги, коли її не назвали, — валюта готелю, а не 'CZK'.
    --
    -- Тут стояв літерал, і ціна сніданку німецького готелю ставала «12 CZK»
    -- на гостьовій сторінці: саме це поле показує гість у списку послуг,
    -- у кошику і в листі про покинутий кошик.
    VALUES (?, ?, ?, ?, ?,
      COALESCE(?, (SELECT o.default_currency FROM organizations o JOIN properties p ON p.organization_id = o.id WHERE p.id = ?)),
      ?, ?, ?, ?, TRUE, ?, ?, ?, ?${langCols.map(() => ', ?').join('')})
  `, [id,
    propertyId,
    body.name || '', body.description || '',
    body.price || 0, body.currency || null, propertyId, body.unit_label || '',
    body.icon || '✨', body.category || 'other', body.available_for || 'all',
    body.sort_order || 99, body.service_type || 'simple',
    body.duration_minutes || null,
    // The tax ROLE this service carries. Left null when nobody said, and a
    // service with null is refused when it reaches a folio rather than
    // invoiced at a rate we picked for the hotel.
    isTaxCode(body.vat_code) ? body.vat_code : null,
    ...langCols.map((c) => String(body[c]).trim())]);
}

export const createAdditionalService = withPermission('manage_properties', async (request: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const id = 'svc_' + Date.now().toString(36);
    const propertyId = await requirePropertyId(body.property_id);
    await writeNewService(id, propertyId, body);
    const created = await sql.row<any>('SELECT * FROM additional_services WHERE id = ?', [id]);
    translateInBackground(created, actor.organizationId);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
});

export const updateAdditionalService = withPermission('manage_properties', async (request: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // The id comes from the request body. `manage_properties` says the caller
    // may edit services — it does not say whose. Answered 404, so a foreign id
    // and a missing one read the same from outside.
    const owned = await sql.row<any>(
      `SELECT id FROM additional_services WHERE id = ? AND ${OWNED}`,
      [body.id, actor.organizationId],
    );
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const fields = [
      'name', 'description', 'price', 'currency', 'unit_label',
      'icon', 'category', 'available_for', 'is_active', 'sort_order',
      'service_type', 'duration_minutes', 'vat_code',
      ...LANG_COLUMNS,
    ];
    const sets: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        // A tax role outside the three is refused rather than stored: it would
        // silently never match a rate, and the service would look configured.
        if (f === 'vat_code' && body[f] != null && body[f] !== '' && !isTaxCode(body[f])) continue;
        sets.push(`${f} = ?`);
        values.push(f === 'vat_code' && !body[f] ? null : body[f]);
      }
    }
    if (sets.length > 0) {
      values.push(body.id, actor.organizationId);
      await sql.run(`UPDATE additional_services SET ${sets.join(', ')} WHERE id = ? AND ${OWNED}`, [...values]);
    }
    const updated = await sql.row<any>(
      `SELECT * FROM additional_services WHERE id = ? AND ${OWNED}`,
      [body.id, actor.organizationId],
    );
    translateInBackground(updated, actor.organizationId);
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
});

export const deleteAdditionalService = withPermission('manage_properties', async (request: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const info = await sql.run(
      `DELETE FROM additional_services WHERE id = ? AND ${OWNED}`,
      [id, actor.organizationId],
    );
    // Nothing deleted means the service was not this hotel's (or is already
    // gone). `{ ok: true }` for a delete that deleted nothing is how a hole
    // stays invisible.
    if (info.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
});
