'use client';

/**
 * Кнопки статусів на картці броні: Підтвердити · Заселити · Виселити ·
 * Скасувати · No-show (Блок 4 §2.1, джерело форми — Hoteliera, блок STATUS).
 *
 * Правила лишаються на сервері: 422 без оплати чи реєстрації при заселенні,
 * політика обʼєкта при виселенні з боргом. Кнопка лише каже, чого хоче
 * рецепція, і не приховує дію, яку сервер може відхилити, — інакше причину
 * відмови ніхто б не побачив.
 */
import React from 'react';
import { useT } from '@core/i18n/client';
import { Check, LogIn, LogOut, X, UserX } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  booking: any;
  onChangeStatus: (id: string, status: string) => void;
  compact?: boolean;
}

export default function StatusActions({ booking: b, onChangeStatus, compact }: Props) {
  const tUi = useT();
  const status = String(b.status || '');
  const today = new Date().toISOString().slice(0, 10);
  const arrived = String(b.check_in || '').slice(0, 10) <= today;

  const ask = (text: string, next: string) => { if (confirm(text)) onChangeStatus(b.id, next); };
  const size = compact ? 'btn-sm' : '';

  const buttons: React.ReactNode[] = [];
  if (status === 'draft' || status === 'tentative') {
    buttons.push(
      <button key="confirm" className={`btn btn-primary ${size}`} onClick={() => ask(tUi('Підтвердити бронь?'), 'confirmed')}>
        <Check size={13} /> {tUi('Підтвердити')}
      </button>);
  }
  if (status === 'confirmed') {
    buttons.push(
      <button key="checkin" className={`btn btn-primary ${size}`} onClick={() => ask(tUi('Заселити гостя?'), 'checked_in')}>
        <LogIn size={13} /> {tUi('Заселити')}
      </button>);
  }
  if (status === 'checked_in') {
    buttons.push(
      <button key="checkout" className={`btn btn-primary ${size}`} onClick={() => ask(tUi('Виселити гостя?'), 'checked_out')}>
        <LogOut size={13} /> {tUi('Виселити')}
      </button>);
  }
  if ((status === 'confirmed' || status === 'tentative') && arrived) {
    buttons.push(
      <button key="noshow" className={`btn btn-secondary ${size}`} onClick={() => ask(tUi('Позначити як незаїзд (no-show)? Номер звільниться.'), 'no_show')}>
        <UserX size={13} /> {tUi('No-show')}
      </button>);
  }
  if (!['cancelled', 'checked_out', 'no_show'].includes(status)) {
    buttons.push(
      <button key="cancel" className={`btn btn-secondary ${size}`} style={{ color: 'var(--accent-danger)' }}
        onClick={() => ask(tUi('Точно скасувати бронь? Гість буде повідомлений.'), 'cancelled')}>
        <X size={13} /> {tUi('Скасувати')}
      </button>);
  }
  if (buttons.length === 0) return null;
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{buttons}</div>;
}
