/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { requirePropertyId, requireOrganizationId } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError, handleError } from '@core/http/errors';
import { oneProperty, propertyScopeFilter, type PropertyScope } from '@core/property-scope';
import { requestPropertyScope } from '@core/auth/property-scope';
import { unitsOutsideHouse } from './ical-sync.handlers';

/**
 * Канали ОБРАНОГО обʼєкта — тіло окремою функцією, щоб його бачила сцена.
 *
 * Тут уже стояв рядок про те, що `ical_channels` дістаються орендаря через
 * `property_id`, а ні цей список, ні сусідні правка й видалення його не
 * називали. Половину — вісь ОРЕНДАРЯ — тоді й полагодили; друга половина, вісь
 * ОБʼЄКТА, лишалась відкритою до INC-041.
 *
 * `withActor` кличе `cookies()`, тобто поза запитом Next загорнутий хендлер
 * недосяжний для `.check.ts`; те саме зроблено в `list-export-scope`.
 *
 * Вісь тут не косметична. Рядок каналу несе `export_token` — саме він і є
 * перепусткою до фіда календаря: хто має посилання, читає заїзди, виїзди й
 * імена гостей без жодної сесії. Оператор, який стоїть у будинку А, бачив у
 * цьому списку токени й адреси імпорту будинку Б (INC-029).
 */
export async function icalChannelsInScope(
  organizationId: string,
  scope: PropertyScope,
): Promise<any[]> {
  const sql = getSql();
  const house = propertyScopeFilter(scope, 'ic');
  const channels = await sql.rows<any>(`
    SELECT
      ic.*,
      CASE ic.channel_type
        WHEN 'unit' THEN u.name
      END as target_name,
      CASE ic.channel_type
        WHEN 'unit' THEN u.code
      END as target_code,
      bs.name as source_name,
      bs.color as source_color,
      bs.icon_letter as source_icon
    FROM ical_channels ic
    JOIN properties p ON ic.property_id = p.id
    LEFT JOIN units u ON ic.unit_id = u.id
    LEFT JOIN booking_sources bs ON bs.code = ic.source_code
    WHERE p.organization_id = ? AND ${house.sql}
    ORDER BY ic.created_at
  `, [organizationId, ...house.params]);

  for (const ch of channels as any[]) {
    ch.last_log = await sql.row<any>(
      'SELECT * FROM ical_sync_log WHERE channel_id = ? ORDER BY synced_at DESC LIMIT 1',
      [ch.id],
    ) || null;
  }
  return channels as any[];
}

export const listIcalChannels = withActor(async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json(await icalChannelsInScope(actor.organizationId, scope));
  } catch (e: any) {
    return handleError('modules/channels/api/ical-channels listIcalChannels', e);
  }
});

export const createIcalChannel = withPermission('manage_properties', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const { channel_type, unit_id, source_code, ical_url, sync_interval_minutes } = body;

    if (!channel_type || !source_code) {
      return NextResponse.json({ error: 'channel_type and source_code are required' }, { status: 400 });
    }

    // Тип лишився один — канал по номеру. Канал по будові пішов разом із
    // будовами (міграція 0044): вони існували заради одного клієнта, а
    // календар усе одно групував по `building_name || zone`.
    if (channel_type !== 'unit') {
      return NextResponse.json(
        { error: `Невідомий тип каналу: ${channel_type}. Доступний лише 'unit'.` }, { status: 400 });
    }
    if (!unit_id) {
      return NextResponse.json({ error: 'unit_id is required for unit channels' }, { status: 400 });
    }

    let propertyId: string;
    try {
      propertyId = await requirePropertyId(body.property_id);
    } catch (e: any) {
      return handleError('ical-channels POST', e);
    }

    // Обʼєкт і номер приїжджають ОКРЕМИМИ полями тіла, і між собою їх ніхто не
    // звіряв. Синк далі бере обʼєкт від НОМЕРА, тож канал, заведений на номер
    // сусіднього будинку, наповнював його календар — без помилки і без сліду
    // (INC-041). Тут — названа відмова, і вона перша: `dup` нижче тепер
    // питає в межах будинку, тож потребує вже перевіреного `propertyId`.
    const house = propertyScopeFilter(oneProperty(propertyId), '');
    const outside = await unitsOutsideHouse([unit_id], house);
    if (outside) {
      return NextResponse.json({
        error: `Номер не належить обраному обʼєкту. Оберіть номер цього обʼєкта — інакше `
          + 'броні з фіда лягали б у календар іншого будинку.',
      }, { status: 400 });
    }

    const dup = await sql.row<any>(
      `SELECT id FROM ical_channels WHERE unit_id = ? AND source_code = ?
         AND organization_id = ? AND ${house.sql}`,
      [unit_id, source_code, await requireOrganizationId(), ...house.params]);
    if (dup) return NextResponse.json({ error: 'Channel already exists for this unit + source' }, { status: 400 });

    const id = `ich_${Date.now()}`;
    const exportToken = generateGuestToken() + generateGuestToken();

    // The tenant is named, and taken from the property the channel hangs on —
    // a subquery cannot drift from the row it comes from. AGENTS.md §3 nr 12.
    await sql.run(`
      INSERT INTO ical_channels (id, organization_id, property_id, channel_type, unit_id, source_code, ical_url, export_token, sync_interval_minutes)
      VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
    `, [id, propertyId, propertyId, channel_type,
      unit_id,
      source_code, ical_url || null, exportToken,
      sync_interval_minutes || 15]);

    const created = await sql.row<any>(
      `SELECT * FROM ical_channels WHERE id = ? AND organization_id = ? AND ${house.sql}`,
      [id, await requireOrganizationId(), ...house.params]);
    // propertyId above came from requirePropertyId(), which resolves it
    // against this organization — so the row just written is this hotel's.
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return serverError('modules/channels/api/ical-channels createIcalChannel', e);
  }
});
