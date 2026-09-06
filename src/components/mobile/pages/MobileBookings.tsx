'use client';

import { useT } from '@core/i18n/client';
import { useHotelCurrency } from '@/ui/hooks/useCurrentUser';
import { paymentStatusLabel, paymentStatusLook } from '@/modules/bookings/ui/payment-status';
import { explainStatusChange } from '@/components/booking/status-change';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import { Search, RefreshCw, Phone, Plus, X, LogIn, LogOut, Building2, Pencil, Info, Link, MessageCircle } from 'lucide-react';
import MobileBookingDetail from '@/components/booking/MobileBookingDetail';
import BookingForm, { type UnitTypeRow as BFUnitTypeRow, type UnitRow as BFUnitRow, type BookingSourceRow as BFBookingSourceRow } from '@/components/booking/BookingForm';

interface BookingRow {
  id: string; check_in: string; check_out: string; nights: number;
  adults: number; children: number; status: string; payment_status: string;
  source: string; total_price: number; first_name: string; last_name: string;
  guest_email: string | null; guest_phone: string | null;
  unit_name: string; unit_code: string; category_type: string;
  property_id?: string; property_name?: string | null;
  unit_type_name: string;
  commission_amount: number; guest_page_token: string | null;
  internal_notes: string | null; city_tax_amount: number;
  city_tax_included: number; city_tax_paid: string;
  registration_status: string; nationality: string | null;
  unit_id: string; unit_type_id: string; category_id: string; category_name: string;
  guest_id: string; notes: string | null; cleaning_status: string | null;
}

interface UnitRow {
  id: string; name: string; code: string; category_type: string;
  unit_type_id: string; unit_type_name: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:       { label: 'Чернетка',     color: '#6c7086', bg: 'rgba(108,112,134,0.15)' },
  tentative:   { label: 'Очікується',   color: '#fbbf24', bg: 'rgba(251,191,36,0.15)'  },
  confirmed:   { label: 'Підтверджено', color: '#34d399', bg: 'rgba(52,211,153,0.15)'  },
  checked_in:  { label: 'Заселено',     color: '#60a5fa', bg: 'rgba(96,165,250,0.15)'  },
  checked_out: { label: 'Виселено',     color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  cancelled:   { label: 'Скасовано',    color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
};

// Свій словник тут знав 'partial', але не знав 'payment_requested' і
// 'prepaid' — і передплачена бронь показувалась на телефоні як «Не
// оплачено», бо падала в дефолт. Плюс мертвий 'refunded': це стан рядка
// оплати (`payments.status`), а не стан броні. Тепер набір один на всі
// екрани — `@/modules/bookings/ui/payment-status`.

const FILTER_CHIPS = [
  { key: '', label: 'Всі' },
  { key: 'confirmed', label: 'Підтверджено' },
  { key: 'tentative', label: 'Очікується' },
  { key: 'checked_in', label: 'Заселено' },
  { key: 'checked_out', label: 'Виселено' },
];

// ─── Booking Sheet wrapper ─────────────────────────────────
// Wraps shared BookingForm in mobile bottom-sheet styling.

function BookingFormSheet({
  title,
  mode,
  bookingId,
  initial,
  unitTypes,
  allUnits,
  bookingSources,
  onClose,
  onSaved,
}: {
  title: string;
  mode: 'create' | 'edit';
  bookingId?: string;
  initial?: Partial<import('@/components/booking/BookingForm').BookingFormValues>;
  unitTypes: BFUnitTypeRow[];
  allUnits: BFUnitRow[];
  bookingSources: BFBookingSourceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose} />
      <div className="m-sheet" style={{ maxHeight: '92dvh' }}>
        <div className="m-sheet-handle" />
        <div className="m-sheet-header">
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          <button className="m-header-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
          <BookingForm
            mode={mode}
            bookingId={bookingId}
            initial={initial}
            unitTypes={unitTypes}
            allUnits={allUnits}
            bookingSources={bookingSources}
            onSaved={onSaved}
            onCancel={onClose}
          />
        </div>
      </div>
    </>
  );
}

// ─── Main Component ────────────────────────────────────────

interface MobileBookingsProps {
  openNew?: boolean;
  /** Початковий текст пошуку — приходить із `?q=` загального пошуку. */
  initialSearch?: string;
}

export default function MobileBookings({ openNew, initialSearch }: MobileBookingsProps) {
  const t = useT();
  const cur = useHotelCurrency();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [unitTypes, setUnitTypes] = useState<BFUnitTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  /*
    Загальний пошук у шапці приводить сюди з `?q=`. Без цього рядка людина
    натискала знайдену бронь і опинялась на повному списку — тобто шукала
    вдруге, вже руками. Значення лише ПОЧАТКОВЕ: далі поле живе своїм життям,
    інакше воно не давало б себе очистити.
  */
  const [search, setSearch] = useState(initialSearch ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewBooking, setViewBooking] = useState<BookingRow | null>(null);
  const [editBooking, setEditBooking] = useState<BookingRow | null>(null);
  const [payments, setPayments] = useState<unknown[]>([]);
  const [registrations, setRegistrations] = useState<unknown[]>([]);
  const [bookingSources, setBookingSources] = useState<BFBookingSourceRow[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showNewBooking, setShowNewBooking] = useState(openNew ?? false);
  // '' = all categories. Starting on one hardcoded type meant every hotel
  // without that type opened this page onto an empty list.
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showArchive, setShowArchive] = useState(false);

  const todayISO = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const sourceMap = useMemo(() => {
    const map: Record<string, { label: string; color: string }> = {};
    for (const s of bookingSources) {
      map[s.code] = { label: s.name, color: s.color || '#6c7086' };
    }
    return map;
  }, [bookingSources]);

  // Область обʼєкта з шапки: обраний обʼєкт звужує список; за «Усі обʼєкти»
  // картка підписується готелем.
  const { propertyId, properties } = usePropertyScope();
  const showProperty = !propertyId && properties.length > 1;
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (categoryFilter) params.set('category', categoryFilter);
      if (!showArchive) params.set('check_out_from', todayISO);
      if (propertyId) params.set('property_id', propertyId);
      const [bRes, sRes, uRes, utRes] = await Promise.all([
        fetch(`/api/bookings?${params}`),
        fetch('/api/booking-sources'),
        fetch('/api/units'),
        fetch('/api/unit-types'),
      ]);
      if (bRes.ok) { const d = await bRes.json(); setBookings(d.bookings || d); }
      if (sRes.ok) setBookingSources(await sRes.json());
      if (uRes.ok) setUnits(await uRes.json());
      if (utRes.ok) setUnitTypes(await utRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [categoryFilter, showArchive, todayISO, propertyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [dateFilter, setDateFilter] = useState<'all' | 'today_in' | 'today_out' | 'staying'>('all');

  const filtered = useMemo(() => {
    let result = bookings.filter(b => b.status !== 'cancelled');
    if (statusFilter) result = result.filter(b => b.status === statusFilter);
    if (dateFilter === 'today_in') result = result.filter(b => b.check_in === todayISO);
    if (dateFilter === 'today_out') result = result.filter(b => b.check_out === todayISO);
    if (dateFilter === 'staying') result = result.filter(b => b.check_in <= todayISO && b.check_out >= todayISO);

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(b =>
        `${b.first_name} ${b.last_name}`.toLowerCase().includes(s) ||
        b.unit_code?.toLowerCase().includes(s) ||
        b.guest_phone?.includes(s)
      );
    }
    return result.sort((a, b) => a.check_in.localeCompare(b.check_in));
  }, [bookings, statusFilter, dateFilter, todayISO, search]);

  const openBooking = async (booking: BookingRow) => {
    setViewBooking(booking);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch(`/api/payments?reservation_id=${booking.id}`),
        fetch(`/api/bookings/${booking.id}/registrations`),
      ]);
      if (pRes.ok) setPayments(await pRes.json());
      if (rRes.ok) setRegistrations(await rRes.json());
    } catch (e) { console.error(e); }
  };

  const handleChangeStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/bookings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    // Відмову сервера (422 без оплати чи з боргом) і попередження треба ПОКАЗАТИ:
    // мовчазний `await fetch` виглядав як «кнопка не працює».
    const outcome = explainStatusChange(res.ok, await res.json().catch(() => ({})), t);
    if (outcome.message) alert(outcome.message);
    if (!outcome.ok) return;
    fetchData();
  };

  const editInitial = useMemo(() => {
    if (!editBooking) return undefined;
    return {
      category: editBooking.category_type,
      unitTypeId: editBooking.unit_type_id || '',
      unitId: editBooking.unit_id,
      source: editBooking.source,
      checkIn: editBooking.check_in,
      checkOut: editBooking.check_out,
      adults: editBooking.adults,
      children: editBooking.children,
      firstName: editBooking.first_name,
      lastName: editBooking.last_name,
      email: editBooking.guest_email || '',
      phone: editBooking.guest_phone || '',
      status: editBooking.status,
      paymentStatus: editBooking.payment_status || 'unpaid',
      totalPrice: String(editBooking.total_price || ''),
      commissionAmount: String(editBooking.commission_amount || ''),
      cityTaxAmount: String(editBooking.city_tax_amount || ''),
      cityTaxIncluded: !!editBooking.city_tax_included,
      cityTaxPaid: editBooking.city_tax_paid || 'pending',
      internalNotes: editBooking.internal_notes || '',
    };
  }, [editBooking]);

  return (
    <div>
      {showSearch && (
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            className="form-input"
            placeholder={t('Ім\'я, телефон, юніт...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            style={{ fontSize: 14, padding: '10px 12px 10px 32px', borderRadius: 12 }}
          />
        </div>
      )}

      {/* Category toggle — the hotel's OWN categories, not one customer's trio */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {[
          { key: '', label: t('Всі') },
          ...[...new Map(unitTypes.map(ut => [ut.category_type, ut.category_name || ut.category_type])).entries()]
            .map(([key, label]) => ({ key, label })),
        ].map(c => (
          <button
            key={c.key}
            onClick={() => setCategoryFilter(c.key)}
            style={{
              padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: categoryFilter === c.key ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
              color: categoryFilter === c.key ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Date Filter chips */}
      <div className="m-chips" style={{ marginBottom: 4 }}>
        {[
          { key: 'all', label: t('Всі') },
          { key: 'today_in', label: t('🛬 Заїзди сьогодні') },
          { key: 'today_out', label: t('🛫 Виїзди сьогодні') },
          { key: 'staying', label: t('🏠 Проживають') },
        ].map(chip => (
          <button
            key={chip.key}
            className={`m-chip ${dateFilter === chip.key ? 'm-chip-active' : ''}`}
            onClick={() => setDateFilter(chip.key as any)}
          >
            {t(chip.label)}
          </button>
        ))}
      </div>

      {/* Status Filter chips */}
      <div className="m-chips">
        {FILTER_CHIPS.map(chip => (
          <button
            key={chip.key}
            className={`m-chip ${statusFilter === chip.key ? 'm-chip-active' : ''}`}
            onClick={() => setStatusFilter(chip.key)}
          >
            {t(chip.label)}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>
            {filtered.length} {showArchive ? t('всього') : t('актуальних')}
          </span>
          <button
            onClick={() => setShowArchive(p => !p)}
            style={{
              padding: '3px 9px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: showArchive ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
              color: showArchive ? '#fff' : 'var(--text-tertiary)',
            }}
            title={showArchive ? t('Показано всі бронювання') : t('Показано лише актуальні')}
          >
            {showArchive ? t('Архів') : t('Актуальні')}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowNewBooking(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 10, background: 'var(--accent-primary)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={14} /> {t('Нове')}
          </button>
          <button onClick={() => setShowSearch(p => !p)} style={{ background: 'transparent', border: 'none', color: showSearch ? 'var(--accent-primary)' : 'var(--text-tertiary)', cursor: 'pointer', padding: 4 }}>
            <Search size={16} />
          </button>
          <button onClick={fetchData} disabled={loading} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4 }}>
            <RefreshCw size={14} className={loading ? 'animate-pulse' : ''} />
          </button>
        </div>
      </div>

      {/* List */}
      {loading && bookings.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3,4,5].map(i => <div key={i} className="m-skeleton" style={{ height: 80, borderRadius: 14 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="m-empty">
          <div className="m-empty-icon">📋</div>
          <div>{t('Нічого не знайдено')}</div>
        </div>
      ) : (
        filtered.map(b => {
          const st = STATUS_MAP[b.status] || STATUS_MAP.draft;
          const pay = paymentStatusLook(b.payment_status);
          const cleanLabel = b.cleaning_status === 'clean' ? t('Чисто') : b.cleaning_status === 'dirty' ? t('Брудно') : b.cleaning_status === 'in_progress' ? t('В процесі') : null;
          const cleanColor = b.cleaning_status === 'clean' ? '#22c55e' : b.cleaning_status === 'dirty' ? '#ef4444' : '#f59e0b';
          return (
            <div key={b.id} className="m-card" style={{ padding: '12px 14px' }}>
              <div className="m-card-row" onClick={() => openBooking(b)} style={{ cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div className="m-card-title">{b.first_name} {b.last_name}</div>
                  <div className="m-card-subtitle">
                    {showProperty && b.property_name ? `${b.property_name} · ` : ''}{b.unit_code} · {b.nights} {t('ноч. ·')} {b.check_in} → {b.check_out}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: st.bg, color: st.color }}>
                    {t(st.label)}
                  </span>
                  {/* `Kč` тут стояло літералом — валюта одного клієнта на
                      телефоні кожного готелю (інваріант 20). І слово статусу
                      йшло повз `t()`: німецький портьє бачив українське. */}
                  <span style={{ fontSize: 11, fontWeight: 600, color: pay.color }}>
                    {b.total_price > 0
                      ? `${b.total_price.toLocaleString()} ${cur}`.trim()
                      : t(paymentStatusLabel(b.payment_status))}
                  </span>
                </div>
              </div>

              {/* Sub-row with phone and cleaning status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {b.guest_phone && (
                    <a href={`tel:${b.guest_phone}`} onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
                      <Phone size={10} /> {b.guest_phone}
                    </a>
                  )}
                  {cleanLabel && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, background: `${cleanColor}18`, color: cleanColor }}>
                      {cleanLabel}
                    </span>
                  )}
                </div>
                {b.status === 'confirmed' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleChangeStatus(b.id, 'checked_in'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: 'none', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    <LogIn size={12} /> {t('Заселити')}
                  </button>
                )}
                {b.status === 'checked_in' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleChangeStatus(b.id, 'checked_out'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: 'none', background: 'rgba(167,139,250,0.15)', color: '#a78bfa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    <LogOut size={12} /> {t('Виселити')}
                  </button>
                )}
              </div>

              {/* Action Toolbar on Card */}
              <div className="m-card-actions">
                <button
                  className="m-action-btn"
                  onClick={e => { e.stopPropagation(); setEditBooking(b); }}
                  title={t('Змінити')}
                  aria-label={t('Змінити')}
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="m-action-btn"
                  onClick={e => { e.stopPropagation(); openBooking(b); }}
                  title={t('Деталі')}
                  aria-label={t('Деталі')}
                >
                  <Info size={18} />
                </button>
                {b.guest_page_token && (
                  <button
                    className="m-action-btn"
                    onClick={e => {
                      e.stopPropagation();
                      const link = `${window.location.origin}/guest/${b.guest_page_token}`;
                      navigator.clipboard.writeText(link);
                      alert(t('🔗 Посилання на сторінку гостя скопійовано!'));
                    }}
                    title={t('Скопіювати посилання')}
                    aria-label={t('Скопіювати посилання')}
                  >
                    <Link size={18} />
                  </button>
                )}
                {b.guest_phone && (
                  <a
                    className="m-action-btn m-action-btn-whatsapp"
                    href={`https://wa.me/${b.guest_phone.replace(/[^\d+]/g, '').replace(/^\+/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ textDecoration: 'none' }}
                    title="WhatsApp"
                    aria-label="WhatsApp"
                  >
                    <MessageCircle size={18} />
                  </a>
                )}
                <button
                  className="m-action-btn m-action-btn-danger"
                  onClick={async e => {
                    e.stopPropagation();
                    if (confirm(`Скасувати бронювання ${b.first_name} ${b.last_name}?`)) {
                      await handleChangeStatus(b.id, 'cancelled');
                    }
                  }}
                  title={t('Скасувати')}
                  aria-label={t('Скасувати')}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* New booking sheet */}
      {showNewBooking && (
        <BookingFormSheet
          title={t('Нове бронювання')}
          mode="create"
          unitTypes={unitTypes}
          allUnits={units as unknown as BFUnitRow[]}
          bookingSources={bookingSources}
          onClose={() => setShowNewBooking(false)}
          onSaved={() => { setShowNewBooking(false); fetchData(); }}
        />
      )}

      {/* Edit booking sheet */}
      {editBooking && (
        <BookingFormSheet
          title={t('Редагувати бронювання')}
          mode="edit"
          bookingId={editBooking.id}
          initial={editInitial}
          unitTypes={unitTypes}
          allUnits={units as unknown as BFUnitRow[]}
          bookingSources={bookingSources}
          onClose={() => setEditBooking(null)}
          onSaved={() => { setEditBooking(null); setViewBooking(null); fetchData(); }}
        />
      )}

      {/* Booking detail sheet */}
      {viewBooking && (
        <MobileBookingDetail
          booking={viewBooking}
          payments={payments as any[]}
          registrations={registrations as any[]}
          sourceMap={sourceMap}
          onClose={() => setViewBooking(null)}
          onEdit={() => { if (viewBooking) setEditBooking(viewBooking); }}
          onChangeStatus={handleChangeStatus}
          onFetchPayments={(id) => fetch(`/api/payments?reservation_id=${id}`).then(r => r.json()).then(setPayments)}
          onFetchBookings={fetchData}
          onFetchRegistrations={(id) => fetch(`/api/bookings/${id}/registrations`).then(r => r.json()).then(setRegistrations)}
          showToast={() => {}}
          setBooking={setViewBooking}
        />
      )}

    </div>
  );
}
