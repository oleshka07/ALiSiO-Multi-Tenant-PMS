/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as chatRepo from '../data/chat.repo';

export async function getChatMessages(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const reservationId = chatRepo.getReservationIdByToken(token);
    if (!reservationId) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const messages = chatRepo.getChatMessages(reservationId);
    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error('GET /api/guest/[token]/chat error:', error?.message);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function sendChatMessage(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const { message, sender } = await request.json();

    if (!message?.trim()) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });

    const reservation = chatRepo.getReservationForChat(token);
    if (!reservation) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const effectiveSender = sender || 'guest';
    chatRepo.saveMessage(reservation.id, effectiveSender, message.trim());

    if (effectiveSender === 'guest') {
      try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (botToken && chatId) {
          const guestName = `${reservation.first_name || ''} ${reservation.last_name || ''}`.trim() || 'Guest';
          const text = `💬 *Повідомлення від гостя*\n\n👤 ${guestName}\n📝 ${message.trim()}`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
          });
        }
      } catch { /* Telegram notify silently fails */ }
    }

    const messages = chatRepo.getChatMessages(reservation.id);
    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error('POST /api/guest/[token]/chat error:', error?.message);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
