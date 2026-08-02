'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/lib/MobileMenuContext';

/**
 * Which integrations this organization has. The same rows drive the sidebar
 * and the API — switching Teya off here makes it invisible, not de-linked.
 * Owner-only: the API refuses everyone else.
 */
export default function FeaturesSettingsPage() {
  const onMenuClick = useMobileMenu();
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    fetch('/api/settings/features')
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Доступно лише власнику' : 'Не вдалося завантажити');
        return r.json();
      })
      .then((d) => { setCatalog(d.catalog); setFeatures(d.features); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (feature: string) => {
    setBusy(feature);
    try {
      const res = await fetch('/api/settings/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, enabled: !features[feature] }),
      });
      if (res.ok) setFeatures((await res.json()).features);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Header title="Модулі та інтеграції" onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none', marginBottom: 8 }}>
              <ArrowLeft size={14} /> Налаштування
            </Link>
            <h2 className="page-title">Модулі та інтеграції</h2>
            <div className="page-subtitle">Вимкнене тут зникає з меню і перестає відповідати на запити</div>
          </div>
        </div>

        {loading && <Loader2 className="animate-spin" size={20} />}
        {error && <div className="card" style={{ color: 'var(--danger, #e5484d)' }}>{error}</div>}

        {!loading && !error && (
          <div className="card" style={{ maxWidth: 640, padding: 0 }}>
            {Object.entries(catalog).map(([key, label], i) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: i ? '1px solid var(--border-color, rgba(128,128,128,.15))' : 'none' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{key}</div>
                </div>
                <button
                  onClick={() => toggle(key)}
                  disabled={busy === key}
                  aria-label={`${features[key] ? 'Вимкнути' : 'Увімкнути'} ${label}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: features[key] ? 'var(--success, #30a46c)' : 'var(--text-tertiary)' }}
                >
                  {features[key] ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
