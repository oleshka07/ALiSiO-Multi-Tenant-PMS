/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tracks Telegram booking notification messages and edits them
 * when payment_status changes (strikethrough old + add new status).
 */
import { getSql } from '@core/db/async';
import { editInChat, getChatId } from '@/modules/notifications/data/telegram-bot';

const PAY_LABELS: Record<string, string> = {
  paid: '✅ оплачено',
  prepaid: '💳 передплата',
  partial: '💳 часткова оплата',
  unpaid: '⏳ не оплачено',
  payment_requested: '📩 запит на оплату',
};

function payLabel(status: string): string {
  return PAY_LABELS[status] || status;
}

/**
 * Store the Telegram message_id after sending a booking notification.
 */
export async function storeTgBookingMessage(
  reservationId: string,
  chatId: string,
  messageId: number,
  paymentStatus: string | null,
  text: string,
): Promise<void> {
  try {
    const sql = getSql();
    await sql.run(`
      INSERT INTO tg_booking_messages (reservation_id, chat_id, message_id, sent_payment_status, sent_text)
      VALUES (?, ?, ?, ?, ?)
    `, [reservationId, chatId, messageId, paymentStatus || 'unpaid', text]);
  } catch (e: any) {
    console.error('[TG updater] store error:', e?.message);
  }
}

/**
 * Edit existing Telegram notification when payment_status changes.
 * Appends " → ✅ оплачено" after the old status line.
 * Falls back to sending a new message if edit fails (48h limit).
 */
export async function updateBookingPaymentNotification(
  reservationId: string,
  newPaymentStatus: string,
): Promise<void> {
  try {
    const sql = getSql();
    const rows = await sql.rows<any>(`
      SELECT id, chat_id, message_id, sent_payment_status, sent_text
      FROM tg_booking_messages
      WHERE reservation_id = ?
    `, [reservationId]) as any[];

    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      if (row.sent_payment_status === newPaymentStatus) continue;

      const oldLabel = payLabel(row.sent_payment_status);
      const newLabel = payLabel(newPaymentStatus);

      let updatedText = row.sent_text;

      // Find the payment line (💰 ... · <old_status>) and append → <new_status>
      const payLineRegex = new RegExp(
        `(💰[^\\n]*·\\s*${escapeRegex(oldLabel)}[^\\n]*)`,
      );

      if (payLineRegex.test(updatedText)) {
        updatedText = updatedText.replace(
          payLineRegex,
          `$1\n    → ${newLabel}`,
        );
      } else {
        // Fallback: append status change before the booking ID line
        updatedText = updatedText.replace(
          /(\n🔖)/,
          `\n💳 ${oldLabel} → ${newLabel}$1`,
        );
      }

      const ok = await editInChat(row.chat_id, row.message_id, updatedText);

      if (ok) {
        await sql.run(`
          UPDATE tg_booking_messages
          SET sent_payment_status = ?, sent_text = ?
          WHERE id = ?
        `, [newPaymentStatus, updatedText, row.id]);
      } else {
        // Edit failed (likely >48h) — send a short update as new message
        if (row.chat_id === await getChatId()) {
          const { sendTelegramMessage } = await import('@/modules/notifications/data/telegram-bot');
          const r = await sql.row<any>(`
            SELECT r.id, g.first_name, g.last_name, u.name as unit_name
            FROM reservations r
            LEFT JOIN guests g ON g.id = r.guest_id
            LEFT JOIN units u ON u.id = r.unit_id
            WHERE r.id = ?
          `, [reservationId]) as any;
          if (r) {
            const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Гість';
            await sendTelegramMessage(
              `💳 <b>Статус оплати змінено</b>\n` +
              `👤 ${name} · ${r.unit_name || ''}\n` +
              `${oldLabel} → ${newLabel}\n` +
              `🔖 <code>${reservationId}</code>`
            );
          }
        }
        await sql.run(`
          UPDATE tg_booking_messages SET sent_payment_status = ? WHERE id = ?
        `, [newPaymentStatus, row.id]);
      }
    }
  } catch (e: any) {
    console.error('[TG updater] update error:', e?.message);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
