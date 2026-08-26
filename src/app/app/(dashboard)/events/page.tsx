/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * Halls for reception: who is in which Saal today, and the bill for it.
 *
 * One deliberate asymmetry runs through this screen. BOOKING a hall is
 * strict — the server refuses overlapping hours, and this page just relays
 * the refusal. PRICING a hall is loose — the price field is prefilled from
 * the sheet's time-block suggestion and stays editable, because the owner's
 * one requirement was «Preise sind variabel … müssen manuell einpflegbar
 * sein». The suggestion saves typing; it never decides.
 */
import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { Plus, X, Loader2, FileText, Ban } from 'lucide-react';
import { suggestedBlockPrice, minutesBetween } from '@/modules/events/domain/event-pricing';

interface Space {
  id: string; name: string; code: string;
  capacity_note: string | null; block_prices: string | null;
}
interface Addon {
  id: string; name: string; kind: string; price_gross: number; note: string | null;
}
interface Booking {
  id: string; space_id: string; space_name: string; event_date: string;
  time_from: string; time_to: string; persons: number;
  customer_name: string; company: string | null; status: string;
  notes: string | null; folio_id: string | null;
  /** Рядок фоліо, який несе оренду зали, — заповнений означає «вже в рахунку». */
  hall_charge_item_id: string | null;
}

function blockPricesOf(s: Space | undefined) {
  if (!s?.block_prices) return {};
  try { return JSON.parse(s.block_prices) || {}; } catch { return {}; }
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 14,
  border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
  color: 'var(--text-primary)', fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4,
};

export default function EventsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    space_id: '', time_from: '10:00', time_to: '14:00', persons: '10',
    customer_name: '', company: '', customer_phone: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  // The billing modal: hall line + add-ons → folio → invoice → PDF.
  const [billFor, setBillFor] = useState<Booking | null>(null);
  const [hallPrice, setHallPrice] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [billing, setBilling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sp, ad, bk] = await Promise.all([
        fetch('/api/events/spaces').then((r) => r.json()),
        fetch('/api/events/addons').then((r) => r.json()),
        fetch(`/api/events/bookings?from=${date}&to=${date}`).then((r) => r.json()),
      ]);
      setSpaces(sp.spaces || []);
      setAddons(ad.addons || []);
      setBookings(bk.bookings || []);
    } finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const formSpace = spaces.find((s) => s.id === form.space_id);
  const suggestion = formSpace
    ? suggestedBlockPrice(blockPricesOf(formSpace), minutesBetween(form.time_from, form.time_to))
    : null;

  async function createBooking() {
    if (!form.space_id || !form.customer_name.trim()) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/events/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_id: form.space_id, event_date: date,
          time_from: form.time_from, time_to: form.time_to,
          persons: Number(form.persons) || 0,
          customer_name: form.customer_name.trim(),
          company: form.company.trim() || null,
          customer_phone: form.customer_phone.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('Не вдалося')); return; }
      setShowForm(false);
      setForm((f) => ({ ...f, customer_name: '', company: '', customer_phone: '', notes: '' }));
      await load();
    } finally { setSaving(false); }
  }

  async function cancelBooking(b: Booking) {
    if (!confirm(t('Скасувати цю подію? День у залі звільниться.'))) return;
    await fetch(`/api/events/bookings/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    await load();
  }

  function openBill(b: Booking) {
    const space = spaces.find((s) => s.id === b.space_id);
    const sug = space
      ? suggestedBlockPrice(blockPricesOf(space), minutesBetween(b.time_from, b.time_to))
      : null;
    // Зала вже в рахунку — підказка з прайсу тут була б пропозицією виставити
    // її вдруге.
    setHallPrice(b.hall_charge_item_id ? '' : (sug != null ? String(sug) : ''));
    setPicked({});
    setError('');
    setBillFor(b);
  }

  async function issueBill() {
    if (!billFor) return;
    const chosen = Object.entries(picked)
      .filter(([, q]) => Number(q) > 0)
      .map(([addon_id, q]) => ({ addon_id, quantity: Number(q) }));
    const hall = billFor.hall_charge_item_id ? 0 : Number(hallPrice) || 0;
    // Рахунок без жодного рядка. Сервер це теж відхиляє («Nothing to invoice on
    // this folio»), але вже після того, як відкрив фоліо, — і повідомлення
    // приходить англійською. Питання ставиться тут, де на нього є відповідь
    // мовою готелю.
    if (hall <= 0 && chosen.length === 0) {
      setError(t('Нема чого виставляти: вкажіть ціну оренди або оберіть доплату.'));
      return;
    }
    setBilling(true); setError('');
    try {
      const chargesRes = await fetch(`/api/events/bookings/${billFor.id}/charges`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hall_price_gross: hall, addons: chosen }),
      });
      const charges = await chargesRes.json();
      if (!chargesRes.ok) { setError(charges.error || t('Не вдалося')); return; }
      const issueRes = await fetch(`/api/finance/folios/${charges.folioId}/issue`, { method: 'POST' });
      const issued = await issueRes.json();
      if (!issueRes.ok) { setError(issued.error || t('Не вдалося')); return; }
      window.open(`/api/invoices/${issued.invoiceId}/pdf`, '_blank');
      setBillFor(null);
      await load();
    } finally { setBilling(false); }
  }

  const active = bookings.filter((b) => b.status !== 'cancelled');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Header title={t('Зали')} onMenuClick={onMenuClick} />
      <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ ...inputStyle, width: 170 }} />
          <div style={{ flex: 1 }} />
          <button onClick={() => { setError(''); setShowForm(true); }} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
            borderRadius: 10, border: 'none', background: 'var(--accent-primary)',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <Plus size={16} /> {t('Забронювати залу')}
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 size={24} style={{ color: 'var(--text-tertiary)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : spaces.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, padding: 30, textAlign: 'center' }}>
            {t('Зал ще немає. Вони заводяться файлом готелю або через API.')}
          </div>
        ) : (
          spaces.map((s) => {
            const own = active.filter((b) => b.space_id === s.id)
              .sort((a, b) => a.time_from.localeCompare(b.time_from));
            return (
              <div key={s.id} style={{
                marginBottom: 14, borderRadius: 14, border: '1px solid var(--border-primary)',
                background: 'var(--bg-elevated)', padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: own.length ? 10 : 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{s.name}</span>
                  {s.capacity_note && (
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{s.capacity_note}</span>
                  )}
                  {own.length === 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {t('вільно весь день')}
                    </span>
                  )}
                </div>
                {own.map((b) => (
                  <div key={b.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 10, background: 'var(--bg-secondary)', marginTop: 6, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {b.time_from}–{b.time_to}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                      {b.company || b.customer_name}
                      {b.persons > 0 && (
                        <span style={{ color: 'var(--text-tertiary)' }}> · {b.persons} {t('осіб')}</span>
                      )}
                    </span>
                    {b.notes && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{b.notes}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button onClick={() => openBill(b)} title={t('Рахунок')} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8,
                        border: '1px solid var(--border-primary)', background: 'none',
                        color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                        <FileText size={14} /> {t('Рахунок')}
                      </button>
                      <button onClick={() => cancelBooking(b)} title={t('Скасувати')} style={{
                        display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8,
                        border: '1px solid var(--border-primary)', background: 'none',
                        color: 'var(--accent-danger, #d33)', cursor: 'pointer',
                      }}>
                        <Ban size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}

        {/* ─── new booking ─────────────────────────────────────────────── */}
        {showForm && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }} onClick={() => setShowForm(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: '100%', maxWidth: 440, borderRadius: 16, background: 'var(--bg-elevated)',
              border: '1px solid var(--border-primary)', padding: 20,
              maxHeight: '90vh', overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
                  {t('Нова подія')} · {date}
                </span>
                <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                  <X size={18} />
                </button>
              </div>

              <label style={labelStyle}>{t('Зала')}</label>
              <select value={form.space_id} onChange={(e) => setForm({ ...form, space_id: e.target.value })} style={{ ...inputStyle, marginBottom: 10 }}>
                <option value="">{t('— оберіть —')}</option>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t('Від')}</label>
                  <input type="time" value={form.time_from} onChange={(e) => setForm({ ...form, time_from: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t('До')}</label>
                  <input type="time" value={form.time_to} onChange={(e) => setForm({ ...form, time_to: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ width: 90 }}>
                  <label style={labelStyle}>{t('Осіб')}</label>
                  <input type="number" min="0" value={form.persons} onChange={(e) => setForm({ ...form, persons: e.target.value })} style={inputStyle} />
                </div>
              </div>

              {form.space_id && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {suggestion != null
                    ? `${t('Підказка з прайсу')}: ${suggestion} €`
                    : t('Прайс для цього часу нічого не пропонує — ціна вручну')}
                </div>
              )}

              <label style={labelStyle}>{t('Клієнт')}</label>
              <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                placeholder={t('Імʼя контактної особи')} style={{ ...inputStyle, marginBottom: 10 }} />
              <label style={labelStyle}>{t('Фірма (платник, якщо є)')}</label>
              <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} style={{ ...inputStyle, marginBottom: 10 }} />
              <label style={labelStyle}>{t('Телефон')}</label>
              <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} style={{ ...inputStyle, marginBottom: 10 }} />
              <label style={labelStyle}>{t('Нотатки')}</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...inputStyle, marginBottom: 12 }} />

              {error && <div style={{ color: 'var(--accent-danger, #d33)', fontSize: 13, marginBottom: 10 }}>{error}</div>}

              <button onClick={createBooking} disabled={saving || !form.space_id || !form.customer_name.trim()} style={{
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--accent-primary)', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', opacity: saving || !form.space_id || !form.customer_name.trim() ? 0.6 : 1, fontFamily: 'inherit',
              }}>
                {saving ? t('Зберігаю…') : t('Забронювати')}
              </button>
            </div>
          </div>
        )}

        {/* ─── the bill ────────────────────────────────────────────────── */}
        {billFor && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }} onClick={() => setBillFor(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: '100%', maxWidth: 440, borderRadius: 16, background: 'var(--bg-elevated)',
              border: '1px solid var(--border-primary)', padding: 20,
              maxHeight: '90vh', overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
                  {t('Рахунок')} · {billFor.space_name} {billFor.time_from}–{billFor.time_to}
                </span>
                <button onClick={() => setBillFor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('Платник')}: {billFor.company || billFor.customer_name}
              </div>

              {/*
                Зала, яка вже в рахунку, тут не пропонується повторно. Сервер
                таку спробу відхиляє (див. postEventCharges), але діалог, що
                показує ціну й дозволяє її надіслати, виглядає як робоча дія —
                а відмова приходить уже після натискання. Доплати лишаються
                доступні: додаткова кава на тому ж заході — законна операція.
              */}
              {billFor.hall_charge_item_id ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 14px',
                  padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                  {t('Оренда зали вже в рахунку. Щоб виставити її наново, спершу сторнуйте той рядок у фоліо.')}
                </div>
              ) : (
                <>
                  <label style={labelStyle}>{t('Оренда зали, € (підказка з прайсу — можна змінити)')}</label>
                  <input type="number" min="0" step="0.01" value={hallPrice}
                    onChange={(e) => setHallPrice(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
                </>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {t('Доплати')}
              </div>
              {addons.map((a) => {
                const qty = picked[a.id] ?? '';
                // A per-person add-on defaults to the event's headcount the
                // moment it is switched on; everything else defaults to 1.
                const defaultQty = a.kind === 'per_person' ? (billFor.persons || 1) : 1;
                const on = Number(qty) > 0;
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <input type="checkbox" checked={on}
                      onChange={(e) => setPicked({ ...picked, [a.id]: e.target.checked ? String(defaultQty) : '' })} />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                      {a.name} · {a.price_gross} €{a.note ? ` (${a.note})` : ''}
                    </span>
                    {on && (
                      <input type="number" min="1" value={qty}
                        onChange={(e) => setPicked({ ...picked, [a.id]: e.target.value })}
                        style={{ ...inputStyle, width: 74, padding: '6px 8px' }} />
                    )}
                  </div>
                );
              })}

              {error && <div style={{ color: 'var(--accent-danger, #d33)', fontSize: 13, margin: '10px 0' }}>{error}</div>}

              <button onClick={issueBill} disabled={billing} style={{
                width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--accent-primary)', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', opacity: billing ? 0.6 : 1, fontFamily: 'inherit',
              }}>
                {billing ? t('Виставляю…') : t('Виставити рахунок і відкрити PDF')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
