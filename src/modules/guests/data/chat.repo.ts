/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';

export function getReservationIdByToken(token: string): string | null {
  const row = getDb().prepare('SELECT id FROM reservations WHERE guest_page_token = ?').get(token) as any;
  return row?.id ?? null;
}

export function getChatMessages(reservationId: string) {
  return getDb().prepare(
    'SELECT id, sender, message, created_at FROM guest_chat_messages WHERE reservation_id = ? ORDER BY created_at ASC'
  ).all(reservationId);
}

export function saveMessage(reservationId: string, sender: string, message: string) {
  getDb().prepare(
    'INSERT INTO guest_chat_messages (id, reservation_id, sender, message) VALUES (lower(hex(randomblob(16))), ?, ?, ?)'
  ).run(reservationId, sender, message);
}

export function getReservationForChat(token: string) {
  return getDb().prepare(
    'SELECT r.id, r.guest_id, g.first_name, g.last_name, r.unit_id FROM reservations r LEFT JOIN guests g ON r.guest_id = g.id WHERE r.guest_page_token = ?'
  ).get(token) as any;
}
