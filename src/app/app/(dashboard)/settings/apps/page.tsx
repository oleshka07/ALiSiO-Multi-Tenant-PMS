'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, ToggleLeft, ToggleRight, Heart } from 'lucide-react';
import PaymentGatewayNotice from '@/components/payments/PaymentGatewayNotice';
import { notifyCurrentUserChanged } from '@/ui/hooks/useCurrentUser';

/**
 * «Застосунки» — вкладка в Налаштуваннях (З3), не пункт головного меню.
 *
 * Дві частини на одному екрані:
 *
 *   Каталог — картка на кожен запис `core/apps.ts`: назва, рід, ціна, стан.
 *   Для live — вимикач (той самий `PUT /api/settings/features`) і поля ключів
 *   (той самий `PUT /api/settings/integration-credentials`). Для «скоро» —
 *   бейдж і кнопка «хочу» (З2): попит рахує постачальник, готель бачить лише
 *   «ви позначили».
 *
 *   Здоровʼя — рядок на кожен звʼязок із чужою системою: fiskaly, пошта,
 *   менеджер каналів (з `cm_connections`), онлайн-оплата (ключ є / коду немає
 *   — чесно, як `PaymentGatewayNotice`). Стан кольором І словом; для помилки —
 *   ТЕКСТ останньої помилки і час (З7).
 *
 * Лише власник — API відмовляє решті. Екран є завжди; картки гейтяться
 * кожна своїм ключем.
 */

interface FieldSpec { field: string; label: string; hint?: string }
interface Keys { values: Record<string, string | null>; perOrganization: boolean; configured: boolean }
interface Connection {
  property_id: string | null; status: string;
  last_ok_at: string | null; last_error_at: string | null; last_error: string | null;
}
interface Card {
  id: string; kind: string; label: string; feature: string | null; fields: FieldSpec[];
  where: string; live: boolean; pricing: 'free' | 'paid' | 'included'; status: string; probeable: boolean;
  enabled: boolean | null; keys: Keys | null; connections: Connection[]; wished: boolean;
}
interface FiscalProperty { property_id: string; name: string; tss: string | null }
interface HealthRow {
  key: string; label: string; property_id: string | null; status: string;
  last_ok_at: string | null; last_error_at: string | null; last_error: string | null;
}

/** Слово і колір стану — одна мапа на картки й на здоровʼя. */
const STATUS: Record<string, { word: string; badge: string }> = {
  connected: { word: 'підключено', badge: 'badge-success' },
  error: { word: 'помилка', badge: 'badge-danger' },
  degraded: { word: 'з перебоями', badge: 'badge-warning' },
  disabled: { word: 'вимкнено', badge: 'badge-info' },
  unknown: { word: 'ще не зверталися', badge: 'badge-info' },
  soon: { word: 'скоро', badge: 'badge-primary' },
};

const KIND: Record<string, string> = {
  fiscal: 'Фіскалізація', payment: 'Оплата', mail: 'Пошта', import: 'Імпорт',
  channel: 'Канал продажу', pricing: 'Ціноутворення', device: 'Пристрій', accounting: 'Облік',
};

const PRICING: Record<string, string> = {
  free: 'безкоштовно', paid: 'платно', included: 'у складі модуля',
};

const fmt = (iso: string | null) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—');

export default function AppsSettingsPage() {
  const t = useT();
  const [cards, setCards] = useState<Card[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [fiscalProperties, setFiscalProperties] = useState<FiscalProperty[]>([]);
  const [tseProperty, setTseProperty] = useState('');
  const [tseResult, setTseResult] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/apps');
    if (!res.ok) {
      setError(res.status === 403 ? t('Доступно лише власнику') : t('Не вдалося завантажити'));
      return;
    }
    const d = await res.json();
    setCards(d.cards);
    setHealth(d.health);
    setFiscalProperties(d.fiscalProperties ?? []);
  }, [t]);

  useEffect(() => {
    load().catch(() => setError(t('Не вдалося завантажити'))).finally(() => setLoading(false));
  }, [load, t]);

  const toggle = async (card: Card) => {
    if (!card.feature) return;
    setBusy(card.id);
    try {
      const res = await fetch('/api/settings/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: card.feature, enabled: !card.enabled }),
      });
      if (res.ok) {
        await load();
        // Той самий ключ ховає пункти меню й закриває розділи в усіх копіях useCurrentUser.
        notifyCurrentUserChanged();
      }
    } finally {
      setBusy('');
    }
  };

  const saveKeys = async (card: Card) => {
    setBusy(card.id);
    setError('');
    try {
      const res = await fetch('/api/settings/integration-credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: card.id, values: drafts[card.id] || {} }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || t('Не вдалося зберегти')); return; }
      setDrafts((s) => ({ ...s, [card.id]: {} }));
      setSaved(card.id);
      setTimeout(() => setSaved(''), 2500);
      await load();
    } finally {
      setBusy('');
    }
  };

  const probe = async (card: Card) => {
    setBusy(card.id);
    setError('');
    try {
      const res = await fetch(`/api/settings/apps/${card.id}/probe`, { method: 'POST' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || t('Не вдалося перевірити')); return; }
      await load();
    } finally {
      setBusy('');
    }
  };

  // «Підключити TSE» (3.8): кроки 2–3 quickstart для обраного обʼєкта.
  const connectTse = async () => {
    setBusy('fiskaly');
    setError('');
    setTseResult('');
    try {
      const res = await fetch('/api/settings/apps/fiskaly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: tseProperty }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || t('Не вдалося підключити TSE')); await load(); return; }
      setTseResult(`${t('підключено')} · TSS ${d.tss}`);
      await load();
    } finally {
      setBusy('');
    }
  };

  const wish = async (card: Card) => {
    setBusy(card.id);
    try {
      const res = await fetch(`/api/settings/apps/${card.id}/wish`, { method: 'POST' });
      if (res.ok) setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, wished: true } : c)));
    } finally {
      setBusy('');
    }
  };

  const line = '1px solid var(--border-color)';

  return (
    <div className="app-content">
      <div className="page-header">
        <div>
          <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none', marginBottom: 8 }}>
            <ArrowLeft size={14} /> {t('Налаштування')}
          </Link>
          <h2 className="page-title">{t('Застосунки')}</h2>
          <div className="page-subtitle">{t('Звʼязок із чужими системами: ключі, стан і те, чого ще немає')}</div>
        </div>
      </div>

      {loading && <Loader2 className="animate-spin" size={20} />}
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}

      {!loading && !error && (
        <>
          <div data-testid="apps-catalog" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 28 }}>
            {cards.map((card) => {
              const st = STATUS[card.status] ?? STATUS.unknown;
              const showKeys = card.live && card.fields.length > 0 && card.enabled !== false;
              return (
                <div key={card.id} className="card" data-testid={`app-card-${card.id}`} style={{ padding: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '14px 18px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{card.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {t(KIND[card.kind] ?? card.kind)} · {t(PRICING[card.pricing])}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <span className={`badge ${st.badge}`} data-testid={`app-status-${card.id}`}>{t(st.word)}</span>
                      </div>
                    </div>
                    {card.live && card.feature && (
                      <button
                        onClick={() => toggle(card)}
                        disabled={busy === card.id}
                        aria-label={`${card.enabled ? t('Вимкнути') : t('Увімкнути')} ${card.label}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: card.enabled ? 'var(--success)' : 'var(--text-tertiary)' }}
                      >
                        {card.enabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                      </button>
                    )}
                    {!card.live && (
                      card.wished ? (
                        <span data-testid={`app-wished-${card.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                          <Check size={14} /> {t('ви позначили')}
                        </span>
                      ) : (
                        <button className="btn btn-secondary btn-sm" data-testid={`app-wish-${card.id}`} disabled={busy === card.id} onClick={() => wish(card)} style={{ whiteSpace: 'nowrap' }}>
                          <Heart size={14} /> {t('хочу')}
                        </button>
                      )
                    )}
                  </div>

                  {card.status === 'error' && card.connections.some((c) => c.last_error) && (
                    <div style={{ padding: '0 18px 12px 18px', fontSize: 12, color: 'var(--danger)' }}>
                      {card.connections.filter((c) => c.last_error).map((c, i) => (
                        <div key={i} data-testid={`app-error-${card.id}`}>
                          {t('остання помилка')}: {c.last_error} · {fmt(c.last_error_at)}
                        </div>
                      ))}
                    </div>
                  )}

                  {showKeys && (
                    <div style={{ padding: '0 18px 16px 18px', borderTop: line, paddingTop: 12 }}>
                      {card.keys && !card.keys.configured && (
                        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10 }}>
                          {t('Ключа немає — інтеграція увімкнена, але відповідатиме помилкою')}
                        </div>
                      )}
                      {card.keys?.configured && !card.keys.perOrganization && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                          {t('Зараз використовується ключ сервера. Збережіть свій, щоб від нього від\'єднатись.')}
                        </div>
                      )}
                      {card.where && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>{t('Де взяти ключі')}: {card.where}</div>
                      )}
                      {card.id === 'fiskaly' && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                          {t('Середовище TEST чи LIVE визначає ключ, не адреса: ключ TEST не підписує по-справжньому.')}
                        </div>
                      )}
                      {card.fields.map((f) => (
                        <label key={f.field} style={{ display: 'block', marginBottom: 10 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            {f.label}
                            {card.keys?.values[f.field] && (
                              <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>{t('збережено:')} {card.keys.values[f.field]}</span>
                            )}
                            {f.hint && <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>· {f.hint}</span>}
                          </div>
                          <input
                            type="password"
                            autoComplete="off"
                            data-testid={`app-key-${card.id}-${f.field}`}
                            value={drafts[card.id]?.[f.field] ?? ''}
                            onChange={(e) => setDrafts((s) => ({ ...s, [card.id]: { ...(s[card.id] || {}), [f.field]: e.target.value } }))}
                            placeholder={card.keys?.values[f.field] ? t('Замінити') : t('Вставте ключ')}
                            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: line, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                          />
                        </label>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {card.probeable && (
                          <button
                            onClick={() => probe(card)}
                            disabled={busy === card.id || !card.keys?.configured}
                            className="btn btn-secondary"
                            data-testid={`app-probe-${card.id}`}
                            style={{ fontSize: 13 }}
                          >
                            {t('Перевірити звʼязок')}
                          </button>
                        )}
                        <button
                          onClick={() => saveKeys(card)}
                          disabled={busy === card.id || !Object.values(drafts[card.id] || {}).some((v) => v !== '')}
                          className="btn btn-secondary"
                          style={{ fontSize: 13 }}
                        >
                          {busy === card.id ? t('Зберігаю…') : t('Зберегти ключі')}
                        </button>
                        {saved === card.id && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success)' }}>
                            <Check size={14} /> {t('Збережено')}
                          </span>
                        )}
                      </div>

                      {card.id === 'fiskaly' && card.keys?.configured && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: line }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('TSE обʼєкта')}</div>
                          {fiscalProperties.map((p) => (
                            <div key={p.property_id} style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }} data-testid={`tse-property-${p.property_id}`}>
                              {p.name} — {p.tss ? `${t('підключено')} · TSS ${p.tss}` : t('TSS не підключено')}
                            </div>
                          ))}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                            <select
                              className="form-select"
                              style={{ width: 'auto' }}
                              value={tseProperty}
                              onChange={(e) => setTseProperty(e.target.value)}
                              aria-label={t('Обʼєкт')}
                              data-testid="tse-property-select"
                            >
                              <option value="">{t('— оберіть обʼєкт —')}</option>
                              {fiscalProperties.filter((p) => !p.tss).map((p) => (
                                <option key={p.property_id} value={p.property_id}>{p.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={connectTse}
                              disabled={busy === card.id || !tseProperty}
                              className="btn btn-primary"
                              data-testid="tse-connect"
                              style={{ fontSize: 13 }}
                            >
                              {busy === card.id ? t('Підключаю…') : t('Підключити TSE')}
                            </button>
                            {tseResult && <span data-testid="tse-result" style={{ fontSize: 12, color: 'var(--success)' }}>{tseResult}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>{t('Здоровʼя')}</h3>
          <div className="card" data-testid="apps-health" style={{ maxWidth: 760, padding: 0 }}>
            {health.map((row, i) => {
              const st = STATUS[row.status] ?? STATUS.unknown;
              return (
                <div key={`${row.key}-${row.property_id ?? ''}`} data-testid={`health-${row.key}`} style={{ borderTop: i ? line : 'none', padding: '12px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t(row.label)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {t('останній успіх')}: {fmt(row.last_ok_at)}
                        {row.last_error_at && <> · {t('остання помилка')}: {fmt(row.last_error_at)}</>}
                      </div>
                    </div>
                    <span className={`badge ${st.badge}`}>{t(st.word)}</span>
                  </div>
                  {row.last_error && (
                    <div style={{ marginTop: 6, fontSize: 12, color: row.status === 'error' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                      {row.last_error}
                    </div>
                  )}
                  {/* Посилання «онлайн-оплата → /app/settings/payments» лишається, як було на «Модулях». */}
                  {row.key === 'online_payments' && <div style={{ marginTop: 8 }}><PaymentGatewayNotice compact /></div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
