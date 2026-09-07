import { NextRequest, NextResponse } from 'next/server';
import * as feesRepo from '../data/fees.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { handleError } from '@core/http/errors';

/**
 * Збори поверх ціни за ніч: екран готелю.
 *
 * Організація приходить із сесії, ніколи з тіла запиту. `null` із
 * репозиторію означає «не ваше або немає» і відповідає 404, щоб id не можна
 * було промацувати на існування (інваріант 5).
 *
 * Права — `manage_properties`, ті самі, що в категорій і типів номерів:
 * збір це налаштування обʼєкта, а не операція дня.
 */

type IdParams = { params: Promise<{ id: string }> };

/** Відмова стає реченням, яке готель може виправити, а не «400». */
function refusalMessage(r: feesRepo.FeeRefusal): string {
  switch (r.reason) {
    case 'required': return 'Назва збору обовʼязкова';
    case 'unknown': return `${r.field}: дозволено ${r.allowed.join(' / ')}`;
    case 'not_a_number': return 'Сума має бути числом';
    case 'negative': return 'Відʼємний збір — це знижка, і вона заводиться не тут';
    case 'city_tax_already_on_property':
      return `Обʼєкт уже має турзбір ${r.rate}/ніч у налаштуваннях. `
        + 'Другий збір «для громади» потрапив би в рахунок двічі — спершу приберіть той.';
  }
}

export const listFees = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    return NextResponse.json(await feesRepo.listFees(actor.organizationId));
  } catch (error) {
    console.error('GET /api/fees error:', error);
    return NextResponse.json({ error: 'Failed to fetch fees' }, { status: 500 });
  }
});

export const createFee = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();

    // Обʼєкт розвʼязує сервер — та сама причина, що в категоріях: інакше екран
    // мусив би знати id, а знав він лише літерал із сідів першого клієнта.
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(body.property_id);
    } catch (e) {
      return handleError('properties/fees', e);
    }

    const bad = feesRepo.validateFee(body);
    if (bad) return NextResponse.json({ error: refusalMessage(bad), field: bad.field }, { status: 400 });

    // Двох турзборів не буває — див. `cityTaxRateOf`. Перевірка тут, а не в
    // `validateFee`: вона питає базу, а та функція навмисно без бази.
    if ((body.collected_for ?? 'property') === 'authority') {
      const rate = await feesRepo.cityTaxRateOf(propertyId);
      if (rate > 0) {
        const bad2 = { field: 'collected_for', reason: 'city_tax_already_on_property', rate } as const;
        return NextResponse.json({ error: refusalMessage(bad2), field: bad2.field }, { status: 409 });
      }
    }

    const created = await feesRepo.createFee(actor.organizationId, { ...body, property_id: propertyId });
    if (!created) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/fees error:', error);
    return NextResponse.json({ error: 'Failed to create fee' }, { status: 500 });
  }
});

export const updateFee = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();

    // Наявний рядок — основа для перевірки: PATCH міняє частину полів, і
    // перевіряти треба СУМІШ, а не тіло запиту. Інакше зміна самої лише суми
    // впала б на «type обовʼязковий».
    const current = await feesRepo.getFee(actor.organizationId, id);
    if (!current) return NextResponse.json({ error: 'Fee not found' }, { status: 404 });

    const merged = { ...current, ...body };
    const bad = feesRepo.validateFee(merged);
    if (bad) return NextResponse.json({ error: refusalMessage(bad), field: bad.field }, { status: 400 });

    if (merged.collected_for === 'authority' && current.collected_for !== 'authority') {
      const rate = await feesRepo.cityTaxRateOf(current.property_id);
      if (rate > 0) {
        const bad2 = { field: 'collected_for', reason: 'city_tax_already_on_property', rate } as const;
        return NextResponse.json({ error: refusalMessage(bad2), field: bad2.field }, { status: 409 });
      }
    }

    const updated = await feesRepo.updateFee(actor.organizationId, id, body);
    if (!updated) return NextResponse.json({ error: 'Fee not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/fees/:id error:', error);
    return NextResponse.json({ error: 'Failed to update fee' }, { status: 500 });
  }
});

export const deleteFee = withPermission('manage_properties', async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const ok = await feesRepo.deleteFee(actor.organizationId, id);
    if (!ok) return NextResponse.json({ error: 'Fee not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/fees/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete fee' }, { status: 500 });
  }
});
