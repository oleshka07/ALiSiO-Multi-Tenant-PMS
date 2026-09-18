/**
 * Зображення обʼєкта за ролями — читання й запис для екрана налаштувань.
 *
 * Варта — `manage_properties`, та сама, що в решти форми обʼєкта. Але право
 * каже, що оператор може керувати обʼєктами, а не ЧИЇМИ: `id` приходить із
 * адреси, тож належність доводиться окремо, і чужий обʼєкт відповідає 404,
 * не 403 (інваріант 5, клас INC-029).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { handleError, refuse } from '@core/http/errors';
import { BRAND_ASSET_ROLE_KEYS } from '@core/brand-assets';
import { brandAssetsOf, setBrandAsset } from '../data/brand-assets.repo';
import { ownsProperty } from '../data/tenant-scope';

const idFrom = (request: NextRequest): string =>
  request.nextUrl.pathname.split('/').filter(Boolean).slice(-2)[0] ?? '';

export const listBrandAssets = withPermission('manage_properties',
  async (request: NextRequest, _ctx: unknown, actor: Actor) => {
    try {
      const propertyId = idFrom(request);
      if (!(await ownsProperty(actor.organizationId, propertyId))) refuse('Не знайдено', 404);
      return NextResponse.json({
        assets: await brandAssetsOf(actor.organizationId, propertyId),
        roles: BRAND_ASSET_ROLE_KEYS,
      });
    } catch (error) {
      return handleError('properties/brand-assets list', error);
    }
  });

export const saveBrandAsset = withPermission('manage_properties',
  async (request: NextRequest, _ctx: unknown, actor: Actor) => {
    try {
      const propertyId = idFrom(request);
      if (!(await ownsProperty(actor.organizationId, propertyId))) refuse('Не знайдено', 404);
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

      const outcome = await setBrandAsset(actor.organizationId, propertyId, body.role, body.url);
      // Названі відмови, а не тихий пропуск: оператор натиснув «зберегти» і
      // має дізнатись, що саме не збереглось.
      if (outcome === 'bad-role') refuse('Невідомий вид зображення', 400);
      if (outcome === 'bad-url') {
        refuse('Адреса має починатись із https:// або бути власним шляхом /uploads/…', 400);
      }
      return NextResponse.json({
        ok: true, removed: outcome === 'removed',
        assets: await brandAssetsOf(actor.organizationId, propertyId),
      });
    } catch (error) {
      return handleError('properties/brand-assets save', error);
    }
  });
