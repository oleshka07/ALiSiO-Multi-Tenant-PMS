'use client';

/**
 * Картка застосунку «Гостьовий застосунок» — адреси, куди веде QR на склі.
 *
 * Окремим компонентом, а не ще сотнею рядків у `settings/apps/page.tsx`, — з
 * тієї самої причини, що `KioskCard`: сторінка лишається списком карток, а що
 * всередині — справа застосунку.
 *
 * ── Мова тут `t()` ──────────────────────────────────────────────────────
 *
 * КІ11 каже: екран ГОСТЯ має власний словник, бо мову там обирає гість. Це
 * екран ОПЕРАТОРА — мову веде адмінка, і `t()` саме для неї.
 *
 * ── Ключ показується ЩОРАЗУ, на відміну від коду парування ──────────────
 *
 * У кіоска в базі лежить `sha256(код)`, тож «показати ще раз» там неможливо
 * за побудовою. Тут навпаки: ключ і Є адресою, його друкують на наліпці й
 * вішають на двері. Ховати його не було б від кого — він публічний за
 * призначенням.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';

interface House {
  propertyId: string;
  name: string;
  key: string | null;
  systemOfRecord: string;
}

export function GuestAppCard() {
  const t = useT();
  const [houses, setHouses] = useState<House[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Який будинок питає підтвердження заміни. Заміна вбиває наліпки. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/apps/guest-app');
      if (!res.ok) return;
      const body = await res.json() as { houses?: House[] };
      setHouses(body.houses ?? []);
    } catch {
      // Мережа впала — картка лишається порожньою, і це видно.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function issue(propertyId: string, rotate: boolean) {
    setBusy(propertyId);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/apps/guest-app', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId, rotate }),
      });
      // Відповідь ЧИТАЄТЬСЯ: екран, який показує успіх, не подивившись у
      // тіло, однаково радіє на 200 і на 400.
      const body = await res.json().catch(() => ({})) as { key?: string; error?: string };
      if (!res.ok) { setMessage(body.error ?? t('Не вдалося видати ключ')); return; }
      setConfirming(null);
      await load();
    } catch {
      setMessage(t('Не вдалося видати ключ'));
    } finally {
      setBusy(null);
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div data-testid="guest-app-card" style={{ padding: '12px 18px 16px 18px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>
        {t('QR-код на склі веде на цю адресу. Гість шукає свою бронь або добирає вільний номер і бронює.')}
      </div>

      {houses.length === 0 && (
        <div style={{ color: 'var(--text-secondary)' }}>{t('Обʼєктів немає')}</div>
      )}

      {houses.map((h) => (
        <div key={h.propertyId} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{h.name}</div>

          {h.key ? (
            <>
              {/*
                Адреса цілим рядком, щоб її можна було виділити й скопіювати
                очима, а не збирати з частин: її несуть у друкарню.
              */}
              <div data-testid={`guest-app-url-${h.propertyId}`} style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 6 }}>
                {origin}/stay/{h.key}
              </div>
              {confirming === h.propertyId ? (
                <div style={{ color: 'var(--danger)' }}>
                  {t('Заміна зробить усі надруковані QR непрацюючими. Замінити?')}{' '}
                  <button type="button" className="btn btn-sm" disabled={busy === h.propertyId}
                    onClick={() => { void issue(h.propertyId, true); }}>
                    {t('Так, замінити')}
                  </button>{' '}
                  <button type="button" className="btn btn-sm" onClick={() => setConfirming(null)}>
                    {t('Скасувати')}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => setConfirming(h.propertyId)}>
                  {t('Замінити ключ')}
                </button>
              )}
            </>
          ) : (
            <button type="button" className="btn btn-sm" data-testid={`guest-app-issue-${h.propertyId}`}
              disabled={busy === h.propertyId}
              onClick={() => { void issue(h.propertyId, false); }}>
              {busy === h.propertyId ? t('Видаємо…') : t('Видати ключ')}
            </button>
          )}

          {/*
            Фаза обліку сказана словами: у готелю на своїй системі сторінка
            НЕ продає — вона передає на його власну сторінку бронювання
            (КІ30). Без цього рядка оператор шукав би, чому номери не
            показуються.
          */}
          {h.systemOfRecord === 'external' && (
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
              {t('Книгу веде зовнішня система: сторінка не продає номери, а передає на сторінку бронювання готелю.')}
            </div>
          )}
        </div>
      ))}

      {message && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{message}</div>}
    </div>
  );
}
