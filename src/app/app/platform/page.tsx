'use client';

/**
 * Which hotel to step into — таблицею, як `change-organisation` у Hoteliera
 * (MASTER-PLAN §1.3).
 *
 * The list carries names and counts only — never a booking, a guest or a
 * price. Reading a customer's data starts the moment "Увійти" is pressed, and
 * that moment is written into their own change log. Колонки: назва · країна ·
 * валюта · обʼєктів · OTA · сайт · створено · Setup progress N/8 · дії.
 * Фільтри: країна, стан налаштування. Створення організації — поки командою
 * (`provision-org.mjs`, `apply-hotel.mjs`): кнопки «створити» тут немає в
 * цьому циклі навмисно.
 */
import { useT } from '@core/i18n/client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Org {
  id: string;
  name: string;
  slug: string;
  language: string | null;
  default_currency: string | null;
  created_at: string | null;
  properties: number;
  users: number;
  country: string | null;
  ota: boolean;
  site: boolean;
  setup_done: number;
  setup_total: number;
}

export default function PlatformHomePage() {
  const t = useT();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [me, setMe] = useState<{ email: string; acting: { id: string; name: string } | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [country, setCountry] = useState('');
  const [setup, setSetup] = useState<'all' | 'incomplete' | 'complete'>('all');
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const [meRes, orgRes] = await Promise.all([
          fetch('/api/platform/me'),
          fetch('/api/platform/organizations'),
        ]);
        if (meRes.status === 401) { router.push('/app/platform/login'); return; }
        setMe(await meRes.json());
        if (orgRes.ok) setOrgs(await orgRes.json());
      } catch {
        setError(t('Не вдалося завантажити список'));
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function enter(id: string) {
    setBusy(id);
    setError('');
    try {
      const res = await fetch('/api/platform/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id }),
      });
      if (res.ok) router.push('/app/dashboard');
      else setError((await res.json()).error || t('Не вдалося увійти'));
    } catch {
      setError(t('Помилка мережі'));
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch('/api/platform/logout', { method: 'POST' });
    router.push('/app/platform/login');
  }

  const countries = useMemo(() => [...new Set(orgs.flatMap((o) => (o.country ? o.country.split(', ') : [])))].sort(), [orgs]);
  const shown = orgs.filter((o) => {
    if (country && !(o.country ?? '').split(', ').includes(country)) return false;
    if (setup === 'complete' && o.setup_done < o.setup_total) return false;
    if (setup === 'incomplete' && o.setup_done >= o.setup_total) return false;
    return true;
  });
  const fmtDate = (iso: string | null) => (iso ? String(iso).slice(0, 10) : '—');

  if (loading) return <div style={{ padding: 40 }}>{t('Завантаження…')}</div>;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t('Готелі')}</h1>
        <button onClick={logout} className="btn btn-sm btn-ghost">{t('Вийти з платформи')}</button>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        {me?.email} · {t('вхід у готель записується в його журнал змін')}
      </p>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ width: 'auto' }} value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('Країна')}>
          <option value="">{t('Усі країни')}</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={setup} onChange={(e) => setSetup(e.target.value as typeof setup)} aria-label={t('Налаштування')}>
          <option value="all">{t('Будь-який стан налаштування')}</option>
          <option value="incomplete">{t('Налаштування не завершено')}</option>
          <option value="complete">{t('Налаштовано повністю')}</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{shown.length} / {orgs.length}</span>
      </div>

      {orgs.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)' }}>{t('У цій базі ще немає жодної організації.')}</div>
      )}

      {orgs.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Назва')}</th>
                <th>{t('Країна')}</th>
                <th>{t('Валюта')}</th>
                <th style={{ textAlign: 'right' }}>{t("Обʼєктів")}</th>
                <th>{t('OTA')}</th>
                <th>{t('Сайт')}</th>
                <th>{t('Створено')}</th>
                <th>{t('Налаштування')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{o.slug} · {t('користувачів')}: {o.users}{o.language ? ` · ${o.language}` : ''}</div>
                  </td>
                  <td>{o.country ?? '—'}</td>
                  <td>{o.default_currency ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{o.properties}</td>
                  <td>{o.ota ? <span className="badge badge-success">{t('є')}</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                  <td>{o.site ? <span className="badge badge-success">{t('є')}</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`badge ${o.setup_done >= o.setup_total ? 'badge-success' : 'badge-warning'}`}>{o.setup_done}/{o.setup_total}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm" disabled={busy === o.id} onClick={() => enter(o.id)}>
                      {busy === o.id ? '…' : t('Увійти')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
