'use client';

/**
 * Бланк фактури цього готеля.
 *
 * Тут стояли дві константи в коді, і друга була гіршою за першу.
 * `INVOICE_DUE_DAYS = 14` — просто чуже рішення, накинуте всім.
 * `BUYER_NAME_THRESHOLD_CZK = 9900` — межа чеського «спрощеного податкового
 * документа», тобто норма ОДНІЄЇ юрисдикції; а оскільки поріг у кронах, а
 * порівнювалася з ним сума документа як є, готель, який рахує в євро,
 * порівнював євро з кронами.
 *
 * Тому поріг тут підписаний ВАЛЮТОЮ ГОТЕЛЮ — вона приїжджає з сервера разом
 * із налаштуваннями. Порожнє поле означає «називати покупця завжди», і це
 * сказано словами: для юрисдикції, правил якої ми не знаємо, зайве імʼя на
 * документі це незручність, а відсутнє — порушення.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { Save, Loader2, AlertTriangle } from 'lucide-react';

interface Settings {
  dueDays: number;
  buyerNameThreshold: number | null;
  logoUrl: string | null;
  accentColor: string | null;
  footerNote: string | null;
  showPaymentQr: boolean;
}

export default function InvoiceBlank() {
  const t = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [currency, setCurrency] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/invoicing/settings');
      const body = await res.json();
      if (!res.ok) { setError(body.error || t('Не вдалося прочитати налаштування')); return; }
      setError(null);
      setS(body.settings);
      setCurrency(body.currency || '');
    } catch {
      setError(t('Не вдалося прочитати налаштування'));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch('/api/invoicing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      const body = await res.json();
      if (!res.ok) { setMsg(body.error || t('Не вдалося зберегти')); return; }
      setS(body.settings);
      setMsg(t('✅ Збережено'));
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">{t('Бланк фактури')}</div></div>
        <div style={{ padding: 20, display: 'flex', gap: 10, color: 'var(--danger, #b91c1c)' }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 14 }}>{error}</div>
        </div>
      </div>
    );
  }
  if (!s) return null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title">{t('Бланк фактури')}</div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />} {t('Зберегти')}
        </button>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 18, lineHeight: 1.6 }}>
          {t('Ці правила діють на кожен документ цього готелю. Уже виписані фактури не змінюються — кожна несе свої правила з дня видачі.')}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Строк оплати, днів')}</label>
            <input
              className="form-input" inputMode="numeric" style={{ maxWidth: 120 }}
              value={s.dueDays}
              onChange={(e) => set('dueDays', Number(e.target.value.replace(/\D/g, '')) || 0)}
            />
            <div className="form-hint">{t('Те саме число йде і в дату оподаткованої операції (DUZP).')}</div>
          </div>

          <div className="form-group">
            <label className="form-label">
              {t('Покупця не називати до суми')}{currency ? `, ${currency}` : ''}
            </label>
            <input
              className="form-input" inputMode="decimal" style={{ maxWidth: 160 }}
              placeholder={t('називати завжди')}
              value={s.buyerNameThreshold ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                set('buyerNameThreshold', raw === '' ? null : Number(raw.replace(',', '.')));
              }}
            />
            <div className="form-hint">
              {t('Порожньо — імʼя покупця друкується завжди. Це безпечний вибір: зайве імʼя на документі це незручність, відсутнє — порушення.')}
              {currency ? ` ${t('Поріг — у валюті готелю')} (${currency}).` : ''}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Логотип, посилання')}</label>
            <input
              className="form-input" placeholder="https://…"
              value={s.logoUrl ?? ''}
              onChange={(e) => set('logoUrl', e.target.value || null)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Акцентний колір')}</label>
            <input
              className="form-input" placeholder="#1f6feb" style={{ maxWidth: 140 }}
              value={s.accentColor ?? ''}
              onChange={(e) => set('accentColor', e.target.value || null)}
            />
            <div className="form-hint">{t('Формат #RRGGBB.')}</div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('Підпис унизу документа')}</label>
          <input
            className="form-input"
            placeholder={t('Дякуємо за візит')}
            value={s.footerNote ?? ''}
            onChange={(e) => set('footerNote', e.target.value || null)}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6 }}>
          <input
            type="checkbox"
            checked={s.showPaymentQr}
            onChange={(e) => set('showPaymentQr', e.target.checked)}
          />
          <span style={{ fontSize: 14 }}>{t('Друкувати платіжний QR-код')}</span>
        </label>

        {msg && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-secondary)' }}>{msg}</div>}
      </div>
    </div>
  );
}
