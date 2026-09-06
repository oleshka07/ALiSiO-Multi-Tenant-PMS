'use client';

/**
 * «Перерахувати ціну за новою заселеністю» — явна кнопка, не перемикач.
 *
 * Hoteliera перераховує сама при збереженні «Guests & Rooms details»; тут
 * рецепція міняє дорослих/дітей, тисне «Порахувати», бачить стару й нову
 * суму з різницею — і лише «Застосувати» пише число та рядок історії.
 * Квота — `POST /api/pricing/quote` (той самий шлях, що й форма броні,
 * інваріант 16); порівняння — `requoteDelta` з домену бронювань. Ціни в
 * цьому файлі немає.
 */
import React, { useState } from 'react';
import { useT, usePlural } from '@core/i18n/client';
import { requoteDelta, type RequoteDelta } from '@/modules/bookings/ui/requote';
import { readQuote } from '../quote-prefill';
import { Calculator, Check, Loader2 } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  booking: any;
  /** Тип номера — з броні або з її номера; без нього квоти не буває. */
  unitTypeId: string | null;
  showToast: (msg: string) => void;
  onApplied: (patch: { adults: number; children: number; total_price?: number; city_tax_amount?: number }) => void;
}

export default function RequotePanel({ booking: b, unitTypeId, showToast, onApplied }: Props) {
  const tUi = useT();
  const pluralUi = usePlural();
  const [adults, setAdults] = useState<number>(Number(b.adults) || 1);
  const [children, setChildren] = useState<number>(Number(b.children) || 0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ delta: RequoteDelta; cityTax: number; adults: number; children: number } | null>(null);

  const currency = b.currency || '';
  const total = Number(b.total_price) || 0;
  const fmt = (n: number) => `${n.toLocaleString()} ${currency}`;
  const unchanged = adults === (Number(b.adults) || 1) && children === (Number(b.children) || 0);

  const quote = async () => {
    if (!unitTypeId) { showToast(`❌ ${tUi('У броні немає типу номера — квоту рахувати нічим')}`); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/pricing/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitTypeId, checkIn: b.check_in, checkOut: b.check_out, adults, children }),
      });
      const body = res.ok ? await res.json() : null;
      const delta = requoteDelta({ currentTotal: total, currency: b.currency || null }, body);
      const outcome = readQuote({ ok: res.ok, body }, b.currency || null);
      setResult({ delta, cityTax: outcome.cityTax, adults, children });
    } catch {
      setResult({ delta: requoteDelta({ currentTotal: total, currency: b.currency || null }, null), cityTax: 0, adults, children });
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!result || result.delta.reason !== 'priced' || result.delta.after == null) return;
    setBusy(true);
    try {
      const patch: any = { adults: result.adults, children: result.children };
      if (result.delta.after !== total) patch.total_price = result.delta.after;
      // Збір оновлюється лише коли він УСЕРЕДИНІ суми (той самий принцип, що
      // при зміні дат): інакше це окреме число, яким керує оператор.
      if (result.cityTax > 0 && b.city_tax_included && result.cityTax !== Number(b.city_tax_amount || 0)) {
        patch.city_tax_amount = result.cityTax;
      }
      const res = await fetch(`/api/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) { showToast(`❌ ${tUi('Не вдалося зберегти нову заселеність')}`); return; }
      onApplied(patch);
      setResult(null);
      showToast(tUi('✅ Заселеність і ціну оновлено'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '10px 14px', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Calculator size={13} /> {tUi('Перерахувати ціну за новою заселеністю')}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {tUi('Дорослі')}
          <input className="form-input" type="number" min={1} value={adults} style={{ width: 70, fontSize: 12, display: 'block' }}
            onChange={(e) => { setAdults(Math.max(1, Number(e.target.value) || 1)); setResult(null); }} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {tUi('Діти')}
          <input className="form-input" type="number" min={0} value={children} style={{ width: 70, fontSize: 12, display: 'block' }}
            onChange={(e) => { setChildren(Math.max(0, Number(e.target.value) || 0)); setResult(null); }} />
        </label>
        <button className="btn btn-sm btn-secondary" disabled={busy || unchanged} onClick={quote}
          title={unchanged ? tUi('Заселеність та сама') : undefined}>
          {busy ? <Loader2 size={12} className="animate-pulse" /> : <Calculator size={12} />} {tUi('Порахувати')}
        </button>
      </div>
      {result && (
        <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {result.delta.reason === 'priced' && result.delta.after != null ? (
            <>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmt(result.delta.before)} <span style={{ color: 'var(--text-tertiary)' }}>→</span> <b>{fmt(result.delta.after)}</b>
                {' '}
                <span style={{ color: result.delta.delta > 0 ? 'var(--accent-warning)' : result.delta.delta < 0 ? 'var(--accent-success)' : 'var(--text-tertiary)' }}>
                  ({result.delta.delta > 0 ? '+' : ''}{fmt(result.delta.delta)})
                </span>
              </span>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={apply}>
                <Check size={12} /> {tUi('Застосувати')}
              </button>
            </>
          ) : result.delta.reason === 'missing' ? (
            <span style={{ color: 'var(--accent-warning)' }}>
              ⚠️ {tUi('Ціни на цю заселеність немає:')} {result.delta.missingDays} {pluralUi(result.delta.missingDays, 'ноч.')} {tUi('без ціни. Сума не змінюється.')}
            </span>
          ) : (
            <span style={{ color: 'var(--accent-warning)' }}>⚠️ {tUi('Квота не відповіла або у чужій валюті — сума не змінюється.')}</span>
          )}
        </div>
      )}
    </div>
  );
}
