'use client';

import { useT, usePlural } from '@core/i18n/client';
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import { EmptyState, LoadingState } from '@/components/ui/State';
import { useDevice } from '@/ui/hooks/useDevice';
import { useHotelCurrency } from '@/ui/hooks/useCurrentUser';
import MobileBookings from '@/components/mobile/pages/MobileBookings';
import SourceIcon from '@/components/ui/SourceIcon';
import MobileFilterBar from '@/components/mobile/MobileFilterBar';
import BookingViewModal from '@/components/booking/BookingViewModal';
import { explainStatusChange } from '@/components/booking/status-change';
import BookingForm, { type WidgetSiteSourceRow } from '@/components/booking/BookingForm';
import type { DashboardAlert } from '@/modules/dashboard/domain/alerts';
import {
  Plus,
  Search,
  Eye,
  Edit3,
  X,
  Users,
  Trash2,
  Check,
  ArrowRight,
  RefreshCw,
  Loader2,
  Phone,
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  AlertTriangle,
  FileText,
  Bell,
} from 'lucide-react';

/* ================================================================
   Types
   ================================================================ */
interface BookingRow {
  /** Код броні на боці каналу (BDC-…) — те, що гість читає з листа. */
  external_uid?: string | null;
  /** Обʼєкт броні — колонка списку за «Усі обʼєкти». */
  property_id?: string;
  property_name?: string | null;
  id: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  status: string;
  payment_status: string;
  source: string;
  total_price: number;
  notes: string | null;
  guest_id: string;
  first_name: string;
  last_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  unit_id: string;
  unit_name: string;
  unit_code: string;
  category_id: string;
  category_name: string;
  category_type: string;
  unit_type_id: string;
  unit_type_name: string;
  parent_id: string | null;
  sub_booking_count: number;
  commission_amount: number;
  guest_page_token: string | null;
  internal_notes: string | null;
  city_tax_amount: number;
  city_tax_included: number;
  city_tax_paid: string;
  registration_status: string;
  nationality: string | null;
  hostex_channel_type?: string;
  hostex_reservation_code?: string;
  currency?: string;
}

interface UnitTypeRow {
  id: string;
  name: string;
  code: string;
  max_adults: number;
  category_id: string;
  category_name: string;
  category_type: string;
  unit_count: number;
}

interface UnitRow {
  id: string;
  name: string;
  code: string;
  category_type: string;
  unit_type_id: string;
}

/* ================================================================
   Status / Source maps
   ================================================================ */
const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Чернетка', badge: 'badge-info' },
  tentative: { label: 'Очікується', badge: 'badge-warning' },
  confirmed: { label: 'Підтверджено', badge: 'badge-success' },
  checked_in: { label: 'Заселено', badge: 'badge-primary' },
  checked_out: { label: 'Виселено', badge: 'badge-info' },
  cancelled: { label: 'Скасовано', badge: 'badge-danger' },
};

const PAYMENT_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  unpaid: { label: 'Не оплачено', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  payment_requested: { label: 'Запит на оплату', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  prepaid: { label: 'Передплата', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  paid: { label: 'Оплачено', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
};

// SOURCE_MAP is built dynamically from /api/booking-sources

/* ================================================================
   Alerts
   ================================================================ */
/**
 * Текст попередження — тут, а не в API.
 *
 * `/api/alerts` складав ці речення сам, українською, у SQL-хендлері, без
 * жодного `t()`. Німецький портьє відкривав цей екран і бачив стіну
 * українського тексту — на першому екрані, який він відкриває сам.
 *
 * Перекласти на місці не можна навмисно: `check-i18n-leak` забороняє `t()`
 * під `src/app/api`, щоб мова оператора не вирішувала мову документів і
 * листів гостю. Тому API віддає код, а рядок складається тут.
 *
 * Назва номера й дата в `t()` не загортаються: це дані готелю, а не текст.
 * `t` приходить аргументом, бо це результат хука, а хук живе в компоненті.
 */
function alertText(a: DashboardAlert, t: (s: string) => string): string {
  const where = a.unitName ? ` — ${a.unitName}` : '';
  switch (a.type) {
    case 'overdue_arrival':
      return `${t('Прострочений заїзд')} ${a.checkIn ?? ''}${where}`;
    case 'zero_price_arrival':
      return `${t('Сьогодні заїзд, ціна = 0 — потрібне підтвердження')}${where}`;
    case 'unpaid_arrival':
      return `${t('Сьогодні заїзд, оплата не завершена')}${where}`;
    case 'unregistered_arrival':
      return `${t('Сьогодні заїзд, реєстрація не пройдена')}${where}`;
    case 'checked_in_no_reg':
      return `${t('Заселений без реєстрації')}${where}`;
    case 'today_departure':
      return `${t('Сьогодні виїзд')}${where}`;
    case 'payment_requested':
      return `${t('Гість просить рахунок на оплату')}${where}`;
    // Код, якого цей екран не знає, означає, що API пішов уперед. Показати
    // сам код гірше, ніж показати те, що точно правда: який це номер.
    default:
      return a.unitName || '';
  }
}

/* ================================================================
   Modal
   ================================================================ */
function Modal({ open, onClose, title, children, footer, size }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode; size?: 'lg';
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} onClick={(e) => e.stopPropagation()}>
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

/* ================================================================
   Main
   ================================================================ */
function BookingsPageContent() {
  const { isMobile } = useDevice();
  const searchParams = useSearchParams();
  const openNew = searchParams?.get('new') === '1' || searchParams?.get('create') === '1';
  const initialSearch = searchParams?.get('q') ?? undefined;
  if (isMobile) return <MobileBookings openNew={openNew} initialSearch={initialSearch} />;
  return <BookingsDesktop initialSearch={initialSearch} />;
}

export default function BookingsPage() {
  return (
    <Suspense fallback={null}>
      <BookingsPageContent />
    </Suspense>
  );
}

const getSourceIconEmoji = (code: string) => {
  switch (code) {
    case 'direct': return '👤 ';
    case 'phone': return '📞 ';
    case 'whatsapp': return '💬 ';
    case 'booking_com': return '🏨 ';
    case 'airbnb': return '🏡 ';
    case 'vrbo': return '✈️ ';
    case 'other_ota': return '🔌 ';
    default: return '';
  }
};

function BookingsDesktop({ initialSearch }: { initialSearch?: string }) {
  const plural = usePlural();
  const t = useT();
  // Валюта готелю замість запасних крон. Бронь майже завжди несе свою
  // (`reservations.currency`); порожня колонка означає «як у готелю», а не
  // «як у першого клієнта».
  const hotelCurrency = useHotelCurrency();
  /* ── data ──────────────────────────────────────────── */
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitTypeRow[]>([]);
  const [allUnits, setAllUnits] = useState<UnitRow[]>([]);
  const [bookingSources, setBookingSources] = useState<any[]>([]);
  const [widgetSources, setWidgetSources] = useState<WidgetSiteSourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Build dynamic source map from fetched sources (OTA + widget sites)
  const sourceMap = useMemo(() => {
    const map: Record<string, { label: string; color: string }> = {
      widget: { label: '🌐 Віджет (Загальний)', color: '#6366f1' },
    };
    for (const s of bookingSources) {
      map[s.code] = { label: getSourceIconEmoji(s.code) + s.name, color: s.color };
    }
    for (const s of widgetSources) {
      map[s.code] = { label: `🌐 ${s.name}`, color: s.color || '#6366f1' };
    }
    return map;
  }, [bookingSources, widgetSources]);

  /* ── filters ──────────────────────────────────────── */
  /*
    Загальний пошук у шапці приводить сюди з `?q=`. Без цього рядка людина
    натискала знайдену бронь і опинялась на повному списку — тобто шукала
    вдруге, вже руками. Значення лише ПОЧАТКОВЕ: далі поле живе своїм життям,
    інакше воно не давало б себе очистити.
  */
  const [search, setSearch] = useState(initialSearch ?? '');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' = exclude cancelled
  // Область обʼєкта з шапки (BUILD-PLAN, Блок 1): обраний обʼєкт звужує
  // список, «Усі обʼєкти» показує все з колонкою готелю.
  const { propertyId, properties } = usePropertyScope();
  const showPropertyColumn = !propertyId && properties.length > 1;
  const [categoryFilter, setCategoryFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sortCol, setSortCol] = useState<string>('check_in');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  /* ── modals ───────────────────────────────────────── */
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [viewBooking, setViewBooking] = useState<BookingRow | null>(null);
  const [editBooking, setEditBooking] = useState<BookingRow | null>(null);
  const [toast, setToast] = useState('');

  /* ── payments + activity ──────────────────────────── */
  const [payments, setPayments] = useState<any[]>([]);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', type: 'partial', notes: '' });
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const onMenuClick = useMobileMenu();

  // Тут будувався «змішаний» список: шапка групи, під нею її броні, поряд
  // одиночні. Групові броні (`reservation_groups`) видалено 2026-08-27 —
  // лишається один плаский відсортований список.
  const sortedBookings = useMemo(() => {
    return [...bookings].sort((a, b) => {
      const aVal = (a as any)[sortCol] ?? '';
      const bVal = (b as any)[sortCol] ?? '';
      const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [bookings, sortCol, sortDir]);

  const CZK_TO_EUR = 23.5;
  const toEur = (czk: number) => (czk / CZK_TO_EUR).toFixed(1);

  const METHOD_LABELS: Record<string, string> = {
    cash: '💵 Готівка', card: '💳 Картою',
    bank_transfer: '🏦 На рахунок', invoice: '📄 Фактура', online: '🌐 Онлайн',
    booking_platform: '🏨 Платформа бронювання',
  };
  const TYPE_LABELS: Record<string, string> = {
    deposit: 'Передплата', full: 'Повна', partial: 'Часткова', refund: 'Повернення',
  };

  const fetchPayments = useCallback(async (resId: string) => {
    try {
      const res = await fetch(`/api/payments?reservation_id=${resId}`);
      const data = await res.json();
      if (Array.isArray(data)) setPayments(data);
    } catch (e) { console.error('Failed to fetch payments', e); }
  }, []);

  const fetchRegistrations = useCallback(async (resId: string) => {
    try {
      const res = await fetch(`/api/bookings/${resId}/registrations`);
      const data = await res.json();
      if (Array.isArray(data)) setRegistrations(data);
    } catch { setRegistrations([]); }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      if (Array.isArray(data)) setAlerts(data);
    } catch { setAlerts([]); }
  }, []);

  const openViewBooking = useCallback((b: BookingRow) => {
    setViewBooking(b);
    fetchPayments(b.id);
    fetchRegistrations(b.id);
    setShowPayForm(false);
  }, [fetchPayments, fetchRegistrations]);

  /* ── fetch bookings ───────────────────────────────── */
  // Порожній список після фільтра — це «змініть фільтр», а не «броней ще немає».
  const filtersActive = Boolean(search || (statusFilter && statusFilter !== 'active') || categoryFilter || paymentFilter || dateFrom || dateTo || sourceFilter);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('exclude_children', '1');
      if (search) params.set('search', search);
      if (statusFilter === 'active') {
        params.set('exclude_cancelled', '1');
      } else if (statusFilter) {
        params.set('status', statusFilter);
      }
      if (categoryFilter) params.set('category', categoryFilter);
      if (paymentFilter) params.set('payment_status', paymentFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (sourceFilter) params.set('source', sourceFilter);
      // Область обʼєкта з шапки: обраний обʼєкт звужує список, «Усі» — ні.
      if (propertyId) params.set('property_id', propertyId);

      const res = await fetch(`/api/bookings?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setBookings(data);
    } catch (e) {
      console.error('Failed to fetch bookings', e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, categoryFilter, paymentFilter, dateFrom, dateTo, sourceFilter, propertyId]);

  /* ── fetch ref data ───────────────────────────────── */
  useEffect(() => {
    // Load unit types and units for the booking form
    Promise.all([
      fetch('/api/unit-types').then(r => r.json()),
      fetch('/api/units').then(r => r.json()),
      fetch('/api/booking-sources').then(r => r.json()),
      fetch('/api/booking-sources/widget-sites').then(r => r.json()),
    ]).then(([uts, us, srcs, widgets]) => {
      if (Array.isArray(uts)) setUnitTypes(uts);
      if (Array.isArray(us)) setAllUnits(us);
      if (Array.isArray(srcs)) setBookingSources(srcs);
      if (Array.isArray(widgets)) setWidgetSources(widgets);
    });
  }, []);

  /* ── fetch on filter change ───────────────────────── */
  useEffect(() => {
    const debounce = setTimeout(() => { fetchBookings(); fetchAlerts(); }, 300);
    return () => clearTimeout(debounce);
  }, [fetchBookings, fetchAlerts]);

  const openNewBooking = () => setShowNewBooking(true);
  const openEditBooking = (b: BookingRow) => setEditBooking(b);

  const editInitial = useMemo(() => {
    if (!editBooking) return undefined;
    return {
      category: editBooking.category_type,
      unitTypeId: editBooking.unit_type_id,
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
      currency: editBooking.currency || hotelCurrency,
    };
  }, [editBooking]);

  /* ── delete ───────────────────────────────────────── */
  const handleDelete = async (id: string) => {
    if (!confirm(`Видалити бронювання ${id}?`)) return;
    await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
    showToast(`Бронювання ${id} видалено`);
    fetchBookings();
  };

  /* ── change status ────────────────────────────────── */
  const changeStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      const outcome = explainStatusChange(res.ok, data, t);
      if (outcome.ok) {
        showToast(outcome.warning ? outcome.message : `${t('Статус змінено на:')} ${t(STATUS_MAP[newStatus]?.label || newStatus)}`);
        await fetchBookings();
        fetchAlerts();
        if (viewBooking && viewBooking.id === id) {
          setViewBooking({ ...viewBooking, status: newStatus });
        }
      } else {
        alert(`${t('Помилка зміни статусу:')} ${outcome.message}`);
      }
    } catch (e) {
      console.error('Status change error:', e);
      alert(t('Помилка мережі'));
    }
  };

  /* ── toast ────────────────────────────────────────── */
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <>
      <Header title={t('Бронювання')} onMenuClick={onMenuClick} />
      <div className="app-content">
        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: 'var(--accent-success)', color: '#fff',
            padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s ease',
          }}>
            <Check size={16} /> {toast}
          </div>
        )}

        {/* ── Alert Banner ── */}
        {alerts.length > 0 && (
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alerts.slice(0, 8).map((a: any, i: number) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                borderRadius: 'var(--radius-md)', fontSize: 13,
                background: a.severity === 'danger' ? 'rgba(239,68,68,0.1)' : a.severity === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)',
                border: `1px solid ${a.severity === 'danger' ? 'rgba(239,68,68,0.3)' : a.severity === 'warning' ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)'}`,
                color: a.severity === 'danger' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#3b82f6',
              }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={async () => {
                  let booking = bookings.find(b => b.id === a.bookingId);
                  if (!booking) {
                    try {
                      const res = await fetch(`/api/bookings/${a.bookingId}`);
                      if (res.ok) booking = await res.json();
                    } catch {}
                  }
                  if (booking) openViewBooking(booking);
                }}>
                  {a.severity === 'danger' ? <AlertTriangle size={16} /> : a.severity === 'warning' ? <Bell size={16} /> : <FileText size={16} />}
                  <span style={{ fontWeight: 600 }}>{a.guestName}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{t(alertText(a, t))}</span>
                </div>
                <button
                  title={a.type === 'overdue_arrival' ? t('Позначити no-show та прибрати') : t('Приховати')}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (a.type === 'overdue_arrival') {
                      // PATCH, not PUT. The route exports GET/PATCH/DELETE, so
                      // PUT answered 405 — and nothing looked at the response,
                      // so the alert disappeared as if the booking had been
                      // marked, while the status stayed `confirmed`. The guest
                      // who never arrived kept their room blocked.
                      const res = await fetch(`/api/bookings/${a.bookingId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'no_show' }),
                      });
                      if (!res.ok) {
                        alert(t('Не вдалося позначити no-show. Спробуйте ще раз.'));
                        return;
                      }
                      fetchBookings();
                    }
                    setAlerts(prev => prev.filter((_: any, idx: number) => idx !== i));
                  }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'inherit', opacity: 0.5, padding: '2px 4px',
                    borderRadius: 4, display: 'flex', alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {alerts.length > 8 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                {t('+ ще')} {alerts.length - 8} {t('сповіщень')}
              </div>
            )}
          </div>
        )}

        <div className="page-header">
          <div>
            <h2 className="page-title">{t('Бронювання')}</h2>
            <div className="page-subtitle">{bookings.length} {t('записів')}</div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => fetchBookings()} title={t('Оновити')}>
              <RefreshCw size={16} />
            </button>
            <button className="btn btn-primary" onClick={openNewBooking}>
              <Plus size={16} /> {t('Нове бронювання')}
            </button>
          </div>
        </div>

        {/* Desktop Filters */}
        <div className="card desktop-filter-card" style={{ marginBottom: 16 }}>
          <div className="flex gap-3 items-center" style={{ flexWrap: 'wrap' }}>
            <div className="search-box" style={{ minWidth: 250 }}>
              <Search size={14} className="search-icon" />
              <input
                className="form-input"
                placeholder={t('Пошук по гостю, юніту або ID...')}
                style={{ paddingLeft: 34 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="form-select" style={{ width: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="active">{t('🚫 Без скасованих')}</option>
              <option value="">{t('Всі статуси')}</option>
              <option value="draft">{t('Чернетка')}</option>
              <option value="tentative">{t('Очікується')}</option>
              <option value="confirmed">{t('Підтверджено')}</option>
              <option value="checked_in">{t('Заселено')}</option>
              <option value="checked_out">{t('Виселено')}</option>
              <option value="cancelled">{t('Тільки скасовані')}</option>
            </select>
            <select className="form-select" style={{ width: 150 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{t('Всі типи')}</option>
              {/* The hotel's OWN categories — a hardcoded trio here was one
                  customer's vocabulary in every other hotel's filter. */}
              {[...new Map(unitTypes.map(ut => [ut.category_type, ut.category_name || ut.category_type])).entries()]
                .map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </select>
            <select className="form-select" style={{ width: 170 }} value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              <option value="">{t('Всі оплати')}</option>
              {Object.entries(PAYMENT_STATUS_MAP).map(([k, v]) => (
                <option key={k} value={k}>{t(v.label)}</option>
              ))}
            </select>
            {(search || statusFilter || categoryFilter || paymentFilter || dateFrom || dateTo || sourceFilter) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); setPaymentFilter(''); setDateFrom(''); setDateTo(''); setSourceFilter(''); }}>
                <X size={14} /> {t('Скинути')}
              </button>
            )}
          </div>
          {/* Row 2: date + source */}
          <div className="flex gap-3 items-center" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>{t('Заїзд:')}</span>
              <input className="form-input" type="date" style={{ width: 140 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span style={{ color: 'var(--text-tertiary)' }}>—</span>
              <input className="form-input" type="date" style={{ width: 140 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: 175 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">{t('Всі канали')}</option>
              {bookingSources.length > 0 && (
                <optgroup label={t('Канали')}>
                  {bookingSources.map((s: any) => (
                    <option key={s.code} value={s.code}>{getSourceIconEmoji(s.code)}{s.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label={t('🌐 Віджети')}>
                <option value="widget">{t('🌐 Всі віджети (загальні)')}</option>
                {widgetSources.map((s) => (
                  <option key={s.code} value={s.code}>🌐 {s.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* ── Mobile Status Tabs + Filter Chips ── */}
        <MobileFilterBar
          tabs={[
            { key: '', label: 'Всі' },
            { key: 'confirmed', label: 'Підтверджено' },
            { key: 'tentative', label: 'Очікується' },
            { key: 'checked_in', label: 'Заселено' },
            { key: 'checked_out', label: 'Виселено' },
            { key: 'cancelled', label: 'Скасовано' },
          ]}
          activeTab={statusFilter}
          onTabChange={setStatusFilter}
        />

        {/* ── Mobile Search (compact) ── */}
        <div className="mobile-only" style={{ marginBottom: 10 }}>
          <div className="search-box" style={{ width: '100%' }}>
            <Search size={14} className="search-icon" />
            <input
              className="form-input"
              placeholder={t('Пошук...')}
              style={{ paddingLeft: 34, fontSize: 13 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>


        {/* ── Desktop Table ── */}
        <div className="desktop-only">
        {loading ? (
          <LoadingState />
        ) : sortedBookings.length === 0 ? (
          <EmptyState
            title={filtersActive ? t('Нічого не знайдено') : t('Бронювань ще немає')}
            hint={filtersActive ? t('Змініть фільтр, статус або період') : t('Броні зʼявляться тут — з віджета, з каналів або створені вручну')}
            action={{ label: t('Нове бронювання'), onClick: () => setShowNewBooking(true), icon: <Plus size={14} /> }}
          />
        ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                {[
                  { key: 'last_name', label: t('Гість') },
                  ...(showPropertyColumn ? [{ key: 'property_name', label: t('Обʼєкт') }] : []),
                  { key: 'unit_name', label: t('Юніт') },
                  { key: 'check_in', label: t('Заїзд') },
                  { key: 'check_out', label: t('Виїзд') },
                  { key: 'nights', label: t('Ночей') },
                  { key: 'adults', label: t('Гостей') },
                  { key: 'status', label: t('Статус') },
                  { key: 'payment_status', label: t('Оплата') },
                  { key: 'source', label: t('Джерело') },
                  { key: 'total_price', label: t('Сума') },
                  { key: '', label: '' },
                ].map(col => (
                  <th key={col.key || 'actions'} style={col.key ? { cursor: 'pointer', userSelect: 'none' } : {}}
                    onClick={() => { if (col.key) { setSortCol(col.key); setSortDir(prev => sortCol === col.key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'); } }}>
                    {col.label}{sortCol === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedBookings.map((b, idx) => {
                return (
                  <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => openViewBooking(b)}>
                    <td style={{ fontWeight: 500 }}>{b.first_name} {b.last_name}{b.sub_booking_count > 0 && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 8, background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontWeight: 700 }}>👥 {b.sub_booking_count}</span>}</td>
                    {showPropertyColumn && <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{b.property_name}</td>}
                    <td><span className="badge badge-primary">{b.unit_name}</span></td>
                    <td>{b.check_in}</td><td>{b.check_out}</td><td>{b.nights}</td>
                    <td><span className="flex items-center gap-2" style={{ fontSize: 12 }}><Users size={12} /> {b.adults}{b.children > 0 && <span style={{ color: 'var(--text-tertiary)' }}>+{b.children}</span>}</span></td>
                    <td><span className={`badge ${STATUS_MAP[b.status]?.badge || 'badge-info'}`}>{t(STATUS_MAP[b.status]?.label || b.status)}</span></td>
                    <td><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: PAYMENT_STATUS_MAP[b.payment_status]?.color || '#888', background: PAYMENT_STATUS_MAP[b.payment_status]?.bg || 'rgba(128,128,128,0.1)' }}>{t(PAYMENT_STATUS_MAP[b.payment_status]?.label || b.payment_status)}</span></td>
                    <td>
                      <span className="badge" style={{ background: (sourceMap[b.source]?.color || '#6c7086') + '22', color: sourceMap[b.source]?.color || '#6c7086' }}>{sourceMap[b.source]?.label || b.source}</span>
                      {b.hostex_channel_type && <span style={{ marginLeft: 4 }} title={`Hostex: ${b.hostex_channel_type}`}>🌐</span>}
                      {(b.external_uid || b.hostex_reservation_code) && (
                        <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{b.external_uid || b.hostex_reservation_code}</div>
                      )}
                    </td>
                    <td><div style={{ fontWeight: 700 }}>{(b.total_price || 0).toLocaleString()} {b.currency || hotelCurrency}</div>{(b.commission_amount || 0) > 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>{t('Комісія')} {(b.commission_amount || 0).toLocaleString()}</div>}</td>
                    <td><div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-ghost btn-icon" title={t('Переглянути')} onClick={() => openViewBooking(b)}><Eye size={14} /></button>
                      <button className="btn btn-sm btn-ghost btn-icon" title={t('Редагувати')} onClick={() => openEditBooking(b)}><Edit3 size={14} /></button>
                      {b.guest_page_token && (
                        <button className="btn btn-sm btn-ghost btn-icon" title={t('Гостьова сторінка')} style={{ color: 'var(--accent-primary)' }} onClick={() => window.open(`/guest/${b.guest_page_token}`, '_blank')}><ExternalLink size={14} /></button>
                      )}
                      <button className="btn btn-sm btn-ghost btn-icon" title={t('Видалити')} style={{ color: 'var(--accent-danger)' }} onClick={() => handleDelete(b.id)}><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        </div>

        {/* ── Mobile Card List (improved Phase 3) ── */}
        <div className="mobile-only">
          {loading && <LoadingState compact />}
          {!loading && sortedBookings.length === 0 && (
            <EmptyState
              compact
              title={filtersActive ? t('Нічого не знайдено') : t('Бронювань ще немає')}
              hint={filtersActive ? t('Змініть фільтр, статус або період') : t('Броні зʼявляться тут — з віджета, з каналів або створені вручну')}
              action={{ label: t('Нове бронювання'), onClick: () => setShowNewBooking(true), icon: <Plus size={14} /> }}
            />
          )}
          <div className="card-list">
            {sortedBookings.map((b, idx) => {
              return (
                <div key={b.id} className="booking-card" onClick={() => openViewBooking(b)}>
                  <div className="booking-card-row">
                    <div className="booking-card-source">
                      <SourceIcon source={b.source} size={36}
                        iconColor={sourceMap[b.source]?.color}
                        iconLetter={bookingSources.find(s => s.code === b.source)?.icon_letter} />
                    </div>
                    <div className="booking-card-main">
                      <div className="booking-card-guest">{b.first_name} {b.last_name}</div>
                      <div className="booking-card-meta">
                        <Users size={11} /> {b.adults}{b.children > 0 ? `+${b.children}` : ''}
                        {b.guest_phone && <> · <Phone size={10} /> {b.guest_phone}</>}
                      </div>
                    </div>
                    <div className="booking-card-date">
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{b.check_in?.split('-').slice(1).join('/')}</div>
                    </div>
                  </div>
                  <div className="booking-card-body">
                    <div>
                      <div className="booking-card-unit">{b.unit_name}</div>
                      <div className="booking-card-unit-sub">{b.category_name || b.category_type || ''}</div>
                      <div className="booking-card-price">
                        {(b.total_price || 0).toLocaleString()} {b.currency || hotelCurrency}
                        <span style={{ marginLeft: 6, display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: PAYMENT_STATUS_MAP[b.payment_status]?.color || '#888', background: PAYMENT_STATUS_MAP[b.payment_status]?.bg || 'rgba(128,128,128,0.1)' }}>
                          {t(PAYMENT_STATUS_MAP[b.payment_status]?.label || b.payment_status)}
                        </span>
                      </div>
                      {(b.commission_amount || 0) > 0 && (
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>{t('Комісія')} {(b.commission_amount || 0).toLocaleString()}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <div className="booking-card-date">
                        <div>{b.check_in}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>▼</div>
                        <div>{b.check_out}</div>
                      </div>
                      {(b.status === 'confirmed' || b.status === 'tentative') && (
                        <button className="mobile-action-btn" onClick={(e) => { e.stopPropagation(); changeStatus(b.id, 'checked_in'); }}>{t('Реєстрація')}</button>
                      )}
                      {b.status !== 'confirmed' && b.status !== 'tentative' && (
                        <span className={`badge ${STATUS_MAP[b.status]?.badge || 'badge-info'}`}>{t(STATUS_MAP[b.status]?.label || b.status)}</span>
                      )}
                      {b.guest_page_token && (
                        <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-primary)' }} title={t('Гостьова сторінка')} onClick={(e) => { e.stopPropagation(); window.open(`/guest/${b.guest_page_token}`, '_blank'); }}>
                          <ExternalLink size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* View Modal — Pipeline Design */}
        {viewBooking && (
          <BookingViewModal
            booking={viewBooking}
            payments={payments}
            registrations={registrations}
            sourceMap={sourceMap}
            onClose={() => setViewBooking(null)}
            onEdit={() => { openEditBooking(viewBooking); setViewBooking(null); }}
            onChangeStatus={changeStatus}
            onFetchPayments={fetchPayments}
            onFetchBookings={fetchBookings}
            onFetchRegistrations={fetchRegistrations}
            showToast={showToast}
            setBooking={setViewBooking}
          />
        )}

        {/* New Booking Modal */}
        <Modal open={showNewBooking} onClose={() => setShowNewBooking(false)} title={t('Нове бронювання')} size="lg">
          {showNewBooking && (
            <BookingForm
              mode="create"
              unitTypes={unitTypes}
              allUnits={allUnits}
              bookingSources={bookingSources}
              widgetSources={widgetSources}
              onSaved={() => {
                setShowNewBooking(false);
                showToast(t('Бронювання створено!'));
                fetchBookings();
              }}
              onCancel={() => setShowNewBooking(false)}
            />
          )}
        </Modal>

        {/* Edit Booking Modal */}
        <Modal open={!!editBooking} onClose={() => setEditBooking(null)} title={t('Редагувати бронювання')} size="lg">
          {editBooking && (
            <BookingForm
              mode="edit"
              bookingId={editBooking.id}
              initial={editInitial}
              currency={editBooking.currency || undefined}
              unitTypes={unitTypes}
              allUnits={allUnits}
              bookingSources={bookingSources}
              widgetSources={widgetSources}
              onSaved={() => {
                const closingId = editBooking.id;
                setEditBooking(null);
                showToast(`Бронювання ${closingId} оновлено!`);
                fetchBookings();
              }}
              onCancel={() => setEditBooking(null)}
            />
          )}
        </Modal>
      </div>
    </>
  );
}
