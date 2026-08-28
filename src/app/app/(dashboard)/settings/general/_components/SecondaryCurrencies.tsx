'use client';

/**
 * Другорядні валюти: у чому ще показувати суми, і звідки брати курс.
 *
 * ── Що тут навмисно не робиться ─────────────────────────────────────────
 *
 * Немає приблизного курсу. Валюта без курсу показується як «курс не заданий»,
 * а не як число, порахане за чимось «схожим». Це той самий інваріант 17, що
 * забороняє продавати ніч за вигаданою ціною: сума в EUR, порахована за
 * курсом, якого готель не називав, — це не «приблизно», це чуже число з
 * нашим підписом.
 *
 * Немає й перерахунку історії при зміні валют. Кожен виписаний документ несе
 * свою валюту рядком — саме тому й несе.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { Plus, Trash2, Save, Loader2, AlertTriangle } from 'lucide-react';

interface Secondary {
  code: string;
  rateSource: 'manual' | 'cnb';
  rate: number | null;
  rateDate: string | null;
}

interface Payload {
  base: string;
  secondary: Secondary[];
  sources: ('manual' | 'cnb')[];
  supported: string[];
  max: number;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Вручну',
  cnb: 'ČNB — щодня автоматично',
};

export default function SecondaryCurrencies({ onToast }: { onToast: (m: string) => void }) {
  const t = useT();
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<Secondary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/currencies');
      const body = await res.json();
      if (!res.ok) { setError(body.error || t('Не вдалося прочитати валюти')); return; }
      setError(null);
      setData(body);
      setRows(body.secondary ?? []);
    } catch {
      setError(t('Не вдалося прочитати валюти'));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function save(next: Secondary[]) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/currencies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secondary: next.map((r) => ({ code: r.code, rateSource: r.rateSource })) }),
      });
      const body = await res.json();
      if (!res.ok) { onToast(body.error || t('Не вдалося зберегти')); return; }
      setRows(body.secondary ?? next);
      onToast(t('✅ Збережено'));
    } finally {
      setSaving(false);
    }
  }

  async function saveRate(code: string) {
    const raw = (rateDraft[code] ?? '').replace(',', '.').trim();
    const value = Number(raw);
    if (!raw || !isFinite(value) || value <= 0) { onToast(t('Курс має бути додатним числом')); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/currencies/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, rate: value }),
      });
      const body = await res.json();
      if (!res.ok) { onToast(body.error || t('Не вдалося зберегти курс')); return; }
      setRateDraft((d) => ({ ...d, [code]: '' }));
      await load();
      onToast(t('✅ Курс збережено'));
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">{t('Додаткові валюти')}</div></div>
        <div style={{ padding: 20, display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--danger, #b91c1c)' }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 14 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const available = data.supported.filter((c) => !rows.some((r) => r.code === c));
  const canAdd = rows.length < data.max && available.length > 0;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header"><div className="card-title">{t('Додаткові валюти')}</div></div>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
          {t('Облік залишається в основній валюті')} ({data.base}).{' '}
          {t('Тут — валюти, у яких додатково показуються суми: гостю у віджеті, партнеру у звіті. Не більше трьох.')}
        </div>

        {rows.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 14 }}>
            {t('Додаткових валют немає — усі суми показуються в основній.')}
          </div>
        )}

        {rows.map((row, i) => (
          <div
            key={row.code}
            style={{
              display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
              padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border, rgba(0,0,0,.07))',
            }}
          >
            <div style={{ minWidth: 78 }}>
              <label className="form-label">{t('Валюта')}</label>
              <div style={{ fontSize: 15, fontWeight: 600, paddingTop: 6 }}>{row.code}</div>
            </div>

            <div style={{ minWidth: 210 }}>
              <label className="form-label">{t('Курс оновлюється')}</label>
              <select
                className="form-select"
                value={row.rateSource}
                onChange={(e) => {
                  const next = rows.map((r) => r.code === row.code
                    ? { ...r, rateSource: e.target.value as 'manual' | 'cnb' } : r);
                  setRows(next);
                  save(next);
                }}
              >
                {data.sources.map((s) => <option key={s} value={s}>{t(SOURCE_LABEL[s] ?? s)}</option>)}
              </select>
            </div>

            <div style={{ minWidth: 240, flex: 1 }}>
              <label className="form-label">
                {t('Курс')} — 1 {row.code} = ? {data.base}
              </label>
              {row.rate == null ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    inputMode="decimal"
                    placeholder={t('курс не заданий')}
                    value={rateDraft[row.code] ?? ''}
                    onChange={(e) => setRateDraft((d) => ({ ...d, [row.code]: e.target.value }))}
                    style={{ maxWidth: 140 }}
                  />
                  <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => saveRate(row.code)}>
                    <Save size={14} /> {t('Зберегти')}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    inputMode="decimal"
                    placeholder={String(row.rate)}
                    value={rateDraft[row.code] ?? ''}
                    onChange={(e) => setRateDraft((d) => ({ ...d, [row.code]: e.target.value }))}
                    style={{ maxWidth: 140 }}
                  />
                  {(rateDraft[row.code] ?? '') !== '' && (
                    <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => saveRate(row.code)}>
                      <Save size={14} /> {t('Зберегти')}
                    </button>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {row.rate} · {t('від')} {row.rateDate}
                  </span>
                </div>
              )}
              {row.rate == null && (
                <div className="form-hint" style={{ color: 'var(--danger, #b91c1c)' }}>
                  {t('Поки курсу немає, суми в цій валюті не показуються — вигадане число гірше за його відсутність.')}
                </div>
              )}
            </div>

            <button
              className="btn btn-ghost btn-sm"
              aria-label={t('Прибрати')}
              disabled={saving}
              onClick={() => { const next = rows.filter((r) => r.code !== row.code); setRows(next); save(next); }}
              style={{ color: 'var(--danger, #b91c1c)' }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}

        {canAdd && (
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="form-select"
              value=""
              style={{ maxWidth: 140 }}
              onChange={(e) => {
                if (!e.target.value) return;
                const next = [...rows, { code: e.target.value, rateSource: 'manual' as const, rate: null, rateDate: null }];
                setRows(next);
                save(next);
              }}
            >
              <option value="">{t('— додати валюту —')}</option>
              {available.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {saving && <Loader2 size={15} className="animate-pulse" style={{ color: 'var(--text-tertiary)' }} />}
            {!saving && <Plus size={15} style={{ color: 'var(--text-tertiary)' }} />}
          </div>
        )}

        {rows.length >= data.max && (
          <div className="form-hint" style={{ marginTop: 12 }}>
            {t('Досягнуто межі в три валюти. Більше — це вже мультивалютний облік, а не показ сум.')}
          </div>
        )}
      </div>
    </div>
  );
}
