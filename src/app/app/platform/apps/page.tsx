'use client';

/**
 * Стан застосунків усіх готелів — сторінка постачальника (З8).
 *
 * Дві таблиці: організація × звʼязок × стан × останній успіх × остання помилка
 * (з текстом), з `app_connections` І `cm_connections` (менеджер каналів); і
 * попит — застосунок × скільки готелів натиснули «хочу». Лише платформна
 * сесія, як `/app/platform`; без сесії — на вхід.
 */
import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Row {
  organization_id: string; organization_name: string; property_id: string | null;
  app: string; status: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null;
}
interface Wish { app: string; hotels: number }

const STATUS: Record<string, { word: string; badge: string }> = {
  connected: { word: 'підключено', badge: 'badge-success' },
  error: { word: 'помилка', badge: 'badge-danger' },
  degraded: { word: 'з перебоями', badge: 'badge-warning' },
  disabled: { word: 'вимкнено', badge: 'badge-info' },
};

const APP_LABEL: Record<string, string> = { channel_manager: 'Менеджер каналів', smtp: 'Пошта', fiskaly: 'fiskaly (TSE)' };

const fmt = (iso: string | null) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—');

export default function PlatformAppsPage() {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [organizations, setOrganizations] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/platform/apps');
        if (res.status === 401) { router.push('/app/platform/login'); return; }
        if (!res.ok) { setError(t('Не вдалося завантажити список')); return; }
        const d = await res.json();
        setRows(d.connections);
        setWishes(d.wishes);
        setOrganizations(d.organizations);
      } catch {
        setError(t('Не вдалося завантажити список'));
      } finally {
        setLoading(false);
      }
    })();
  }, [router, t]);

  if (loading) return <div style={{ padding: 40 }}>{t('Завантаження…')}</div>;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t('Застосунки')} · {t('усі готелі')}</h1>
        <Link href="/app/platform" className="btn btn-sm btn-ghost">{t('Готелі')}</Link>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        {organizations} {t('організацій')} · {t('стан звʼязку з чужими системами і попит на те, чого ще немає')}
      </p>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>{t('Здоровʼя')}</h2>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', marginBottom: 24 }}>{t('Жоден готель ще не звертався до чужої системи.')}</div>
      ) : (
        <div className="table-wrapper" style={{ marginBottom: 28 }}>
          <table className="table" data-testid="platform-apps-health">
            <thead>
              <tr>
                <th>{t('Готель')}</th>
                <th>{t('Звʼязок')}</th>
                <th>{t('Стан')}</th>
                <th>{t('останній успіх')}</th>
                <th>{t('остання помилка')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = STATUS[r.status] ?? { word: r.status, badge: 'badge-info' };
                return (
                  <tr key={i} data-testid={`platform-row-${r.organization_id}-${r.app}`} data-status={r.status}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.organization_name}</div>
                      {r.property_id && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{r.property_id}</div>}
                    </td>
                    <td>{t(APP_LABEL[r.app] ?? r.app)}</td>
                    <td><span className={`badge ${st.badge}`}>{t(st.word)}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.last_ok_at)}</td>
                    <td>
                      {r.last_error ? (
                        <>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{fmt(r.last_error_at)}</div>
                          <div style={{ color: 'var(--danger, #e5484d)' }}>{r.last_error}</div>
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>{t('Попит')}</h2>
      <div className="table-wrapper">
        <table className="table" data-testid="platform-apps-demand">
          <thead>
            <tr>
              <th>{t('Застосунок')}</th>
              <th style={{ textAlign: 'right' }}>{t('готелів натиснули «хочу»')}</th>
            </tr>
          </thead>
          <tbody>
            {wishes.map((w) => (
              <tr key={w.app} data-testid={`platform-wish-${w.app}`}>
                <td>{w.app}</td>
                <td style={{ textAlign: 'right' }} data-testid={`platform-wish-count-${w.app}`}>{w.hotels}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
