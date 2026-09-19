/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The module's own screens, behind its own key.
 *
 * `withModule('fiscal_ua', …)` and not merely `withPermission`: a hotel that
 * has not bought the module must not reach these routes at all, the same way
 * a disabled module's routes refuse rather than merely disappear from the
 * menu (see the essay on `withModule` in core/auth/session.ts). The key is
 * `kind: 'app'`, so it has no menu section of its own — the way in is the
 * settings hub card, which only shows when the key is on.
 *
 * Права — `manage_finance_settings`. Каса, її реквізити і вибір драйвера —
 * це те саме, що ставка ПДВ і серія нумерації: не рішення зміни.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withModule, type Actor } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import { requirePropertyScope, requestedPropertyParam, scopedPropertyId } from '@core/property-scope';
import * as repo from '../data/prro.repo';

/** Реквізити каси обʼєкта + журнал, одним запитом — екран показує обидва. */
export const getFiscalUaSettings = withModule('fiscal_ua', 'manage_finance_settings',
  async (request: NextRequest, _ctx, _actor: Actor) => {
    try {
      const scope = await requirePropertyScope(requestedPropertyParam(request.url));
      const propertyId = scopedPropertyId(scope);
      const settings = propertyId ? await repo.prroSettings(propertyId) : null;
      return NextResponse.json({ settings, journal: await repo.prroJournal(scope) });
    } catch (e) {
      return handleError('modules/fiscal-ua getFiscalUaSettings', e);
    }
  });

export const saveFiscalUaSettings = withModule('fiscal_ua', 'manage_finance_settings',
  async (request: NextRequest, _ctx, _actor: Actor) => {
    try {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      await repo.savePrroSettings({
        propertyId: String(body.property_id ?? ''),
        driver: String(body.driver ?? ''),
        cashierName: body.cashier_name == null ? null : String(body.cashier_name),
        registerFiscalNumber: body.register_fiscal_number == null ? null : String(body.register_fiscal_number),
        pointLocalNumber: body.point_local_number == null ? null : String(body.point_local_number),
        taxNumber: body.tax_number == null ? null : String(body.tax_number),
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return handleError('modules/fiscal-ua saveFiscalUaSettings', e);
    }
  });

/**
 * Проба каси.
 *
 * 200 і `status: 'failed'` — це не суперечність: проба ВІДБУЛАСЬ, і те, що
 * каса відмовила, — її результат, а не поломка маршруту. Текст відмови —
 * власний текст драйвера, який ми самі й написали, тож він показується
 * (інваріант 6 забороняє переказувати ЧУЖІ повідомлення, а не свої).
 */
export const testFiscalUaDevice = withModule('fiscal_ua', 'manage_finance_settings',
  async (request: NextRequest, _ctx, _actor: Actor) => {
    try {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      return NextResponse.json(await repo.testPrroDevice(String(body.property_id ?? '')));
    } catch (e) {
      return handleError('modules/fiscal-ua testFiscalUaDevice', e);
    }
  });
