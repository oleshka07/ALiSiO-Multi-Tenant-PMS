'use client';

/**
 * Що означає число, яке прислав канал — і що ми додаємо зверху.
 *
 * Booking.com надсилає одну суму: «91,05 € за це проживання». Німецька фактура
 * так писати не може: вона мусить сказати, скільки з цього проживання, скільки
 * сніданок-їжа і скільки сніданок-напої, бо це три різні ставки ПДВ.
 *
 * Рецепція рахує це руками на кожне канальне бронювання. Цей екран — те місце,
 * де готель один раз каже, з чого складається ціна каналу, і після цього
 * розбивку робить система.
 *
 * Порожній канал означає «будь-який» — правило за замовчуванням. Готель з
 * однією домовленістю пише один рядок, а не шість.
 *
 * Ставки тут не вводяться числами: обирається РОЛЬ (базова / знижена / нульова),
 * а самі відсотки з датами живуть у «Фактурування → Ставки ПДВ». Інакше 7,
 * вписана сюди сьогодні, лишилася б сімкою і після наступної зміни закону.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Loader2, ArrowLeft, Coffee } from 'lucide-react';
import Link from 'next/link';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Rule {
  id: string;
  channel: string | null;
  includes_breakfast: boolean | number;
  breakfast_food_price: number;
  breakfast_drinks_price: number;
  lodging_tax_code: string;
  food_tax_code: string;
  drinks_tax_code: string;
  markup_percent: number;
}

interface TaxRate {
  code: string;
  rate: number;
  valid_from: string;
  valid_to: string | null;
}

const EMPTY = {
  channel: '', includes_breakfast: false,
  breakfast_food_price: '', breakfast_drinks_price: '',
  lodging_tax_code: 'reduced', food_tax_code: 'reduced', drinks_tax_code: 'standard',
  markup_percent: '',
};

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

export default function ChannelRulesPage() {
  // Обʼєкт із перемикача в шапці (INC-038, Д54): довідники фінансів належать
  // БУДИНКУ — два обʼєкти під одним рахунком ведуть дві бухгалтерії. `?? 'all'`
  // — це СКАЗАНЕ «усі обʼєкти», а не мовчання: на мовчання маршрут відповідає
  // 400, і це навмисно (інваріант 8).
  const { propertyId } = usePropertyScope();
  const scopeParam = propertyId ?? 'all';

  const t = useT();

  const [rules, setRules] = useState<Rule[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [r, tx] = await Promise.all([
        fetch('/api/finance/channel-rules').then((x) => x.json()),
        fetch(`/api/finance/tax-rates?property_id=${encodeURIComponent(scopeParam)}`).then((x) => x.json()),
      ]);
      setRules(r.rules || []);
      setRates(tx.rates || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const CODE_LABEL: Record<string, string> = {
    standard: t('Базова'), reduced: t('Знижена'), zero: t('Нульова'),
  };

  /** Яка ставка діє за роллю сьогодні — щоб було видно, що саме обрано. */
  const todayRate = (code: string): string => {
    const today = new Date().toISOString().slice(0, 10);
    const live = rates
      .filter((r) => r.code === code && r.valid_from <= today && (!r.valid_to || r.valid_to >= today))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    return live ? `${live.rate}%` : t('ставку не задано');
  };

  const open = (rule?: Rule) => {
    setForm(rule
      ? {
        channel: rule.channel || '',
        includes_breakfast: !!rule.includes_breakfast,
        breakfast_food_price: String(rule.breakfast_food_price ?? ''),
        breakfast_drinks_price: String(rule.breakfast_drinks_price ?? ''),
        lodging_tax_code: rule.lodging_tax_code,
        food_tax_code: rule.food_tax_code,
        drinks_tax_code: rule.drinks_tax_code,
        markup_percent: String(rule.markup_percent ?? ''),
      }
      : EMPTY);
    setModal(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/finance/channel-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: form.channel,
          includes_breakfast: form.includes_breakfast,
          breakfast_food_price: Number(String(form.breakfast_food_price).replace(',', '.')) || 0,
          breakfast_drinks_price: Number(String(form.breakfast_drinks_price).replace(',', '.')) || 0,
          lodging_tax_code: form.lodging_tax_code,
          food_tax_code: form.food_tax_code,
          drinks_tax_code: form.drinks_tax_code,
          markup_percent: Number(String(form.markup_percent).replace(',', '.')) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error)}`); return; }
      setModal(false);
      fetchAll();
    } catch (e: any) { showToast(`❌ ${t(e.message)}`); } finally { setSaving(false); }
  };

  const remove = async (rule: Rule) => {
    if (!window.confirm(t('Прибрати це правило?'))) return;
    const res = await fetch(`/api/finance/channel-rules/${rule.id}`, { method: 'DELETE' });
    if (!res.ok) showToast(`❌ ${t((await res.json()).error)}`); else fetchAll();
  };

  const breakfastTotal = (r: Rule) =>
    (Number(r.breakfast_food_price) || 0) + (Number(r.breakfast_drinks_price) || 0);

  return (
    <>
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
            <h2 className="page-title">{t('Ціни каналів')}</h2>
            <div className="page-subtitle">{t('З чого складається сума, яку прислав канал, і що ми додаємо зверху')}</div>
          </div>
          <button className="btn btn-primary" onClick={() => open()}>
            <Plus size={16} /> {t('Правило')}
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', margin: '0 0 16px', maxWidth: '80ch' }}>
          {t('Канал надсилає одну суму за проживання. Якщо в неї входить сніданок, фактура має показати його окремо — їжа й напої йдуть за різними ставками ПДВ. Проживання рахується як залишок: сума мінус сніданок, тож три рядки завжди дають рівно те число, яке прислав канал.')}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження...')}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Канал')}</th>
                  <th>{t('Сніданок у ціні')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Їжа')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Напої')}</th>
                  <th>{t('ПДВ проживання')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Націнка')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr><td colSpan={7} style={{ color: 'var(--text-tertiary)', padding: 20 }}>
                    {t('Правил немає — сума каналу піде одним рядком проживання, без розбивки.')}
                  </td></tr>
                )}
                {rules.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => open(r)}>
                    <td style={{ fontWeight: 600 }}>
                      {r.channel || <span style={{ color: 'var(--text-tertiary)' }}>{t('будь-який')}</span>}
                    </td>
                    <td>
                      {r.includes_breakfast
                        ? <span className="badge badge-primary" style={{ fontSize: 10 }}>
                          <Coffee size={10} style={{ verticalAlign: -1 }} /> {breakfastTotal(r)}
                        </span>
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.includes_breakfast ? `${r.breakfast_food_price} · ${CODE_LABEL[r.food_tax_code]}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.includes_breakfast ? `${r.breakfast_drinks_price} · ${CODE_LABEL[r.drinks_tax_code]}` : '—'}
                    </td>
                    <td>{CODE_LABEL[r.lodging_tax_code]} · {todayRate(r.lodging_tax_code)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(r.markup_percent) ? `${r.markup_percent}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                        onClick={(e) => { e.stopPropagation(); remove(r); }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title={t('Правило каналу')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal(false)}>{t('Скасувати')}</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{t('Зберегти')}</button>
          </>}
        >
          <div className="form-group">
            <label className="form-label">{t('Канал')}</label>
            <input className="input" placeholder={t('порожньо — будь-який')} value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value })} />
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {t('Код джерела бронювання, як він приходить: booking, airbnb, expedia. Порожньо — правило діє на всі канали, для яких немає свого.')}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('ПДВ проживання')}</label>
            <select className="input" value={form.lodging_tax_code}
              onChange={(e) => setForm({ ...form, lodging_tax_code: e.target.value })}>
              {['standard', 'reduced', 'zero'].map((c) => (
                <option key={c} value={c}>{CODE_LABEL[c]} — {todayRate(c)}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.includes_breakfast}
                onChange={(e) => setForm({ ...form, includes_breakfast: e.target.checked })} />
              <span className="form-label" style={{ margin: 0 }}>{t('У ціну каналу входить сніданок')}</span>
            </label>
          </div>

          {form.includes_breakfast && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{t('Їжа, на особу за ніч')}</label>
                  <input className="input" inputMode="decimal" value={form.breakfast_food_price}
                    onChange={(e) => setForm({ ...form, breakfast_food_price: e.target.value })} />
                  <select className="input" style={{ marginTop: 6 }} value={form.food_tax_code}
                    onChange={(e) => setForm({ ...form, food_tax_code: e.target.value })}>
                    {['standard', 'reduced', 'zero'].map((c) => (
                      <option key={c} value={c}>{CODE_LABEL[c]} — {todayRate(c)}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{t('Напої, на особу за ніч')}</label>
                  <input className="input" inputMode="decimal" value={form.breakfast_drinks_price}
                    onChange={(e) => setForm({ ...form, breakfast_drinks_price: e.target.value })} />
                  <select className="input" style={{ marginTop: 6 }} value={form.drinks_tax_code}
                    onChange={(e) => setForm({ ...form, drinks_tax_code: e.target.value })}>
                    {['standard', 'reduced', 'zero'].map((c) => (
                      <option key={c} value={c}>{CODE_LABEL[c]} — {todayRate(c)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                {t('Сніданок множиться на кількість гостей і ночей. Проживання — це залишок суми, тому рядки завжди сходяться до копійки.')}
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">{t('Націнка каналу, %')}</label>
            <input className="input" inputMode="decimal" value={form.markup_percent}
              onChange={(e) => setForm({ ...form, markup_percent: e.target.value })} />
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {t('Додається до ціни з матриці, коли ціни вивантажуються в цей канал. Прямі продажі вона не чіпає.')}
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}
