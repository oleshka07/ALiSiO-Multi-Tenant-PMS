import { NextRequest, NextResponse } from 'next/server';
import * as amenities from '../data/amenities.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { serverError, handleError } from '@core/http/errors';

/**
 * Зручності: каталог організації і матриця призначення.
 *
 * Читання — будь-якому, хто ввійшов (список зручностей бачить і рецепція в
 * картці номера); запис — `manage_properties`, бо це налаштування обʼєкта.
 *
 * Організація завжди з сесії. Ідентифікатори обʼєкта, типу і зручностей
 * приходять із тіла — і кожен перевіряється в репозиторії, а не тут: писач
 * один, і перевірка стоїть біля запису, а не біля кожного маршруту, який до
 * нього дійде.
 */

type IdParams = { params: Promise<{ id: string }> };

/** GET /api/amenities — каталог організації категоріями. */
export const listAmenities = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    // Готель, заведений до 0111, каталогу не має: досіваємо при першому
    // читанні екрана (див. ensureAmenityCatalog — вставка ідемпотентна).
    await amenities.ensureAmenityCatalog(actor.organizationId);
    return NextResponse.json(await amenities.amenityCatalog(actor.organizationId));
  } catch (error) {
    return serverError('modules/properties/api/amenities listAmenities', error);
  }
});

/** POST /api/amenities — своя зручність або свій розділ понад стартовий каталог. */
export const createAmenity = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();

    if (body.kind === 'category') {
      const made = await amenities.createAmenityCategory(actor.organizationId, {
        code: String(body.code ?? ''), name: String(body.name ?? ''),
      });
      if (!made) return NextResponse.json({ error: 'Розділ із таким кодом уже є, або код чи назва порожні' }, { status: 409 });
      return NextResponse.json(made, { status: 201 });
    }

    const made = await amenities.createAmenity(actor.organizationId, {
      categoryId: String(body.category_id ?? ''),
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      scope: body.scope,
      icon: body.icon ?? null,
    });
    // Один код на організацію: другий рядок «Сауна» розійдеться з першим у
    // мапінгу на канал, і зрозуміти це буде нізвідки.
    if (!made) return NextResponse.json({ error: 'Зручність із таким кодом уже є, або розділ не знайдено' }, { status: 409 });
    return NextResponse.json(made, { status: 201 });
  } catch (error) {
    return serverError('modules/properties/api/amenities createAmenity', error);
  }
});

/** GET /api/properties/[id]/amenities */
export const listPropertyAmenities = withActor(async (_req, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    return NextResponse.json(await amenities.propertyAmenities(actor.organizationId, id));
  } catch (error) {
    return serverError('modules/properties/api/amenities listPropertyAmenities', error);
  }
});

/**
 * PUT /api/properties/[id]/amenities — замінити НАБІР.
 *
 * Саме PUT і саме набором: PATCH по одній галочці означав би, що екран і база
 * розходяться на кожному невдалому запиті, і «зняв, а воно лишилось» ніхто б
 * не побачив.
 */
export const setPropertyAmenities = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const ids = Array.isArray(body.amenity_ids) ? body.amenity_ids.map(String) : null;
    if (!ids) return NextResponse.json({ error: 'amenity_ids has to be an array' }, { status: 400 });

    const saved = await amenities.setPropertyAmenities(actor.organizationId, id, ids);
    // Чужий обʼєкт, чужа зручність або зручність не тієї області — 404: чуже
    // існування теж відповідь (інваріант 5), а причину пише лог.
    if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(saved);
  } catch (error) {
    return serverError('modules/properties/api/amenities setPropertyAmenities', error);
  }
});

/** GET /api/unit-types/[id]/amenities */
export const listUnitTypeAmenities = withActor(async (_req, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    return NextResponse.json(await amenities.unitTypeAmenities(actor.organizationId, id));
  } catch (error) {
    return serverError('modules/properties/api/amenities listUnitTypeAmenities', error);
  }
});

/** PUT /api/unit-types/[id]/amenities — замінити НАБІР типу номера. */
export const setUnitTypeAmenities = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const ids = Array.isArray(body.amenity_ids) ? body.amenity_ids.map(String) : null;
    if (!ids) return NextResponse.json({ error: 'amenity_ids has to be an array' }, { status: 400 });

    const saved = await amenities.setUnitTypeAmenities(actor.organizationId, id, ids);
    if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(saved);
  } catch (error) {
    return serverError('modules/properties/api/amenities setUnitTypeAmenities', error);
  }
});

/**
 * GET /api/amenities/matrix — усе, що потрібно екрану призначення, одним разом.
 *
 * Обʼєкт береться з області оболонки (П10), а не з тіла: екран налаштувань
 * працює рівно з одним обʼєктом, і другий у відповіді означав би, що галочки
 * показуються не від того готелю.
 */
export const amenityMatrix = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(new URL(request.url).searchParams.get('property_id'));
    } catch (e) {
      return handleError('properties/amenities', e);
    }

    await amenities.ensureAmenityCatalog(actor.organizationId);
    const [catalog, onProperty] = await Promise.all([
      amenities.amenityCatalog(actor.organizationId),
      amenities.propertyAmenities(actor.organizationId, propertyId),
    ]);
    return NextResponse.json({
      propertyId,
      catalog,
      property: onProperty.map((a) => a.id),
    });
  } catch (error) {
    return serverError('modules/properties/api/amenities amenityMatrix', error);
  }
});
