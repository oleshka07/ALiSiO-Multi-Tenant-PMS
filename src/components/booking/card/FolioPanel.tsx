'use client';

/**
 * Вкладка «Фінанси» картки броні — фоліо, доведене до кнопки.
 *
 * Джерело форми — Hoteliera, Financials: Totals · Services and extra products
 * · Invoices · Payments. Усе через наявні двері `@invoicing`: фоліо
 * створюється при першому нарахуванні (як у залах), рядки — `post-stay`
 * (проживання з розкладом і турзбір окремим рядком, Т5) і `charges`
 * (послуга з каталогу або ручний рядок), оплати — `payments`, документ —
 * `issue`, скасування — `storno`. Розрахунку ПДВ тут немає: ставку знає
 * сервер за датою послуги (інваріант 18).
 *
 * Спільна для настільної картки й телефона: одна логіка, два розміри.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/State';
import { statusFromFolio } from '@/modules/bookings/ui/folio-payment';
import { Receipt, Plus, CreditCard, FileText, Loader2, ArrowRight } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  booking: any;
  compact?: boolean;
  showToast: (msg: string) => void;
  /** Бронь змінилась (статус оплати) — батько перечитує список. */
  onBookingChanged?: () => void;
  setBooking?: (b: any) => void;
}

const METHODS = ['cash', 'card_terminal', 'transfer', 'voucher'] as const;

/** Причини відмов сервера — словами для рецепції. Код лишається в `detail`. */
function useReasonText() {
  const tUi = useT();
  return (code: string): string => {
    const map: Record<string, string> = {
      already_posted: tUi('Проживання вже нараховано'),
      no_amount: tUi('У броні немає суми — нараховувати нічого'),
      no_reservation: tUi('Бронь не знайдено'),
      no_service: tUi('Послугу не знайдено'),
      no_folio: tUi('Рахунок не знайдено'),
      // INC-036: рахунок без обʼєкта — названий стан, а не «послуги не
      // знайдено». Ціна і ставка ПДВ послуги належать обʼєкту, тож без нього
      // нема з чим звіряти, і мовчазне нарахування взяло б чужі числа.
      folio_without_property: tUi('Рахунок не привʼязаний до обʼєкта — ціна і ПДВ послуги залежать від обʼєкта, тож нарахувати з каталогу нема від чого'),
      no_tax_rate: tUi('Немає ставки ПДВ на дату послуги — додайте її в Налаштуваннях'),
      service_without_tax_code: tUi('У послуги не вказано код ПДВ — виправте в Налаштуваннях → Послуги'),
      city_tax_exceeds_total: tUi('Турзбір більший за суму броні — перевірте числа'),
      breakfast_exceeds_total: tUi('Сніданок більший за суму броні — перевірте правило каналу'),
    };
    return map[code] || code;
  };
}

export default function FolioPanel({ booking: b, compact, showToast, onBookingChanged, setBooking }: Props) {
  const tUi = useT();
  const reasonText = useReasonText();
  const { user } = useCurrentUser();
  const canStorno = !!user?.permissions?.includes('manage_finance_settings');

  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [open, setOpen] = useState<{ kind: 'service' | 'manual' | 'pay' | null; folioId: string | null }>({ kind: null, folioId: null });
  const today = new Date().toISOString().slice(0, 10);
  const [svcForm, setSvcForm] = useState({ serviceId: '', quantity: 1, date: today });
  const [manForm, setManForm] = useState({ description: '', quantity: 1, price: '', vat: '0' });
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash' as (typeof METHODS)[number] });
  const [newPayer, setNewPayer] = useState('');

  const currency = summary?.currency || b.currency || '';
  const fmt = (n: number) => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

  const load = useCallback(async () => {
    if (!b?.id) return;
    try {
      const res = await fetch(`/api/finance/folios?reservation_id=${b.id}&summary=1`);
      if (!res.ok) { setFailed(true); return; }
      setSummary(await res.json());
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [b?.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    fetch('/api/additional-services').then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (Array.isArray(rows)) setServices(rows.filter((s: any) => s.is_active !== 0 && s.is_active !== false)); })
      .catch(() => {});
  }, []);

  /** Один виклик — одна відповідь рецепції: успіх перечитує, відмова називає причину. */
  const call = async (run: () => Promise<Response>, failMsg: string): Promise<any | null> => {
    setBusy(true);
    try {
      const res = await run();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text = data?.error ? reasonText(String(data.error)) : failMsg;
        showToast(`❌ ${text}`);
        return null;
      }
      await load();
      return data;
    } catch { showToast(`❌ ${failMsg}`); return null; }
    finally { setBusy(false); }
  };

  const payerName = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim() || null;

  // Платник-компанія (0093): реквізити — зі знімка на броні, який сервер
  // переписав із довідника при виборі. Фоліо заморожує їх у `payer_*` —
  // саме їх читає документ (Д12).
  const companyPayer = b.company_id && b.invoice_company_name ? {
    payer_kind: 'company',
    payer_name: String(b.invoice_company_name),
    payer_address: [b.invoice_company_address, b.invoice_company_city, b.invoice_company_country].filter(Boolean).join(', ') || null,
    payer_vat_no: b.invoice_company_dic || null,
    payer_debtor_no: b.invoice_company_ico || null,
  } : null;
  const guestPayer = { payer_kind: 'guest', payer_name: payerName };

  const startFolio = () => call(async () => {
    const created = await fetch('/api/finance/folios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_id: b.id, ...(companyPayer ?? guestPayer) }),
    });
    if (!created.ok) return created;
    const { id } = await created.json();
    return fetch(`/api/finance/folios/${id}/post-stay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservation_id: b.id }),
    });
  }, tUi('Не вдалося нарахувати проживання'));

  const postStay = (folioId: string) => call(() => fetch(`/api/finance/folios/${folioId}/post-stay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservation_id: b.id }),
  }), tUi('Не вдалося нарахувати проживання')).then((r) => {
    if (r && r.posted === 0) showToast(tUi('Нового нараховувати нічого'));
  });

  const addService = (folioId: string) => {
    if (!svcForm.serviceId) return;
    call(() => fetch(`/api/finance/folios/${folioId}/charges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_id: b.id, service_id: svcForm.serviceId, quantity: svcForm.quantity, service_date: svcForm.date }),
    }), tUi('Не вдалося додати послугу')).then((r) => { if (r) setOpen({ kind: null, folioId: null }); });
  };

  const addManual = (folioId: string) => {
    if (!manForm.description.trim() || !manForm.price) return;
    call(() => fetch(`/api/finance/folios/${folioId}/charges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reservation_id: b.id, service_date: today, kind: 'manual', description: manForm.description.trim(),
        quantity: Number(manForm.quantity) || 1, unit_price_gross: Number(manForm.price), vat_rate: Number(manForm.vat) || 0,
      }),
    }), tUi('Не вдалося додати рядок')).then((r) => {
      if (r) { setOpen({ kind: null, folioId: null }); setManForm({ description: '', quantity: 1, price: '', vat: '0' }); }
    });
  };

  const pay = async (folioId: string) => {
    const amount = Number(payForm.amount);
    if (!amount) return;
    const r = await call(() => fetch(`/api/finance/folios/${folioId}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method: payForm.method }),
    }), tUi('Не вдалося записати оплату'));
    if (!r) return;
    setOpen({ kind: null, folioId: null });
    setPayForm({ amount: '', method: 'cash' });
    // Рахунок закрито — бронь стає оплаченою: саме це слово читає варта
    // заселення. Лише коли нараховано проживання і боргу нема
    // (`folioSettlesStay`): оплата за воду до нарахування бронь не закриває.
    // `payment_method` folio/folio_cash каже серверу НЕ виписувати
    // legacy-документ — документ виставляє фоліо (рецензія 07.09 п.1).
    try {
      const fresh = await fetch(`/api/finance/folios?reservation_id=${b.id}&summary=1`).then((x) => x.json());
      // Слово рахує фоліо, і воно каже не лише «оплачено»: внесок із залишком
      // робить бронь `partial` (В3). Доти частина не ставила НІЧОГО — бронь,
      // оплачена половиною, у фільтр «частково» не потрапляла взагалі.
      const word = statusFromFolio(fresh);
      if (word && word !== b.payment_status && b.payment_status !== 'prepaid') {
        const res = await fetch(`/api/bookings/${b.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_status: word, payment_method: payForm.method === 'cash' ? 'folio_cash' : 'folio' }),
        });
        if (res.ok) {
          setBooking?.({ ...b, payment_status: word });
          onBookingChanged?.();
          showToast(word === 'paid'
            ? tUi('✅ Рахунок закрито — бронь оплачена')
            : tUi('Оплату записано — бронь частково оплачена'));
        }
      }
    } catch { /* статус оплати оновиться наступним читанням */ }
  };

  const issue = (folioId: string) => call(() => fetch(`/api/finance/folios/${folioId}/issue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }), tUi('Не вдалося виставити документ')).then((r) => { if (r?.invoiceNumber) showToast(`🧾 ${r.invoiceNumber}`); });

  const storno = (invoiceId: string, number: string) => {
    if (!confirm(`${tUi('Скасувати документ')} ${number}? ${tUi('Буде виписано зустрічний документ (сторно).')}`)) return;
    call(() => fetch(`/api/finance/invoices/${invoiceId}/storno`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }), tUi('Не вдалося зробити сторно'));
  };

  const move = (itemId: string, toFolioId: string) => call(() => fetch(`/api/finance/folios/${toFolioId}/move`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_ids: [itemId] }),
  }), tUi('Не вдалося перенести позицію'));

  const addPayer = () => {
    const name = newPayer.trim();
    if (!name) return;
    call(() => fetch('/api/finance/folios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_id: b.id, payer_kind: 'guest', payer_name: name }),
    }), tUi('Не вдалося додати платника')).then((r) => { if (r) setNewPayer(''); });
  };

  /** Окреме фоліо на компанію-платника броні — коли перше вже відкрите на гостя. */
  const addCompanyPayer = () => {
    if (!companyPayer) return;
    call(() => fetch('/api/finance/folios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_id: b.id, ...companyPayer }),
    }), tUi('Не вдалося додати платника'));
  };

  if (loading) return <LoadingState compact />;
  if (failed) return <ErrorState retry={() => { setLoading(true); load(); }} />;

  const folios: any[] = summary?.folios ?? [];
  const totals = summary?.totals ?? { charged: 0, paid: 0, balance: 0 };
  const kindLabel = (k: string) => ({
    lodging: tUi('Проживання'), service: tUi('Послуга'), fee: tUi('Збір'), city_tax: tUi('Турзбір'), manual: tUi('Рядок'),
  } as Record<string, string>)[k] || k;
  const methodLabel = (m: string) => ({
    cash: tUi('Готівка'), card_terminal: tUi('Термінал'), transfer: tUi('Переказ'), voucher: tUi('Ваучер'),
  } as Record<string, string>)[m] || m;
  const invoiceStatus = (s: string) => ({
    issued: tUi('виставлено'), corrected: tUi('скасовано'), storno: tUi('сторно'), paid: tUi('оплачено'),
  } as Record<string, string>)[s] || s;

  if (folios.length === 0) {
    return (
      <EmptyState compact
        icon={<Receipt size={22} />}
        title={tUi('Рахунку ще немає')}
        hint={tUi('Рахунок броні відкривається першим нарахуванням: проживання з розкладом по ночах, збір окремим рядком, потім послуги й оплати.')}
        action={{ label: tUi('Нарахувати проживання'), onClick: startFolio, icon: <Plus size={13} /> }}
      />
    );
  }

  const tile = (label: string, value: number, tone: 'primary' | 'success' | 'danger' | 'muted') => {
    const color = tone === 'success' ? 'var(--accent-success)' : tone === 'danger' ? 'var(--accent-danger)'
      : tone === 'primary' ? 'var(--accent-primary)' : 'var(--text-primary)';
    return (
      <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-primary)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontSize: compact ? 15 : 17, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</div>
      </div>
    );
  };

  const cell: React.CSSProperties = { padding: '5px 6px', fontSize: 12, borderBottom: '1px solid var(--border-primary)', verticalAlign: 'top' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
        {tile(tUi('Нараховано'), totals.charged, 'primary')}
        {tile(tUi('Оплачено'), totals.paid, 'success')}
        {tile(tUi('Залишок'), totals.balance, totals.balance > 0 ? 'danger' : 'muted')}
      </div>

      {folios.map((f) => (
        <div key={f.id} style={{ border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-primary)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {f.payer_kind === 'company' ? '🏢' : '👤'} {f.payer_name || tUi('Гість')}
            </span>
            {f.label && <span className="badge badge-info">{f.label}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: f.balance > 0 ? 'var(--accent-danger)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
              {tUi('залишок')}: {fmt(f.balance)}
            </span>
          </div>

          {f.items.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                    <th style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>{tUi('Дата')}</th>
                    <th style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>{tUi('Опис')}</th>
                    {!compact && <th style={{ ...num, fontWeight: 500 }}>{tUi('К-ть')}</th>}
                    <th style={{ ...num, fontWeight: 500 }}>{tUi('Сума')}</th>
                    {!compact && <th style={{ ...num, fontWeight: 500 }}>{tUi('ПДВ')}</th>}
                    <th style={{ ...cell, fontWeight: 500 }}>{tUi('Документ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.items.map((it: any) => (
                    <tr key={it.id}>
                      <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{it.service_date}</td>
                      <td style={cell}>
                        <span className="badge badge-info" style={{ marginRight: 6, fontSize: 10 }}>{kindLabel(it.kind)}</span>
                        {it.description}
                      </td>
                      {!compact && <td style={num}>{it.quantity}</td>}
                      <td style={{ ...num, fontWeight: 600 }}>{fmt(it.total_gross)}</td>
                      {!compact && <td style={num}>{it.vat_rate} %</td>}
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        {it.invoice_number ? (
                          <span style={{ color: 'var(--accent-success)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{it.invoice_number}</span>
                        ) : folios.length > 1 ? (
                          <select value="" disabled={busy} className="form-select" style={{ fontSize: 11, padding: '1px 4px', width: 'auto' }}
                            onChange={(e) => { if (e.target.value) move(it.id, e.target.value); }}>
                            <option value="">{tUi('→ кому')}</option>
                            {folios.filter((o) => o.id !== f.id).map((o) => (
                              <option key={o.id} value={o.id}>{o.payer_name || o.label || '—'}</option>
                            ))}
                          </select>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{tUi('відкрито')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>{tUi('Рядків ще немає.')}</div>
          )}

          {/* Дії фоліо */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', flexWrap: 'wrap', borderTop: '1px solid var(--border-primary)' }}>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => postStay(f.id)}>
              <Plus size={12} /> {tUi('Проживання')}
            </button>
            <button className="btn btn-sm btn-secondary" disabled={busy || services.length === 0}
              title={services.length === 0 ? tUi('У готелі ще немає послуг') : undefined}
              onClick={() => setOpen(open.kind === 'service' && open.folioId === f.id ? { kind: null, folioId: null } : { kind: 'service', folioId: f.id })}>
              <Plus size={12} /> {tUi('Послуга')}
            </button>
            <button className="btn btn-sm btn-secondary" disabled={busy}
              onClick={() => setOpen(open.kind === 'manual' && open.folioId === f.id ? { kind: null, folioId: null } : { kind: 'manual', folioId: f.id })}>
              <Plus size={12} /> {tUi('Рядок')}
            </button>
            <button className="btn btn-sm btn-secondary" disabled={busy}
              onClick={() => { setPayForm((p) => ({ ...p, amount: f.balance > 0 ? String(f.balance) : '' })); setOpen(open.kind === 'pay' && open.folioId === f.id ? { kind: null, folioId: null } : { kind: 'pay', folioId: f.id }); }}>
              <CreditCard size={12} /> {tUi('Оплата')}
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy || !f.items.some((i: any) => !i.invoice_id)}
              title={!f.items.some((i: any) => !i.invoice_id) ? tUi('Усі рядки вже в документах') : undefined}
              onClick={() => issue(f.id)} style={{ marginLeft: 'auto' }}>
              <FileText size={12} /> {tUi('Виставити документ')}
            </button>
          </div>

          {open.folioId === f.id && open.kind === 'service' && (
            <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="form-select" style={{ flex: 2, minWidth: 160, fontSize: 12 }} value={svcForm.serviceId}
                onChange={(e) => setSvcForm((s) => ({ ...s, serviceId: e.target.value }))}>
                <option value="">{tUi('— оберіть послугу —')}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {Number(s.price).toLocaleString()} {s.currency || currency}{!s.vat_code ? ` · ${tUi('без коду ПДВ')}` : ''}</option>
                ))}
              </select>
              <input className="form-input" type="number" min={1} style={{ width: 64, fontSize: 12 }} value={svcForm.quantity}
                onChange={(e) => setSvcForm((s) => ({ ...s, quantity: Number(e.target.value) || 1 }))} />
              <input className="form-input" type="date" style={{ width: 140, fontSize: 12 }} value={svcForm.date}
                onChange={(e) => setSvcForm((s) => ({ ...s, date: e.target.value }))} />
              <button className="btn btn-sm btn-primary" disabled={busy || !svcForm.serviceId} onClick={() => addService(f.id)}>
                {busy ? <Loader2 size={12} className="animate-pulse" /> : <Plus size={12} />} {tUi('Додати')}
              </button>
            </div>
          )}

          {open.folioId === f.id && open.kind === 'manual' && (
            <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="form-input" placeholder={tUi('Опис')} style={{ flex: 2, minWidth: 160, fontSize: 12 }} value={manForm.description}
                onChange={(e) => setManForm((m) => ({ ...m, description: e.target.value }))} />
              <input className="form-input" type="number" min={1} style={{ width: 64, fontSize: 12 }} value={manForm.quantity}
                onChange={(e) => setManForm((m) => ({ ...m, quantity: Number(e.target.value) || 1 }))} />
              <input className="form-input" type="number" step="0.01" placeholder={tUi('Ціна')} style={{ width: 100, fontSize: 12 }} value={manForm.price}
                onChange={(e) => setManForm((m) => ({ ...m, price: e.target.value }))} />
              <input className="form-input" type="number" step="0.1" placeholder={tUi('ПДВ %')} style={{ width: 80, fontSize: 12 }} value={manForm.vat}
                onChange={(e) => setManForm((m) => ({ ...m, vat: e.target.value }))} />
              <button className="btn btn-sm btn-primary" disabled={busy || !manForm.description.trim() || !manForm.price} onClick={() => addManual(f.id)}>
                <Plus size={12} /> {tUi('Додати')}
              </button>
            </div>
          )}

          {open.folioId === f.id && open.kind === 'pay' && (
            <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="form-input" type="number" step="0.01" placeholder={`${tUi('Сума')} ${currency}`} style={{ width: 130, fontSize: 12 }}
                value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} />
              <select className="form-select" style={{ width: 150, fontSize: 12 }} value={payForm.method}
                onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value as (typeof METHODS)[number] }))}>
                {METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" disabled={busy || !Number(payForm.amount)} onClick={() => pay(f.id)}>
                <CreditCard size={12} /> {tUi('Записати оплату')}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tUi('Повернення — сума зі знаком мінус.')}</span>
            </div>
          )}

          {(f.payments.length > 0 || f.invoices.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 8, padding: '8px 12px 10px', borderTop: '1px solid var(--border-primary)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{tUi('Оплати')}</div>
                {f.payments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tUi('Оплат ще немає.')}</div>}
                {f.payments.map((p: any) => (
                  <div key={p.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0' }}>
                    <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{String(p.paid_at).slice(0, 10)}</span>
                    <span style={{ fontWeight: 600, color: p.amount < 0 ? 'var(--accent-danger)' : 'var(--accent-success)', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.amount)}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{methodLabel(p.method)}</span>
                    {p.received_by_name && <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{p.received_by_name}</span>}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{tUi('Документи')}</div>
                {f.invoices.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tUi('Документів ще немає.')}</div>}
                {f.invoices.map((inv: any) => (
                  <div key={inv.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '3px 0', flexWrap: 'wrap' }}>
                    <Receipt size={12} style={{ color: inv.status === 'issued' ? 'var(--accent-success)' : 'var(--text-tertiary)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{inv.invoice_number}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.amount)} · {invoiceStatus(inv.status)}</span>
                    <button className="btn btn-sm btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => window.open(`/api/invoices/${inv.id}`, '_blank')}>
                      {tUi('Відкрити')}
                    </button>
                    {inv.status === 'issued' && canStorno && (
                      <button className="btn btn-sm btn-ghost" style={{ fontSize: 11, padding: '1px 6px', color: 'var(--accent-warning)' }} disabled={busy}
                        onClick={() => storno(inv.id, inv.invoice_number)}>
                        {tUi('Скасувати документ')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input className="form-input" placeholder={tUi('Другий платник (імʼя або назва)')} value={newPayer} style={{ flex: 1, fontSize: 12 }}
          onChange={(e) => setNewPayer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPayer(); }} />
        <button className="btn btn-sm btn-ghost" disabled={busy || !newPayer.trim()} onClick={addPayer}>
          <ArrowRight size={12} /> {tUi('Додати платника')}
        </button>
      </div>
      {companyPayer && !folios.some((f) => f.payer_kind === 'company') && (
        <button className="btn btn-sm btn-secondary" disabled={busy} onClick={addCompanyPayer} style={{ alignSelf: 'flex-start' }}>
          🏢 {tUi('Рахунок на компанію')}: {companyPayer.payer_name}
        </button>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {tUi('Кожен платник отримує окремий документ зі своїм номером. Виставлений документ виправляється лише сторно.')}
      </div>
    </div>
  );
}
