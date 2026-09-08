'use client';

/**
 * Аркуші дня — те, що рецепція щоранку пише від руки й ксерить.
 *
 * Чотири аркуші, кожен відповідає на питання, яке ставлять до девʼятої:
 *
 *   Список номерів   хто сьогодні в домі і в якому номері
 *   Сніданок         на скількох людей кухня готує завтра
 *   Ключі            які ключі сьогодні видати, а які приймуть назад
 *   Закриття дня     що виставлено сьогодні, у розрізі ставок
 *
 * Друкується прямо звідси: `@media print` прибирає все, крім таблиці. Окремої
 * «сторінки для друку» немає навмисно — сторінка для друку розходиться з
 * екранною, і розходиться саме тоді, коли її ніхто не дивиться.
 *
 * Нічого не зберігається. Аркуш, надрукований учора, — це вчорашня відповідь;
 * таблиця «збережених аркушів» була б другою копією даних, які вже є.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import { Printer, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { money } from '@core/money';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Kind = 'house' | 'breakfast' | 'keys' | 'day-close';

const today = () => new Date().toISOString().slice(0, 10);

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default function DaySheetsPage() {
  const t = useT();

  const [date, setDate] = useState(today());
  const [kind, setKind] = useState<Kind>('house');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const TABS: { key: Kind; label: string; hint: string }[] = [
    { key: 'house', label: t('Список номерів'), hint: t('хто в домі цієї ночі') },
    { key: 'breakfast', label: t('Сніданок'), hint: t('на скількох готувати вранці') },
    { key: 'keys', label: t('Ключі'), hint: t('видати і прийняти') },
    { key: 'day-close', label: t('Закриття дня'), hint: t('що виставлено сьогодні') },
  ];

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/day-sheets/${kind}?date=${date}`);
      const data = await res.json();
      setRows(res.ok ? (data.rows || []) : []);
    } catch (e) { console.error(e); setRows([]); }
    setLoading(false);
  }, [kind, date]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const persons = (r: any) => (Number(r.adults) || 0) + (Number(r.children) || 0);
  const current = TABS.find((x) => x.key === kind)!;

  return (
    <>
      <div className="app-content">
        {/* Друкується лише .sheet — решта зникає. */}
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .sheet, .sheet * { visibility: visible; }
            .sheet { position: absolute; left: 0; top: 0; width: 100%; }
            .sheet table { font-size: 11pt; }
            .no-print { display: none !important; }
          }
        `}</style>

        <div className="page-header no-print">
          <div>
            <h2 className="page-title">{t('Аркуші дня')}</h2>
            <div className="page-subtitle">{t('Те, що рецепція щоранку виписує від руки — тепер друкується')}</div>
          </div>
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Printer size={16} /> {t('Друк')}
          </button>
        </div>

        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => setDate(shift(date, -1))}><ChevronLeft size={14} /></button>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
          <button className="btn btn-sm btn-secondary" onClick={() => setDate(shift(date, 1))}><ChevronRight size={14} /></button>
          <button className="btn btn-sm btn-ghost" onClick={() => setDate(today())}>{t('Сьогодні')}</button>
        </div>

        <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {TABS.map((tab) => (
            <button key={tab.key}
              className={`btn btn-sm ${tab.key === kind ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setKind(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження...')}
          </div>
        ) : (
          <div className="sheet">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{current.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                {date} · {current.hint} · {t('рядків')}: {rows.length}
              </div>
            </div>

            {rows.length === 0 ? (
              <div style={{ color: 'var(--text-tertiary)', padding: 20 }}>{t('На цю дату порожньо.')}</div>
            ) : kind === 'day-close' ? (
              <DayClose rows={rows} t={t} />
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      {kind === 'keys' && <th>{t('Дія')}</th>}
                      <th>{t('Номер')}</th>
                      <th>{t('Гість')}</th>
                      {kind === 'breakfast' && <th style={{ textAlign: 'right' }}>{t('Осіб')}</th>}
                      {kind === 'breakfast' && <th>{t('Сніданок')}</th>}
                      {kind !== 'breakfast' && <th>{t('Заїзд')}</th>}
                      {kind !== 'breakfast' && <th>{t('Виїзд')}</th>}
                      {kind === 'house' && <th style={{ textAlign: 'right' }}>{t('Осіб')}</th>}
                      <th>{t('Нотатка')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={`${r.reservation_id}-${r.direction || ''}`}>
                        {kind === 'keys' && (
                          <td style={{ fontWeight: 600 }}>
                            {r.direction === 'out' ? t('видати') : t('прийняти')}
                          </td>
                        )}
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {r.unit_code || r.unit_name || '—'}
                          {r.category && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · {r.category}</span>}
                        </td>
                        <td>{r.guest_name}</td>
                        {kind === 'breakfast' && (
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                            {r.persons}
                          </td>
                        )}
                        {kind === 'breakfast' && (
                          <td>
                            {r.included
                              ? t('у ціні')
                              : r.ordered > 0
                                ? `${t('замовлено')}: ${r.ordered}`
                                : <span style={{ color: 'var(--text-tertiary)' }}>{t('немає')}</span>}
                          </td>
                        )}
                        {kind !== 'breakfast' && <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.check_in}</td>}
                        {kind !== 'breakfast' && <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.check_out}</td>}
                        {kind === 'house' && (
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{persons(r)}</td>
                        )}
                        <td style={{ fontSize: 12 }}>{r.notes || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {kind === 'breakfast' && rows.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700 }}>
                {/* Число, заради якого кухня цей аркуш і бере. */}
                {t('Разом осіб на сніданок')}: {rows.reduce((s: number, r: any) => s + (r.included || r.ordered > 0 ? r.persons : 0), 0)}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Закриття дня: документи й підсумок за ставками. */
function DayClose({ rows, t }: { rows: any[]; t: (s: string) => string }) {
  const byRate = new Map<number, { gross: number; net: number; tax: number }>();
  for (const inv of rows) {
    for (const g of inv.by_rate || []) {
      const acc = byRate.get(g.vat_rate) ?? { gross: 0, net: 0, tax: 0 };
      byRate.set(g.vat_rate, {
        gross: acc.gross + g.gross, net: acc.net + g.net, tax: acc.tax + g.tax,
      });
    }
  }
  // `money()` замість трюку з EPSILON: додавання епсилона зсуває лише ті
  // випадки, де похибка додатна, і мовчки псує вїд’ємні. Один хелпер на
  // весь продукт, і він уже написаний.
  const round = (n: number) => money(n);
  const total = round([...byRate.values()].reduce((s, g) => s + g.gross, 0));

  return (
    <>
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>{t('Документ')}</th>
              <th>{t('Серія')}</th>
              <th>{t('Статус')}</th>
              <th style={{ textAlign: 'right' }}>{t('Сума')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv: any) => (
              <tr key={inv.invoice_number}>
                <td style={{ fontWeight: 600 }}>{inv.invoice_number}</td>
                <td>{inv.series || '—'}</td>
                <td>{inv.status}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{round(inv.gross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, fontWeight: 600, marginBottom: 6 }}>{t('За ставками')}</div>
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>{t('Ставка')}</th>
              <th style={{ textAlign: 'right' }}>{t('Брутто')}</th>
              <th style={{ textAlign: 'right' }}>{t('Нетто')}</th>
              <th style={{ textAlign: 'right' }}>{t('Податок')}</th>
            </tr>
          </thead>
          <tbody>
            {[...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, g]) => (
              <tr key={rate}>
                <td style={{ fontWeight: 600 }}>{rate} %</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{round(g.gross)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{round(g.net)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{round(g.tax)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>{t('Разом')}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total}</td>
              <td /><td />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
