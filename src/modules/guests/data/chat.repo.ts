/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { getSql } from '@core/db/async';

// The id used to be defaulted by a SQLite-only blob function inside the
// INSERT. Same 32 lowercase hex chars, generated where both engines can.
const newId = () => crypto.randomBytes(16).toString('hex');

export async function getReservationIdByToken(token: string): Promise<string | null> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT id FROM reservations WHERE guest_page_token = ?', [token]) as any;
  return row?.id ?? null;
}

export async function getChatMessages(reservationId: string) {
  const sql = getSql();
  return await sql.rows<any>('SELECT id, sender, message, created_at FROM guest_chat_messages WHERE reservation_id = ? ORDER BY created_at ASC', [reservationId]);
}

export async function saveMessage(reservationId: string, sender: string, message: string) {
  const sql = getSql();
  await sql.run('INSERT INTO guest_chat_messages (id, reservation_id, sender, message) VALUES (?, ?, ?, ?)', [newId(), reservationId, sender, message]);
}

export async function getReservationForChat(token: string) {
  const sql = getSql();
  return await sql.row<any>('SELECT r.id, r.guest_id, g.first_name, g.last_name, r.unit_id FROM reservations r LEFT JOIN guests g ON r.guest_id = g.id WHERE r.guest_page_token = ?', [token]) as any;
}
