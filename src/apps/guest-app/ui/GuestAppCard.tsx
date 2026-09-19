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

/**
 * Разові правки аркуша.
 *
 * Разові навмисно (рішення власника 18.09): телефон рецепції часто не той,
 * що загальний у картці обʼєкта, але заводити другий телефон готелю окремою
 * колонкою означало б два джерела одного факту — і відповідало б те, кого
 * спитали останнім.
 *
 * Порожнє поле означає «як у готелю», а не «зітри»: форма шле всі поля
 * завжди, і без цього правила порожній рядок прибрав би телефон з аркуша
 * (той самий клас, що `property_type: ''` у формі обʼєкта).
 */
const EMPTY_SHEET = { hotelName: '', address: '', phone: '', headline: '', note: '' };

export function GuestAppCard() {
  const t = useT();
  const [houses, setHouses] = useState<House[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Який будинок питає підтвердження заміни. Заміна вбиває наліпки. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Чий QR розгорнуто під посиланням. */
  const [showQr, setShowQr] = useState<string | null>(null);
  /** Чий аркуш зараз готують, і з якими правками. */
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState(EMPTY_SHEET);
  const [building, setBuilding] = useState(false);

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

  /**
   * Зібрати аркуш і відкрити його.
   *
   * Відповідь ЧИТАЄТЬСЯ: маршрут віддає названу відмову (404 на чужий обʼєкт,
   * 409 поки немає ключа), і екран, який відкрив би вікно не глянувши в
   * тіло, показав би порожню вкладку замість речення
   * (`check-unread-write-response`).
   */
  async function buildSheet(propertyId: string) {
    setBuilding(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/apps/guest-app/sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId, ...sheet }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setMessage(body.error ?? t('Не вдалося зібрати аркуш'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Звільняємо не одразу: вкладка ще читає цей blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setMessage(t('Не вдалося зібрати аркуш'));
    } finally {
      setBuilding(false);
    }
  }

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
              {/*
                QR ПОРУЧ із посиланням, і це те саме зображення, що поїде на
                папір: один маршрут малює обидва. Два генератори означали б,
                що оператор перевірить телефоном один код, а надрукує інший.
              */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <button type="button" className="btn btn-sm"
                  onClick={() => setShowQr(showQr === h.propertyId ? null : h.propertyId)}>
                  {showQr === h.propertyId ? t('Сховати QR') : t('Показати QR')}
                </button>
                <button type="button" className="btn btn-sm"
                  onClick={() => { setSheetFor(sheetFor === h.propertyId ? null : h.propertyId); setSheet(EMPTY_SHEET); }}>
                  {t('Аркуш A4 для друку')}
                </button>
              </div>

              {showQr === h.propertyId && (
                <div style={{ marginBottom: 10 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/settings/apps/guest-app/qr?propertyId=${encodeURIComponent(h.propertyId)}`}
                    alt={t('QR-код гостьового застосунку')}
                    style={{ width: 180, height: 180, border: '1px solid var(--border)', background: '#FFF' }}
                  />
                </div>
              )}

              {sheetFor === h.propertyId && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {t('Порожнє поле — беремо дані готелю. Правки діють лише для цього друку.')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label className="form-label">{t('Назва на аркуші')}</label>
                      <input className="form-input" value={sheet.hotelName}
                        placeholder={h.name}
                        onChange={(e) => setSheet({ ...sheet, hotelName: e.target.value })} />
                    </div>
                    <div>
                      <label className="form-label">{t('Телефон на аркуші')}</label>
                      <input className="form-input" value={sheet.phone}
                        onChange={(e) => setSheet({ ...sheet, phone: e.target.value })} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">{t('Адреса на аркуші')}</label>
                      <input className="form-input" value={sheet.address}
                        onChange={(e) => setSheet({ ...sheet, address: e.target.value })} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">{t('Свій заклик замість нашого')}</label>
                      <input className="form-input" value={sheet.headline}
                        onChange={(e) => setSheet({ ...sheet, headline: e.target.value })} />
                    </div>
                  </div>
                  {/*
                    Мови названо словами, бо це не налаштування: аркуш іде
                    мовою готелю і англійською (рішення власника 18.09).
                    Сімома він не йде — застосунок за кодом бере мову з
                    телефона сам, і дрібний шрифт на папері цього не додасть.
                  */}
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '8px 0' }}>
                    {t('Аркуш друкується двома мовами: мовою готелю і англійською.')}
                  </div>
                  <button type="button" className="btn btn-sm" data-primary="true"
                    disabled={building}
                    onClick={() => { void buildSheet(h.propertyId); }}>
                    {building ? t('Збираємо…') : t('Згенерувати PDF')}
                  </button>
                </div>
              )}

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
