'use client';

/**
 * Фактурування: ставки ПДВ і серії нумерації.
 *
 * Ці два налаштування були константами в коді — ПДВ не існував узагалі, а
 * серії й формат номера були домовленістю одного готелю з одним бухгалтером.
 * Другий ринок зробив обидва неможливими. Екран існує, щоб наступний готель
 * завівся без коміту.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { Plus, Trash2, X, Save, Loader2, ArrowLeft, Hash, Percent, Lock } from 'lucide-react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TaxRate {
  id: string;
  code: 'standard' | 'reduced' | 'zero';
  rate: number;
  label: string | null;
  valid_from: string;
  valid_to: string | null;
}

interface Series {
  id: string;
  code: string;
  channel: string | null;
  prefix: string;
  number_format: string;
  is_default: boolean | number;
  sort_order: number;
  last_no: number;
  preview: string;
}

function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export default function InvoicingSettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();

  const [rates, setRates] = useState<TaxRate[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const [rateModal, setRateModal] = useState(false);
  const [rateForm, setRateForm] = useState({ code: 'reduced', rate: '', label: '', valid_from: '', valid_to: '' });

  const [seriesModal, setSeriesModal] = useState(false);
  const [editingSeries, setEditingSeries] = useState<Series | null>(null);
  const [seriesForm, setSeriesForm] = useState({ code: '', channel: '', prefix: '', number_format: '{prefix}{year}-{seq:3}', is_default: false });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        fetch('/api/finance/tax-rates').then((x) => x.json()),
        fetch('/api/finance/invoice-series').then((x) => x.json()),
      ]);
      setRates(r.rates || []);
      setSeries(s.series || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── ставки ────────────────────────────────────────────────────────────────
  const openRate = () => {
    setRateForm({ code: 'reduced', rate: '', label: '', valid_from: '', valid_to: '' });
    setRateModal(true);
  };

  const saveRate = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/finance/tax-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: rateForm.code,
          rate: Number(rateForm.rate),
          label: rateForm.label || null,
          valid_from: rateForm.valid_from,
          valid_to: rateForm.valid_to || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error)}`); return; }
      setRateModal(false);
      fetchAll();
    } catch (e: any) { showToast(`❌ ${t(e.message)}`); } finally { setSaving(false); }
  };

  const closeRate = async (r: TaxRate) => {
    const to = window.prompt(t('Останній день дії ставки (РРРР-ММ-ДД):'), '');
    if (!to) return;
    const res = await fetch(`/api/finance/tax-rates/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid_to: to }),
    });
    const data = await res.json();
    if (!res.ok) showToast(`❌ ${t(data.error)}`); else fetchAll();
  };

  const removeRate = async (r: TaxRate) => {
    if (!window.confirm(t('Видалити ставку? Це можна робити лише поки нею нічого не нараховано.'))) return;
    const res = await fetch(`/api/finance/tax-rates/${r.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) showToast(`❌ ${t(data.error)}`); else fetchAll();
  };

  // ── серії ─────────────────────────────────────────────────────────────────
  const openSeries = (s?: Series) => {
    setEditingSeries(s || null);
    setSeriesForm(s
      ? { code: s.code, channel: s.channel || '', prefix: s.prefix || '', number_format: s.number_format, is_default: !!s.is_default }
      : { code: '', channel: '', prefix: '', number_format: '{prefix}{year}-{seq:3}', is_default: false });
    setSeriesModal(true);
  };

  const saveSeries = async () => {
    setSaving(true);
    try {
      const url = editingSeries ? `/api/finance/invoice-series/${editingSeries.id}` : '/api/finance/invoice-series';
      const res = await fetch(url, {
        method: editingSeries ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seriesForm),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error)}`); return; }
      setSeriesModal(false);
      fetchAll();
    } catch (e: any) { showToast(`❌ ${t(e.message)}`); } finally { setSaving(false); }
  };

  const removeSeries = async (s: Series) => {
    if (!window.confirm(`${t('Видалити серію')} ${s.code}?`)) return;
    const res = await fetch(`/api/finance/invoice-series/${s.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) showToast(`❌ ${t(data.error)}`); else fetchAll();
  };

  const CODE_LABEL: Record<string, string> = {
    standard: t('Базова'), reduced: t('Знижена'), zero: t('Нульова'),
  };

  return (
    <>
      <Header title={t('Фактурування')} onMenuClick={onMenuClick} />
      <div className="app-content">
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: toast.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
            color: '#fff', padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>{toast}</div>
        )}

        <div className="page-header">
          <div>
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> {t('Налаштування')}
            </Link>
            <h2 className="page-title">{t('Фактурування')}</h2>
            <div className="page-subtitle">{t('Ставки ПДВ і серії нумерації цього готелю')}</div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження...')}
          </div>
        ) : (
          <>
            {/* ── ПДВ ────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
              <Percent size={16} style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Ставки ПДВ')}</span>
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={openRate}>
                <Plus size={14} /> {t('Додати ставку')}
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 12, maxWidth: '80ch' }}>
              {t('Ставка обирається за датою послуги, а не за датою фактури, і записується на нарахування числом. Тому стару ставку не видаляють — їй ставлять останній день дії.')}
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Роль')}</th>
                    <th>{t('Ставка')}</th>
                    <th>{t('Підпис')}</th>
                    <th>{t('Діє з')}</th>
                    <th>{t('Діє до')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rates.length === 0 && (
                    <tr><td colSpan={6} style={{ color: 'var(--text-tertiary)', padding: 20 }}>
                      {t('Ставок ще немає. Без них фактура з ПДВ не виставиться.')}
                    </td></tr>
                  )}
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td>{CODE_LABEL[r.code] || r.code}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.rate}%</td>
                      <td>{r.label || '—'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.valid_from}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.valid_to || <span style={{ color: 'var(--accent-success)' }}>{t('чинна')}</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {!r.valid_to && (
                          <button className="btn btn-sm btn-ghost" onClick={() => closeRate(r)} title={t('Закрити датою')}>
                            <Lock size={14} />
                          </button>
                        )}
                        <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }} onClick={() => removeRate(r)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── серії ──────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '28px 0 12px' }}>
              <Hash size={16} style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Серії нумерації')}</span>
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => openSeries()}>
                <Plus size={14} /> {t('Додати серію')}
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 12, maxWidth: '80ch' }}>
              {t('Поки серій немає, нумерація працює як раніше. Лічильник привʼязаний до серії: нова серія починає рахунок з одиниці.')}
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Серія')}</th>
                    <th>{t('Канал')}</th>
                    <th>{t('Шаблон номера')}</th>
                    <th>{t('Наступний номер')}</th>
                    <th>{t('Видано')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {series.length === 0 && (
                    <tr><td colSpan={6} style={{ color: 'var(--text-tertiary)', padding: 20 }}>
                      {t('Своїх серій немає — діють вбудовані.')}
                    </td></tr>
                  )}
                  {series.map((s) => (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openSeries(s)}>
                      <td style={{ fontWeight: 600 }}>
                        {s.code}{' '}
                        {!!s.is_default && <span className="badge badge-primary" style={{ fontSize: 10 }}>{t('за замовчуванням')}</span>}
                      </td>
                      <td>{s.channel || '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.number_format}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.preview}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.last_no}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-sm btn-ghost btn-icon"
                          style={{ color: 'var(--accent-danger)' }}
                          onClick={(e) => { e.stopPropagation(); removeSeries(s); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── модалка ставки ───────────────────────────────────────────────── */}
        <Modal
          open={rateModal}
          onClose={() => setRateModal(false)}
          title={t('Нова ставка ПДВ')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setRateModal(false)}>{t('Скасувати')}</button>
              <button className="btn btn-primary" onClick={saveRate} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t('Зберегти')}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">{t('Роль')}</label>
              <select className="form-select" value={rateForm.code} onChange={(e) => setRateForm((p) => ({ ...p, code: e.target.value }))}>
                <option value="standard">{t('Базова')}</option>
                <option value="reduced">{t('Знижена')}</option>
                <option value="zero">{t('Нульова')}</option>
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {t('Послуга вказує на роль, а не на число — тож зміна відсотка не потребує правок у послугах.')}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">{t('Відсоток')}</label>
                <input className="form-input" type="number" step="0.01" value={rateForm.rate}
                  onChange={(e) => setRateForm((p) => ({ ...p, rate: e.target.value }))} placeholder="7" />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Підпис для рекапітуляції')}</label>
                <input className="form-input" value={rateForm.label}
                  onChange={(e) => setRateForm((p) => ({ ...p, label: e.target.value }))} placeholder="7 % MwSt" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">{t('Діє з')}</label>
                <input className="form-input" type="date" value={rateForm.valid_from}
                  onChange={(e) => setRateForm((p) => ({ ...p, valid_from: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Діє до (порожньо — чинна)')}</label>
                <input className="form-input" type="date" value={rateForm.valid_to}
                  onChange={(e) => setRateForm((p) => ({ ...p, valid_to: e.target.value }))} />
              </div>
            </div>
          </div>
        </Modal>

        {/* ── модалка серії ────────────────────────────────────────────────── */}
        <Modal
          open={seriesModal}
          onClose={() => setSeriesModal(false)}
          title={editingSeries ? `${t('Серія')} ${editingSeries.code}` : t('Нова серія')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setSeriesModal(false)}>{t('Скасувати')}</button>
              <button className="btn btn-primary" onClick={saveSeries} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t('Зберегти')}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">{t('Код серії')}</label>
                <input className="form-input" value={seriesForm.code} disabled={!!editingSeries}
                  onChange={(e) => setSeriesForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="RG" />
                {editingSeries && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {t('Код не змінюється: лічильник привʼязаний до нього, і перейменування залишило б видані номери позаду.')}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">{t('Канал')}</label>
                <input className="form-input" value={seriesForm.channel}
                  onChange={(e) => setSeriesForm((p) => ({ ...p, channel: e.target.value }))} placeholder="house / booking / airbnb" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">{t('Префікс')}</label>
                <input className="form-input" value={seriesForm.prefix}
                  onChange={(e) => setSeriesForm((p) => ({ ...p, prefix: e.target.value }))} placeholder="BKG-" />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Шаблон номера')}</label>
                <input className="form-input" style={{ fontFamily: 'monospace' }} value={seriesForm.number_format}
                  onChange={(e) => setSeriesForm((p) => ({ ...p, number_format: e.target.value }))} />
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              {t('Токени:')} <code>{'{prefix}'}</code> <code>{'{year}'}</code> <code>{'{yy}'}</code>{' '}
              <code>{'{seq}'}</code> <code>{'{seq:3}'}</code> — {t('решта символів іде як є.')}
              <br />
              {t('Приклад:')} <b style={{ fontVariantNumeric: 'tabular-nums' }}>
                {seriesForm.number_format
                  .replace(/\{prefix\}/g, seriesForm.prefix)
                  .replace(/\{year\}/g, String(new Date().getFullYear()))
                  .replace(/\{yy\}/g, String(new Date().getFullYear()).slice(-2))
                  .replace(/\{seq:(\d+)\}/g, (_m, n) => '1'.padStart(Number(n), '0'))
                  .replace(/\{seq\}/g, '1')}
              </b>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={seriesForm.is_default}
                onChange={(e) => setSeriesForm((p) => ({ ...p, is_default: e.target.checked }))} />
              {t('За замовчуванням для каналів без власної серії')}
            </label>
          </div>
        </Modal>
      </div>
    </>
  );
}
