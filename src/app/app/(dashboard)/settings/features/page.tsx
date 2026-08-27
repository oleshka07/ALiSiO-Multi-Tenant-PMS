'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import Header from '@/components/layout/Header';
import PaymentGatewayNotice from '@/components/payments/PaymentGatewayNotice';
import { useMobileMenu } from '@/ui/MobileMenuContext';

/**
 * Which integrations this organization has, and whose account each one uses.
 *
 * The switches and the keys belong on one screen because they answer halves of
 * the same question: turning an integration on without a token gives a menu item that
 * refuses every request, and a token saved for an integration that is off is a
 * secret nothing can use. Owner-only: the API refuses everyone else.
 *
 * ── Чому оплата тут виглядає інакше ─────────────────────────────────────
 *
 * `online_payments` — єдина фіча, чиї ключі НЕ на цьому екрані: шлюзів три
 * (Stripe, PayPal, Teya), у кожного свій набір полів і своє місце, де готель
 * ці ключі бере, тож вони живуть на `/app/settings/payments`.
 *
 * Без явного посилання це виглядало як зламане: менеджер вмикав перемикач,
 * під ним не зʼявлялось нічого — ні поля, ні пояснення, — і екран мовчав про
 * те, що півсправи ще попереду. Тому рядок оплати каже, що шлюзу поки немає в
 * продукті взагалі, і веде туди, де готель може обрати свій.
 */
const PAYMENTS_FEATURE = 'online_payments';

interface FieldSpec { field: string; label: string; hint?: string }
interface Status {
  channel: string;
  values: Record<string, string | null>;
  perOrganization: boolean;
  configured: boolean;
}

export default function FeaturesSettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [fields, setFields] = useState<Record<string, FieldSpec[]>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const loadCredentials = useCallback(async () => {
    const res = await fetch('/api/settings/integration-credentials');
    if (!res.ok) return;
    const d = await res.json();
    setFields(d.fields);
    setStatus(Object.fromEntries((d.status as Status[]).map((s) => [s.channel, s])));
  }, []);

  useEffect(() => {
    fetch('/api/settings/features')
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Доступно лише власнику' : 'Не вдалося завантажити');
        return r.json();
      })
      .then((d) => { setCatalog(d.catalog); setFeatures(d.features); })
      .then(loadCredentials)
      .catch((e) => setError(t(e.message)))
      .finally(() => setLoading(false));
  }, [loadCredentials]);

  const toggle = async (feature: string) => {
    setBusy(feature);
    try {
      const res = await fetch('/api/settings/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, enabled: !features[feature] }),
      });
      if (res.ok) {
        setFeatures((await res.json()).features);
        // Switching a feature on reveals its key fields; off hides them.
        await loadCredentials();
      }
    } finally {
      setBusy('');
    }
  };

  const saveKeys = async (channel: string) => {
    setBusy(channel);
    setError('');
    try {
      const res = await fetch('/api/settings/integration-credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, values: drafts[channel] || {} }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Не вдалося зберегти'); return; }
      setStatus((s) => ({ ...s, [channel]: d.status }));
      setDrafts((s) => ({ ...s, [channel]: {} }));
      setSaved(channel);
      setTimeout(() => setSaved(''), 2500);
    } finally {
      setBusy('');
    }
  };

  const line = '1px solid var(--border-color, rgba(128,128,128,.15))';

  return (
    <>
      <Header title={t('Модулі та інтеграції')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none', marginBottom: 8 }}>
              <ArrowLeft size={14} /> {t('Налаштування')}
            </Link>
            <h2 className="page-title">{t('Модулі та інтеграції')}</h2>
            <div className="page-subtitle">{t('Вимкнене тут зникає з меню і перестає відповідати на запити')}</div>
          </div>
        </div>

        {loading && <Loader2 className="animate-spin" size={20} />}
        {error && <div className="card" style={{ color: 'var(--danger, #e5484d)' }}>{error}</div>}

        {!loading && (
          <div className="card" style={{ maxWidth: 640, padding: 0 }}>
            {Object.entries(catalog).map(([key, label], i) => {
              const spec = features[key] ? fields[key] : undefined;
              const st = status[key];
              return (
                <div key={key} style={{ borderTop: i ? line : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{key}</div>
                    </div>
                    <button
                      onClick={() => toggle(key)}
                      disabled={busy === key}
                      aria-label={`${features[key] ? t('Вимкнути') : t('Увімкнути')} ${label}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: features[key] ? 'var(--success, #30a46c)' : 'var(--text-tertiary)' }}
                    >
                      {features[key] ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </button>
                  </div>

                  {key === PAYMENTS_FEATURE && (
                    <div style={{ padding: '0 20px 16px 20px' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                        {t('Ключі шлюзу зберігаються на окремому екрані — у кожного провайдера свої поля.')}
                        {' '}
                        {t('Списати картку продукт поки не вміє в жодного з них: збережений ключ чекає на день, коли шлюз буде готовий.')}
                      </div>
                      <PaymentGatewayNotice compact />
                    </div>
                  )}

                  {spec && spec.length > 0 && (
                    <div style={{ padding: '0 20px 16px 20px' }}>
                      {st && !st.configured && (
                        <div style={{ fontSize: 12, color: 'var(--warning, #f5a524)', marginBottom: 10 }}>
                          {t('Ключа немає — інтеграція увімкнена, але відповідатиме помилкою')}
                        </div>
                      )}
                      {st?.configured && !st.perOrganization && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                          {t('Зараз використовується ключ сервера. Збережіть свій, щоб від нього від\'єднатись.')}
                        </div>
                      )}

                      {spec.map((f) => (
                        <label key={f.field} style={{ display: 'block', marginBottom: 10 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            {f.label}
                            {st?.values[f.field] && (
                              <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
                                {t('збережено:')} {st.values[f.field]}
                              </span>
                            )}
                            {f.hint && <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>· {f.hint}</span>}
                          </div>
                          <input
                            type="password"
                            autoComplete="off"
                            value={drafts[key]?.[f.field] ?? ''}
                            onChange={(e) => setDrafts((s) => ({ ...s, [key]: { ...(s[key] || {}), [f.field]: e.target.value } }))}
                            placeholder={st?.values[f.field] ? t('Замінити') : t('Вставте ключ')}
                            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: line, background: 'var(--bg-secondary, transparent)', color: 'var(--text-primary)' }}
                          />
                        </label>
                      ))}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          onClick={() => saveKeys(key)}
                          disabled={busy === key || !Object.values(drafts[key] || {}).some((v) => v !== '')}
                          className="btn btn-secondary"
                          style={{ fontSize: 13 }}
                        >
                          {busy === key ? t('Зберігаю…') : t('Зберегти ключі')}
                        </button>
                        {saved === key && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success, #30a46c)' }}>
                            <Check size={14} /> {t('Збережено')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
