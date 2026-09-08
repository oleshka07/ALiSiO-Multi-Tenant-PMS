'use client';

/**
 * Валюти (Блок 5a, 2.3; П19): у чому готель веде облік і в чому ще показує суми.
 *
 * Форма — як у джерела (Hoteliera `org-settings-currencies`): база окремим
 * блоком і зверху («її не можна прибрати»), під нею таблиця
 * ВАЛЮТА · КУРС · ДЖЕРЕЛО · ДІЇ і «додати ще одну».
 *
 * Головне, чого тут НЕ можна робити, — показувати нуль замість невідомого
 * курсу. Валюта без курсу отримує слово «не задано» і кнопку, а не число:
 * «≈ 0 EUR» виглядає як факт, і саме так гість його й читає (інваріант 17,
 * застосований до курсу).
 *
 * Курс, який готель вписав сам, банк не переписує: нічний прохід ČNB
 * пропускає валюти з джерелом `manual` (див. `core/fx/cnb.ts`). Це і є
 * «фіксований курс» — фіксує його готель.
 */
import { useEffect, useState } from 'react';
import { Plus, Loader2, Save, AlertTriangle, Trash2, Check } from 'lucide-react';
import { useT } from '@core/i18n/client';

interface Secondary {
  code: string;
  rateSource: 'manual' | 'cnb';
  rate: number | null;
  rateDate: string | null;
}

export default function CurrenciesPage() {
  const tUi = useT();

  const [base, setBase] = useState('');
  const [rows, setRows] = useState<Secondary[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [supported, setSupported] = useState<string[]>([]);
  const [max, setMax] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/settings/currencies');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || tUi('Не вдалося прочитати валюти'));
        return;
      }
      const data = await res.json();
      setBase(data.base ?? '');
      setRows(data.secondary ?? []);
      setSources(data.sources ?? ['manual']);
      setSupported(data.supported ?? []);
      setMax(data.max ?? 3);
    } catch {
      setError(tUi('Не вдалося звʼязатися з сервером'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const saveList = async (next: Secondary[]) => {
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const res = await fetch('/api/settings/currencies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secondary: next.map((r) => ({ code: r.code, rateSource: r.rateSource })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || tUi('Не вдалося зберегти'));
        return;
      }
      setSaved(tUi('Збережено'));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const addCurrency = (code: string) => {
    if (!code) return;
    void saveList([...rows, { code, rateSource: 'manual', rate: null, rateDate: null }]);
  };
  const removeCurrency = (code: string) => {
    // Курси в історії лишаються: валюту можуть повернути, а документи,
    // виписані за старим курсом, мають лишитись правдивими.
    void saveList(rows.filter((r) => r.code !== code));
  };
  const changeSource = (code: string, rateSource: 'manual' | 'cnb') => {
    void saveList(rows.map((r) => (r.code === code ? { ...r, rateSource } : r)));
  };

  const saveRate = async (code: string) => {
    const raw = (rateDraft[code] ?? '').replace(',', '.').trim();
    const rate = Number(raw);
    if (!raw || !isFinite(rate) || rate <= 0) {
      setError(tUi('Курс має бути додатним числом'));
      return;
    }
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const res = await fetch('/api/settings/currencies/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, rate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || tUi('Не вдалося зберегти курс'));
        return;
      }
      setRateDraft((p) => ({ ...p, [code]: '' }));
      setSaved(tUi('Курс збережено'));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const canAdd = rows.length < max;
  const notYetAdded = supported.filter((c) => !rows.some((r) => r.code === c));

  return (
    <>

      <div className="page-content">
        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-danger-light)', color: 'var(--accent-danger)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {saved && (
          <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-success-light)', color: 'var(--accent-success)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> {saved}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Loader2 size={20} className="spin" /> {tUi('Завантаження...')}
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header" style={{ fontWeight: 600 }}>{tUi('Валюта обліку')}</div>
              <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{base || '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {tUi('Ціна, бронь, фоліо й документ — завжди в ній. Змінюється в «Загальних налаштуваннях».')}
                </span>
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{tUi('Валюти показу')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {rows.length}/{max}
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{tUi('Валюта')}</th>
                      <th style={{ textAlign: 'left' }}>{tUi('Курс')}</th>
                      <th style={{ textAlign: 'left' }}>{tUi('Джерело курсу')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.code}>
                        <td style={{ fontWeight: 600 }}>{r.code}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ minWidth: 120 }}>
                              {r.rate == null ? (
                                <span style={{ color: 'var(--accent-warning)' }}>{tUi('курс не задано')}</span>
                              ) : (
                                <>
                                  1 {r.code} = {r.rate} {base}
                                  {r.rateDate && (
                                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 6, fontSize: 11 }}>
                                      {tUi('від')} {r.rateDate}
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                            <input
                              className="form-input"
                              style={{ width: 110 }}
                              placeholder={tUi('новий курс')}
                              value={rateDraft[r.code] ?? ''}
                              onChange={(e) => setRateDraft((p) => ({ ...p, [r.code]: e.target.value }))}
                            />
                            <button className="btn btn-sm btn-secondary" onClick={() => saveRate(r.code)} disabled={saving}>
                              <Save size={13} />
                            </button>
                          </div>
                        </td>
                        <td>
                          <select
                            className="form-select"
                            style={{ width: 150 }}
                            value={r.rateSource}
                            onChange={(e) => changeSource(r.code, e.target.value as 'manual' | 'cnb')}
                          >
                            {sources.includes('manual') && <option value="manual">{tUi('фіксований готелем')}</option>}
                            {sources.includes('cnb') && <option value="cnb">{tUi('ČNB — щодня')}</option>}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-sm btn-ghost btn-icon"
                            style={{ color: 'var(--accent-danger)' }}
                            onClick={() => removeCurrency(r.code)}
                            disabled={saving}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ color: 'var(--text-tertiary)' }}>
                          {tUi('Жодної додаткової валюти: суми показуються лише у валюті обліку')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  className="form-select"
                  style={{ width: 160 }}
                  value=""
                  disabled={!canAdd || notYetAdded.length === 0}
                  onChange={(e) => addCurrency(e.target.value)}
                >
                  <option value="">{canAdd ? tUi('Додати валюту') : tUi('Більше не можна')}</option>
                  {notYetAdded.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Plus size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {tUi('Курс, який ви вписали, нічний прохід банку не переписує')}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
