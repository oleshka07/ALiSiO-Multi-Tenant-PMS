/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';

/**
 * Channel connections and room mappings.
 *
 * channel_connections carries organization_id and nothing used it: listing
 * returned every tenant's connections with their external property ids,
 * get/update/delete acted on whatever id the URL carried, and createConnection
 * filed new rows under `SELECT id FROM organizations LIMIT 1`.
 *
 * Room mappings are reached through the connection, so they are constrained by
 * joining to it rather than by trusting connection_id from the request. A
 * mapping is what tells a channel which of our rooms to sell; pointing one at
 * another tenant's unit type would put their rooms on someone else's
 * Booking.com listing.
 */

/** True when the connection exists and belongs to this organization. */
async function ownsConnection(organizationId: string, id: string): Promise<boolean> {
  const sql = getSql();
  return !!await sql.row<any>('SELECT 1 FROM channel_connections WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export async function listConnections(organizationId: string) {
  const sql = getSql();
  const connections = await sql.rows<any>(`
    SELECT cc.*,
      cred.environment, cred.client_id,
      (cred.access_token IS NOT NULL AND cred.token_expires_at > CURRENT_TIMESTAMP) as token_valid
    FROM channel_connections cc
    LEFT JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.organization_id = ?
    ORDER BY cc.created_at DESC
  `, [organizationId]) as any[];

  return connections.map((c) => ({
    ...c,
    connection_types: JSON.parse(c.connection_types || '[]'),
  }));
}

export async function getConnection(organizationId: string, id: string) {
  const sql = getSql();
  const conn = await sql.row<any>(`
    SELECT cc.*,
      cred.environment, cred.client_id,
      (cred.access_token IS NOT NULL AND cred.token_expires_at > CURRENT_TIMESTAMP) as token_valid
    FROM channel_connections cc
    LEFT JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ? AND cc.organization_id = ?
  `, [id, organizationId]) as any;

  if (!conn) return null;

  const mappings = await sql.rows<any>(`
    SELECT crm.*, ut.name as unit_type_name, ut.code as unit_type_code
    FROM channel_room_mapping crm
    JOIN unit_types ut ON crm.unit_type_id = ut.id
    WHERE crm.connection_id = ?
    ORDER BY ut.name
  `, [id]);

  return {
    ...conn,
    connection_types: JSON.parse(conn.connection_types || '[]'),
    mappings,
  };
}

export async function createConnection(
  organizationId: string,
  input: {
    channel: string;
    external_property_id?: string;
    connection_types?: string[];
    pricing_model?: string;
  },
): Promise<string> {
  const sql = getSql();
  const id = `cc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  await sql.run(`
    INSERT INTO channel_connections
      (id, organization_id, channel, external_property_id, status, connection_types, pricing_model)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `, [id, organizationId, input.channel,
    input.external_property_id || null,
    JSON.stringify(input.connection_types || ['RESERVATIONS', 'AVAILABILITY']),
    input.pricing_model || 'Standard']);

  return id;
}

export async function updateConnection(organizationId: string, id: string, body: Record<string, any>): Promise<boolean> {
  const sql = getSql();
  if (!await ownsConnection(organizationId, id)) return false;

  // credentials_id comes from the request; pointing a connection at another
  // tenant's credentials would let it authenticate to the channel as them.
  if (body.credentials_id) {
    const ok = await sql.row<any>('SELECT 1 FROM channel_credentials WHERE id = ? AND organization_id = ?', [body.credentials_id, organizationId]);
    if (!ok) return false;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (body.external_property_id !== undefined) { updates.push('external_property_id = ?'); values.push(body.external_property_id); }
  if (body.status !== undefined) { updates.push('status = ?'); values.push(body.status); }
  if (body.connection_types !== undefined) { updates.push('connection_types = ?'); values.push(JSON.stringify(body.connection_types)); }
  if (body.pricing_model !== undefined) { updates.push('pricing_model = ?'); values.push(body.pricing_model); }
  if (body.credentials_id !== undefined) { updates.push('credentials_id = ?'); values.push(body.credentials_id); }

  if (updates.length === 0) return false;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, organizationId);
  await sql.run(`UPDATE channel_connections SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`, [...values]);
  return true;
}

export async function deleteConnection(organizationId: string, id: string): Promise<boolean> {
  const sql = getSql();
  const res = await sql.run('DELETE FROM channel_connections WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return res.changes > 0;
}

/**
 * Every tenant's active connections, for the sync cron. organization_id is
 * returned so the caller can scope its work per row — this is background work
 * with no session behind it.
 */
export async function getActiveReservationConnections() {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT id, organization_id, channel, connection_types
    FROM channel_connections
    WHERE status = 'connected' AND credentials_id IS NOT NULL
  `) as any[];
}

export async function markConnectionSynced(id: string) {
  const sql = getSql();
  await sql.run(`
    UPDATE channel_connections SET last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [id]);
}

// ─── Room Mapping ─────────────────────────────────────────────────────────────

export async function listMappings(organizationId: string, connectionId?: string) {
  const sql = getSql();
  let query = `
    SELECT crm.*, ut.name as unit_type_name, ut.code as unit_type_code,
      ut.max_adults, ut.max_occupancy, ut.base_occupancy,
      cc.channel, cc.external_property_id
    FROM channel_room_mapping crm
    JOIN unit_types ut ON crm.unit_type_id = ut.id
    JOIN channel_connections cc ON crm.connection_id = cc.id
    WHERE cc.organization_id = ?
  `;
  const values: any[] = [organizationId];
  if (connectionId) { query += ' AND crm.connection_id = ?'; values.push(connectionId); }
  query += ' ORDER BY ut.name';

  const mappings = await sql.rows<any>(query, values);
  // The unit types offered for mapping must be this tenant's, or the screen
  // would invite an operator to map a channel room onto someone else's type.
  const unitTypes = await sql.rows<any>(`
    SELECT ut.id, ut.name, ut.code, ut.max_adults, ut.max_occupancy, ut.base_occupancy
    FROM unit_types ut
    JOIN properties p ON p.id = ut.property_id
    WHERE p.organization_id = ?
    ORDER BY ut.name
  `, [organizationId]);
  return { mappings, unitTypes };
}

export async function upsertMapping(
  organizationId: string,
  input: {
    connection_id: string;
    unit_type_id: string;
    external_room_type_id?: string;
    external_rate_plan_id?: string;
  },
): Promise<{ id: string; created: boolean } | null> {
  const sql = getSql();

  // Both ids arrive in the request body; both must be this tenant's.
  if (!await ownsConnection(organizationId, input.connection_id)) return null;
  const ownsUnitType = await sql.row<any>(`
    SELECT 1 FROM unit_types ut
    JOIN properties p ON p.id = ut.property_id
    WHERE ut.id = ? AND p.organization_id = ?
  `, [input.unit_type_id, organizationId]);
  if (!ownsUnitType) return null;

  const existing = await sql.row<any>('SELECT id FROM channel_room_mapping WHERE connection_id = ? AND unit_type_id = ?', [input.connection_id, input.unit_type_id]) as any;

  if (existing) {
    await sql.run(`
      UPDATE channel_room_mapping
      SET external_room_type_id = ?, external_rate_plan_id = ?,
        is_active = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [input.external_room_type_id || '', input.external_rate_plan_id || '', existing.id]);
    return { id: existing.id, created: false };
  }

  const id = `crm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  await sql.run(`
    INSERT INTO channel_room_mapping
      (id, connection_id, unit_type_id, external_room_type_id, external_rate_plan_id)
    VALUES (?, ?, ?, ?, ?)
  `, [id, input.connection_id, input.unit_type_id, input.external_room_type_id || '', input.external_rate_plan_id || '']);
  return { id, created: true };
}

export async function deleteMapping(organizationId: string, id: string): Promise<boolean> {
  const sql = getSql();
  const res = await sql.run(`
    DELETE FROM channel_room_mapping
    WHERE id = ? AND connection_id IN (
      SELECT id FROM channel_connections WHERE organization_id = ?
    )
  `, [id, organizationId]);
  return res.changes > 0;
}
