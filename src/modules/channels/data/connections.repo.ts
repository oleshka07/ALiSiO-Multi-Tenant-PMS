/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';

export function listConnections() {
  const connections = getDb().prepare(`
    SELECT cc.*,
      cred.environment, cred.client_id,
      (cred.access_token IS NOT NULL AND cred.token_expires_at > datetime('now')) as token_valid
    FROM channel_connections cc
    LEFT JOIN channel_credentials cred ON cc.credentials_id = cred.id
    ORDER BY cc.created_at DESC
  `).all() as any[];

  return connections.map(c => ({
    ...c,
    connection_types: JSON.parse(c.connection_types || '[]'),
  }));
}

export function getConnection(id: string) {
  const db = getDb();
  const conn = db.prepare(`
    SELECT cc.*,
      cred.environment, cred.client_id,
      (cred.access_token IS NOT NULL AND cred.token_expires_at > datetime('now')) as token_valid
    FROM channel_connections cc
    LEFT JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ?
  `).get(id) as any;

  if (!conn) return null;

  const mappings = db.prepare(`
    SELECT crm.*, ut.name as unit_type_name, ut.code as unit_type_code
    FROM channel_room_mapping crm
    JOIN unit_types ut ON crm.unit_type_id = ut.id
    WHERE crm.connection_id = ?
    ORDER BY ut.name
  `).all(id);

  return {
    ...conn,
    connection_types: JSON.parse(conn.connection_types || '[]'),
    mappings,
  };
}

export function createConnection(input: {
  channel: string;
  external_property_id?: string;
  connection_types?: string[];
  pricing_model?: string;
}): string {
  const db = getDb();
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get() as any;
  if (!org) throw new Error('No organization found');

  const id = `cc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  db.prepare(`
    INSERT INTO channel_connections
      (id, organization_id, channel, external_property_id, status, connection_types, pricing_model)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id, org.id, input.channel,
    input.external_property_id || null,
    JSON.stringify(input.connection_types || ['RESERVATIONS', 'AVAILABILITY']),
    input.pricing_model || 'Standard',
  );

  return id;
}

export function updateConnection(id: string, body: Record<string, any>): boolean {
  const updates: string[] = [];
  const values: any[] = [];

  if (body.external_property_id !== undefined) { updates.push('external_property_id = ?'); values.push(body.external_property_id); }
  if (body.status !== undefined) { updates.push('status = ?'); values.push(body.status); }
  if (body.connection_types !== undefined) { updates.push('connection_types = ?'); values.push(JSON.stringify(body.connection_types)); }
  if (body.pricing_model !== undefined) { updates.push('pricing_model = ?'); values.push(body.pricing_model); }
  if (body.credentials_id !== undefined) { updates.push('credentials_id = ?'); values.push(body.credentials_id); }

  if (updates.length === 0) return false;

  updates.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE channel_connections SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return true;
}

export function deleteConnection(id: string) {
  getDb().prepare('DELETE FROM channel_connections WHERE id = ?').run(id);
}

export function getActiveReservationConnections() {
  return getDb().prepare(`
    SELECT id, channel, connection_types
    FROM channel_connections
    WHERE status = 'connected' AND credentials_id IS NOT NULL
  `).all() as any[];
}

export function markConnectionSynced(id: string) {
  getDb().prepare(`
    UPDATE channel_connections SET last_synced_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

// ─── Room Mapping ─────────────────────────────────────────────────────────────

export function listMappings(connectionId?: string) {
  const db = getDb();
  let query = `
    SELECT crm.*, ut.name as unit_type_name, ut.code as unit_type_code,
      ut.max_adults, ut.max_occupancy, ut.base_occupancy,
      cc.channel, cc.external_property_id
    FROM channel_room_mapping crm
    JOIN unit_types ut ON crm.unit_type_id = ut.id
    JOIN channel_connections cc ON crm.connection_id = cc.id
  `;
  const values: any[] = [];
  if (connectionId) { query += ' WHERE crm.connection_id = ?'; values.push(connectionId); }
  query += ' ORDER BY ut.name';

  const mappings = db.prepare(query).all(...values);
  const unitTypes = db.prepare('SELECT id, name, code, max_adults, max_occupancy, base_occupancy FROM unit_types ORDER BY name').all();
  return { mappings, unitTypes };
}

export function upsertMapping(input: {
  connection_id: string;
  unit_type_id: string;
  external_room_type_id?: string;
  external_rate_plan_id?: string;
}): { id: string; created: boolean } {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM channel_room_mapping WHERE connection_id = ? AND unit_type_id = ?'
  ).get(input.connection_id, input.unit_type_id) as any;

  if (existing) {
    db.prepare(`
      UPDATE channel_room_mapping
      SET external_room_type_id = ?, external_rate_plan_id = ?,
        is_active = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(input.external_room_type_id || '', input.external_rate_plan_id || '', existing.id);
    return { id: existing.id, created: false };
  }

  const id = `crm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  db.prepare(`
    INSERT INTO channel_room_mapping
      (id, connection_id, unit_type_id, external_room_type_id, external_rate_plan_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.connection_id, input.unit_type_id, input.external_room_type_id || '', input.external_rate_plan_id || '');
  return { id, created: true };
}

export function deleteMapping(id: string) {
  getDb().prepare('DELETE FROM channel_room_mapping WHERE id = ?').run(id);
}
