'use client';

/**
 * Закриття касового дня — Kassenabschluss, доведений до кнопки.
 *
 * ── Чому цей екран зʼявився (ревізія 16.09.2026, П7) ────────────────────
 *
 * Писач (`closeDay`), маршрути і гейт існували з дня фіскального блоку, а
 * поверхні не було ЖОДНОЇ: закрити день можна було лише `curl`-ом. Для
 * німецького обʼєкта з увімкненим `fiscal_de` це не зручність — щоденне
 * закриття з номером Z_NR вимагає DSFinV-K, і без нього експорт нема з чого
 * будувати.
 *
 * ── Що екран каже чесно ─────────────────────────────────────────────────
 *
 * Закриття рахує те, що лежить у РАХУНКАХ ГОСТЕЙ (`fin_folio_payments`) —
 * готівка і картка на стійці. Це видно в підписі, бо інакше «0 за день»
 * читалося б як поломка.
 *
 * Каса стоїть у БУДИНКУ: без обраного обʼєкта закривати нічого (INC-029).
 * Відмови сервера показуються дослівно — вони названі («день уже закрито»,
 * «чужий обʼєкт»), і переписувати їх тут означало б другу копію правила.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@core/i18n/client';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import { EmptyState, LoadingState } from '@/components/ui/State';
import { Lock, Download, ArrowLeft, Loader2 } from 'lucide-react';

interface Closing {
  id: string;
  closing_date: string;
  closing_number: number;
  cash_total: number;
  card_total: number;
  payments_count: number;
  signed_count: number;
  failed_count: number;
  notes: string | null;
}

/** Учорашній день: закривають зазвичай його, а не поточний. */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function TillClosingPage() {
  const t = useT();
  const { propertyId, property } = usePropertyScope();
  const [rows, setRows] = useState<Closing[] | null>(null);
  const [date, setDate] = useState(yesterday());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'fail'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) { setRows([]); return; }
    try {
      const res = await fetch(`/api/finance/cash-closings?property=${encodeURIComponent(propertyId)}`);
      const data = await res.json().catch(() => ({}));
      setRows(res.ok && Array.isArray(data.closings) ? data.closings : []);
    } catch { setRows([]); }
  }, [propertyId]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const close = async () => {
    if (!propertyId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/finance/cash-closings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, date, notes: notes.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Відмова сервера — дослівно: вона названа там, де відома причина.
        setMessage({ kind: 'fail', text: String(data?.error || t('Не вдалося закрити день')) });
        return;
      }
      setMessage({ kind: 'ok', text: `${t('День закрито')} · Z-${data.closingNumber}` });
      setNotes('');
      await load();
    } catch {
      setMessage({ kind: 'fail', text: t('Не вдалося закрити день') });
    } finally { setBusy(false); }
  };

  const money = (v: number) => Number(v || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/app/documents" className="btn btn-sm btn-ghost" style={{ gap: 6 }}>
          <ArrowLeft size={14} /> {t('Документи')}
        </Link>
        <h1 style={{ margin: 0 }}>{t('🔒 Закриття касового дня')}</h1>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: '70ch' }}>
        {t('Закриття заморожує денний підсумок каси — готівку й картку на стійці з рахунків гостей — і дає йому номер. Двічі один день не закривається.')}
      </p>

      {!propertyId ? (
        <EmptyState
          title={t('Оберіть обʼєкт')}
          hint={t('Каса стоїть у будинку: підсумок дня закривається по одному обʼєкту, а не по всіх одразу.')}
        />
      ) : (
        <>
          <div className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label className="form-label" htmlFor="till-date">{t('День')}</label>
              <input id="till-date" className="form-input" type="date" value={date}
                onChange={(e) => setDate(e.target.value)} style={{ minWidth: 160 }} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label" htmlFor="till-notes">{t('Примітка')}</label>
              <input id="till-notes" className="form-input" value={notes}
                placeholder={t('Необовʼязково')} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={close} disabled={busy || !date}>
              {busy ? <Loader2 size={14} className="animate-pulse" /> : <Lock size={14} />} {t('Закрити день')}
            </button>
            <a className="btn btn-secondary"
              href={`/api/finance/cash-closings/export?property_id=${encodeURIComponent(propertyId)}&from=${date}&to=${date}`}>
              <Download size={14} /> {t('Журнал за день')}
            </a>
          </div>

          {message && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 14,
              background: message.kind === 'ok' ? 'var(--accent-success-light)' : 'var(--accent-danger-light)',
              color: message.kind === 'ok' ? 'var(--accent-success)' : 'var(--accent-danger)',
            }}>{message.text}</div>
          )}

          <h2 style={{ fontSize: 15, marginTop: 28 }}>
            {t('Закриті дні')}{property?.name ? ` · ${property.name}` : ''}
          </h2>
          {rows === null ? <LoadingState /> : rows.length === 0 ? (
            <EmptyState title={t('Жодного дня ще не закрито')}
              hint={t('Закритий день стає рядком тут — із номером, сумами й кількістю підписаних операцій.')} />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr>
                    <th>{t('Z-номер')}</th><th>{t('День')}</th>
                    <th style={{ textAlign: 'right' }}>{t('Готівка')}</th>
                    <th style={{ textAlign: 'right' }}>{t('Картка')}</th>
                    <th style={{ textAlign: 'right' }}>{t('Операцій')}</th>
                    <th>{t('Підпис')}</th><th>{t('Примітка')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>Z-{r.closing_number}</td>
                      <td>{String(r.closing_date).slice(0, 10)}</td>
                      <td style={{ textAlign: 'right' }}>{money(r.cash_total)}</td>
                      <td style={{ textAlign: 'right' }}>{money(r.card_total)}</td>
                      <td style={{ textAlign: 'right' }}>{r.payments_count}</td>
                      <td style={{ color: r.failed_count > 0 ? 'var(--accent-danger)' : 'var(--text-secondary)' }}>
                        {r.failed_count > 0
                          ? `${t('без підпису')}: ${r.failed_count}`
                          : r.signed_count > 0 ? `${t('підписано')}: ${r.signed_count}` : '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
