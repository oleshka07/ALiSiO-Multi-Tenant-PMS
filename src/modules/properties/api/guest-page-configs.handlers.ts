/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { withModule } from '@core/auth/session';
import { requestPropertyScope } from '@core/auth/property-scope';
import { handleError } from '@core/http/errors';
import { listGuestPageConfigs as configsOf } from '../data/guest-page-configs.repo';

export const listGuestPageConfigs = withModule('guest_page', null, async (request, _ctx, actor) => {
  try {
    // Який ОБʼЄКТ, а не лише який орендар (INC-029): ці рядки несуть коди
    // дверей і паролі Wi-Fi, а готель із двома будинками бачив в одному списку
    // типи обох. Запит і його доводи — у `data/guest-page-configs.repo.ts`:
    // `withModule` кличе `cookies()`, тож на хендлер сцени не буває.
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json(await configsOf(actor.organizationId, scope));
  } catch (error: unknown) {
    // Названа відмова їде своїм статусом: чужий `property_id` — 404, не 500.
    return handleError('modules/properties/api/guest-page-configs', error);
  }
});
