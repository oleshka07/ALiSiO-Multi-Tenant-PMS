/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Стан застосунків усіх готелів — для постачальника (З8).
 *
 * Єдиний екран, який бачить усіх, і він читає рівно те, що читає
 * `/api/platform/organizations`: назви й стани, ніколи бронь, гостя чи ціну.
 *
 * Читання ПОЗА контекстом одного орендаря — свідомо: список організацій
 * береться з `organizations` (політики на ній немає за побудовою — це те, що
 * запит питає ДО того, як дізнався тенанта), а рядки кожної організації
 * читаються В ЇЇ контексті (`runWithOrganization`), як лічильники на сторінці
 * готелів. Без цього політика Postgres віддавала б для `app_connections`,
 * `app_wishes` і `cm_connections` нуль рядків, і постачальник бачив би «усе
 * зелене» в кожного.
 *
 * Варта — платформна сесія (`getPlatformSession`): не знайшли сесію —
 * відмовили (інваріант 13). Сесія власника готелю — інша таблиця, вона тут
 * ніколи не знайдеться, тобто 401. Функція приймає id сесії, а не читає
 * куку сама, щоб гейт `apps.check.ts` міг довести обидва боки без Next.
 */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { getPlatformSession } from '@core/auth/platform';
import { APPS } from '@core/apps';
import { channelManagerHealth, listConnections, wishedApps } from '@core/app-connections';
import { ALL_PROPERTIES } from '@core/property-scope';

export interface PlatformConnectionRow {
  organization_id: string;
  organization_name: string;
  property_id: string | null;
  /** id застосунку або `channel_manager` для менеджера каналів. */
  app: string;
  status: string;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
}

export async function platformAppsReport(platformSessionId: string | undefined): Promise<Response> {
  const session = await getPlatformSession(platformSessionId);
  if (!session) return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });

  const sql = getSql();
  const orgs = await sql.rows<any>('SELECT id, name FROM organizations ORDER BY name');
  const connections: PlatformConnectionRow[] = [];
  const wishCount = new Map<string, number>();

  for (const o of orgs) {
    const orgId = String(o.id);
    await runWithOrganization(orgId, async () => {
      for (const c of await listConnections(orgId, ALL_PROPERTIES)) {
        connections.push({
          organization_id: orgId,
          organization_name: String(o.name),
          property_id: c.property_id,
          app: c.app,
          status: c.status,
          last_ok_at: c.last_ok_at,
          last_error_at: c.last_error_at,
          last_error: c.last_error,
        });
      }
      // Менеджер каналів — не застосунок (З4), але звʼязок із чужою системою;
      // рядок із `cm_connections`, без нового запису.
      for (const cm of await channelManagerHealth(orgId, ALL_PROPERTIES)) {
        connections.push({
          organization_id: orgId,
          organization_name: String(o.name),
          property_id: cm.property_id,
          app: 'channel_manager',
          status: cm.is_enabled ? 'connected' : 'disabled',
          last_ok_at: cm.last_full_sync_at ?? cm.catalog_synced_at,
          last_error_at: null,
          last_error: null,
        });
      }
      for (const app of await wishedApps(orgId)) {
        wishCount.set(app, (wishCount.get(app) ?? 0) + 1);
      }
    });
  }

  // Попит — по кожному «скоро»-застосунку, і нуль теж рядок: відсутність
  // попиту — це відповідь, а не порожнє місце.
  const wishes = APPS
    .filter((a) => !('live' in a && a.live))
    .map((a) => ({ app: a.id, hotels: wishCount.get(a.id) ?? 0 }));

  return NextResponse.json({ organizations: orgs.length, connections, wishes });
}
