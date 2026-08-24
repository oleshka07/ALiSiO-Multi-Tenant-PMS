'use client';

/**
 * Which hotel to step into.
 *
 * The list carries names and counts only — never a booking, a guest or a
 * price. Reading a customer's data starts the moment "Увійти" is pressed, and
 * that moment is written into their own change log.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Org {
  id: string;
  name: string;
  slug: string;
  language: string | null;
  default_currency: string | null;
  properties: number;
  users: number;
}

export default function PlatformHomePage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [me, setMe] = useState<{ email: string; acting: { id: string; name: string } | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
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
        setError('Не вдалося завантажити список');
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
      else setError((await res.json()).error || 'Не вдалося увійти');
    } catch {
      setError('Помилка мережі');
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch('/api/platform/logout', { method: 'POST' });
    router.push('/app/platform/login');
  }

  if (loading) return <div style={{ padding: 40 }}>Завантаження…</div>;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Готелі</h1>
        <button onClick={logout} className="btn btn-sm btn-ghost">Вийти з платформи</button>
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        {me?.email} · вхід у готель записується в його журнал змін
      </p>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      {orgs.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)' }}>У цій базі ще немає жодної організації.</div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {orgs.map((o) => (
          <div
            key={o.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
              border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', padding: '14px 16px',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {o.slug} · об'єктів: {o.properties} · користувачів: {o.users}
                {o.default_currency ? ` · ${o.default_currency}` : ''}
                {o.language ? ` · ${o.language}` : ''}
              </div>
            </div>
            <button className="btn btn-sm" disabled={busy === o.id} onClick={() => enter(o.id)}>
              {busy === o.id ? '…' : 'Увійти'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
