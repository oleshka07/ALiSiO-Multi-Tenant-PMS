'use client';

import { useT } from '@core/i18n/client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import './booking-iframe.css';
// Exception: @bookings public API imports better-sqlite3 (server-only).
// translations.ts has zero server deps — safe to import from ui/ in 'use client' context.
// TODO: move translations to src/shared/ when creating that layer.
import type { BookingLang } from './translations';
import { BOOKING_LANG_LABELS, BOOKING_LANG_FLAGS, getBookingTranslations } from './translations';
import { asWidgetLang, browserWidgetLang, pickWidgetLanguage } from './widget-language';
import { percentOf } from '@core/money';


// API base URL — configurable for subdomain deployment
const API_BASE = process.env.NEXT_PUBLIC_PMS_API_URL || '';

// ─── Types ────────────────────────────────────────────
interface UnitResult {
  id: string;
  name: string;
  code: string;
  beds: number;
  unitTypeId: string;
  typeName: string;
  typeCode: string;
  description: string;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  baseOccupancy: number;
  bedsSingle: number;
  bedsDouble: number;
  bedsSofa: number;
  hasPricing: boolean;
  avgPricePerNight: number;
  totalPrice: number;
  breakdown: { date: string; dayName: string; price: number; isWeekend: boolean }[];
  currency: string;
  extraPersonCharge: number;
  petAllowed: boolean;
  petCharge: number;
  amenities: { icon: string; name: string }[];
}

interface AvailabilityResponse {
  checkIn: string;
  checkOut: string;
  nights: number;
  units: UnitResult[];
  offerDiscount: { name: string; discountType: string; offerAmount: number } | null;
  certificate: { code: string; amount: number } | null;
}

interface ReserveResponse {
  success: boolean;
  reservationId: string;
  unitName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPrice: number;
  originalPrice: number;
  offerDiscount: number;
  certificateDiscount: number;
  currency: string;
}

// ─── Helpers ──────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00');
}

function formatDisplayDate(s: string, lang: BookingLang): string {
  const d = parseDate(s);
  const locales: Record<string, string> = { uk: 'uk-UA', en: 'en-GB', cs: 'cs-CZ', de: 'de-DE' };
  return d.toLocaleDateString(locales[lang] || 'uk-UA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatShortDate(s: string, lang: BookingLang): string {
  const d = parseDate(s);
  const locales: Record<string, string> = { uk: 'uk-UA', en: 'en-GB', cs: 'cs-CZ', de: 'de-DE' };
  return d.toLocaleDateString(locales[lang] || 'uk-UA', { day: 'numeric', month: 'short' });
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat('cs-CZ').format(n);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

// ─── Step labels ──────────────────────────────────────
const STEPS = [1, 2, 3, 4, 5] as const;

// ─── Main Component ──────────────────────────────────
export default function BookingPage() {
  const tUi = useT();
  // ─── State ──────
  // Was 'uk', unconditionally: this page has no language switcher, so a guest
  // of a German hotel had no way out of Ukrainian at all. See widget-language.
  const [lang, setLang] = useState<BookingLang>('en');
  const langPinned = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const picked = pickWidgetLanguage({
      param: params.get('lang'),
      embed: (window as any).__BOOKING_LANG__,
      browser: browserWidgetLang(),
    });
    setLang(picked.lang);
    langPinned.current = picked.pinned;
  }, []);
  const t = useMemo(() => getBookingTranslations(lang), [lang]);

  // Language dropdown
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [step, setStep] = useState(1);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [selectingCheckOut, setSelectingCheckOut] = useState(false);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  // Calendar navigation
  const [today] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [calMonthOffset, setCalMonthOffset] = useState(0);

  // Coupon / Certificate
  const [promoInput, setPromoInput] = useState('');
  const [certInput, setCertInput] = useState('');
  const [offerApplied, setOfferApplied] = useState('');
  const [promoMessage, setPromoMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Step 2 — Availability + Cart
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);

  // Pre-select unit from query param
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const uId = params.get('unitId');
      if (uId) setSelectedUnit(uId);
    }
  }, []);
  const [cardAdults, setCardAdults] = useState(2);
  const [cardChildren, setCardChildren] = useState(0);
  const [cardHasPet, setCardHasPet] = useState(false);

  // Step 3 — Guest info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 4 — Services
  // Лише перемикачі (пізній виїзд / ранній заїзд): погодинні послуги сауни й
  // купелі та меню сніданку вирізано 05.09.2026 (П17) — це був флоу одного
  // клієнта, зашитий у віджет; погодинна послуга готелю — звичайна `services`.
  const [applyingCode, setApplyingCode] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(false);
  // Late checkout / Early checkin. null until the server answers, and null
  // forever if this hotel does not sell the service: a default here used to be
  // the pilot hotel's own price — a number invented by the client is a quote
  // the hotel never made.
  const [lateCheckout, setLateCheckout] = useState(false);
  const [earlyCheckin, setEarlyCheckin] = useState(false);
  const [lateCheckoutPrice, setLateCheckoutPrice] = useState<number | null>(null);
  const [earlyCheckinPrice, setEarlyCheckinPrice] = useState<number | null>(null);

  // Step 5 — Success
  const [reservation, setReservation] = useState<ReserveResponse | null>(null);
  const [redirectingToPayment, setRedirectingToPayment] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'failed' | null>(null);
  const [purchasedServices, setPurchasedServices] = useState<any[]>([]);

  // Widget mode: siteId injected by BookingWidget wrapper
  const siteId = typeof window !== 'undefined' ? (window as any).__BOOKING_SITE_ID__ || '' : '';
  const widgetSlug = typeof window !== 'undefined' ? (window as any).__BOOKING_SITE_SLUG__ || '' : '';
  const thankYouUrl = typeof window !== 'undefined' ? (window as any).__BOOKING_THANK_YOU_URL__ || '' : '';
  const isWidget = !!siteId;

  // The hotel's own name. It used to be a literal in translations.ts, so this
  // page greeted every hotel's guests with the first customer's brand.
  const [siteName, setSiteName] = useState('');
  useEffect(() => {
    const key = widgetSlug || siteId;
    if (!key) return;
    fetch(`${API_BASE}/api/booking/site-config?slug=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.name) setSiteName(d.name);
        // The hotel's language, if nothing the guest said outranks it.
        if (!langPinned.current) {
          const siteLang = asWidgetLang(d?.language);
          if (siteLang) { setLang(siteLang); langPinned.current = true; }
        }
      })
      .catch(() => { /* the widget works without a name */ });
  }, [widgetSlug, siteId]);

  // Whether step 4 has any services to show
  const [hasServices, setHasServices] = useState(true); // default true until checked

  // Calendar: booked days from Hostex (fetched per visible months)
  const [bookedDays, setBookedDays] = useState<Set<string>>(new Set());


  // Handle return from Teya payment (room or services checkout)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const successId = params.get('success');
    const pStatus = params.get('payment_status');
    const kind = (params.get('payment_kind') || 'room') as 'room' | 'services';

    const cleanUrl = () => window.history.replaceState({}, '', window.location.pathname);

    if (!successId || (pStatus !== 'success' && pStatus !== 'cancel')) return;

    (async () => {
      let ctxSrv: any = null;
      try {
        const r = await fetch(`${API_BASE}/api/booking/reservation?id=${encodeURIComponent(successId)}`);
        if (r.ok) ctxSrv = await r.json();
      } catch { /* ignore */ }

      let ctxCache: any = null;
      try {
        const saved = sessionStorage.getItem('booking-return-ctx');
        if (saved) ctxCache = JSON.parse(saved);
      } catch { /* ignore */ }

      const resSrv = ctxSrv?.reservation;
      setReservation({
        success: true,
        reservationId: successId,
        unitName: resSrv?.unit_name || ctxCache?.unitName || '',
        checkIn: resSrv?.check_in || ctxCache?.checkIn || '',
        checkOut: resSrv?.check_out || ctxCache?.checkOut || '',
        nights: resSrv?.nights || ctxCache?.nights || 0,
        totalPrice: resSrv?.total_price || ctxCache?.totalPrice || 0,
        originalPrice: resSrv?.total_price || ctxCache?.totalPrice || 0,
        offerDiscount: 0,
        certificateDiscount: 0,
        currency: 'CZK',
      });

      const ci = resSrv?.check_in || ctxCache?.checkIn;
      const co = resSrv?.check_out || ctxCache?.checkOut;
      if (ci) setCheckIn(ci);
      if (co) setCheckOut(co);

      if (Array.isArray(ctxSrv?.services)) setPurchasedServices(ctxSrv.services);

      if (pStatus === 'success') {
        setPaymentStatus('success');
        // Fire purchase pixel event
        window.dispatchEvent(new CustomEvent('bk:purchase', {
          detail: {
            reservationId: successId,
            value: ctxSrv?.reservation?.total_price || ctxCache?.totalPrice || 0,
            currency: 'CZK',
            kind,
          }
        }));
        // Step 6 = success screen (after payment confirmed)
        setStep(6);
        // If thank_you_url is set — redirect parent after short delay
        const tyUrl = (window as any).__BOOKING_THANK_YOU_URL__;
        if (tyUrl) {
          setTimeout(() => {
            try { window.parent.location.href = tyUrl; } catch { window.location.href = tyUrl; }
          }, 3000);
        }
      } else {
        setPaymentStatus('failed');
        setStep(5); // back to payment step
      }
      cleanUrl();

    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile summary
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // ─── Fetch booked dates for calendar ──────
  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        const months = [
          new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1),
          new Date(today.getFullYear(), today.getMonth() + calMonthOffset + 1, 1),
        ].map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);

        const booked = new Set<string>();
        const currentSiteId = typeof window !== 'undefined' ? (window as any).__BOOKING_SITE_ID__ || '' : '';

        await Promise.all(months.map(async (month) => {
          const params = new URLSearchParams({ month });
          if (currentSiteId) params.set('siteId', currentSiteId);
          const res = await fetch(`${API_BASE}/api/widget/calendar?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            for (const day of data.days || []) {
              if (day.status === 'booked') booked.add(day.date);
            }
          }
        }));

        setBookedDays(booked);
      } catch { /* silent — calendar is decorative, doesn't break booking */ }
    };
    fetchCalendar();
  }, [calMonthOffset, today]);


  // ─── Derived ──────
  const calMonths = useMemo(() => {
    const m1 = new Date(today.getFullYear(), today.getMonth() + calMonthOffset, 1);
    const m2 = new Date(today.getFullYear(), today.getMonth() + calMonthOffset + 1, 1);
    return [
      { year: m1.getFullYear(), month: m1.getMonth() },
      { year: m2.getFullYear(), month: m2.getMonth() },
    ];
  }, [today, calMonthOffset]);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    return Math.round((parseDate(checkOut).getTime() - parseDate(checkIn).getTime()) / 86400000);
  }, [checkIn, checkOut]);

  const selectedUnitData = useMemo(() => {
    if (!availability || !selectedUnit) return null;
    return availability.units.find(u => u.id === selectedUnit) || null;
  }, [availability, selectedUnit]);

  const toggleServicesTotal = useMemo(() => {
    return (lateCheckout ? (lateCheckoutPrice ?? 0) : 0) + (earlyCheckin ? (earlyCheckinPrice ?? 0) : 0);
  }, [lateCheckout, lateCheckoutPrice, earlyCheckin, earlyCheckinPrice]);

  // Extra person charge: if adults > baseOccupancy, charge per extra person per night
  const extraPersonTotal = useMemo(() => {
    if (!selectedUnitData) return 0;
    const extraGuests = Math.max(0, cardAdults - selectedUnitData.baseOccupancy);
    return extraGuests * (selectedUnitData.extraPersonCharge || 0) * nights;
  }, [selectedUnitData, cardAdults, nights]);

  const petTotal = useMemo(() => {
    if (!selectedUnitData || !cardHasPet) return 0;
    return selectedUnitData.petCharge || 0;
  }, [selectedUnitData, cardHasPet]);

  const servicesTotal = toggleServicesTotal;

  const totalWithDiscount = useMemo(() => {
    if (!selectedUnitData) return 0;
    let total = selectedUnitData.totalPrice + extraPersonTotal + petTotal;
    if (availability?.offerDiscount) {
      const pd = availability.offerDiscount;
      if (pd.discountType === 'percentage') {
        total -= percentOf(total, pd.offerAmount);
      } else {
        total -= pd.offerAmount;
      }
    }
    if (availability?.certificate?.amount) {
      total -= availability.certificate.amount;
    }
    total += servicesTotal;
    return Math.max(0, total);
  }, [selectedUnitData, availability, servicesTotal, extraPersonTotal, petTotal]);

  const stepLabels = useMemo(() => [t.step1, t.step2, t.step3, t.step4, t.step5], [t]);

  // ─── Calendar Day Click ──────
  const handleDayClick = useCallback((dateStr: string) => {
    const clickedDate = parseDate(dateStr);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    if (clickedDate < todayStart) return;

    if (!checkIn || (checkIn && checkOut) || !selectingCheckOut) {
      setCheckIn(dateStr);
      setCheckOut(null);
      setSelectingCheckOut(true);
      setAvailability(null);
      setSelectedUnit(null);
    } else {
      if (clickedDate <= parseDate(checkIn!)) {
        setCheckIn(dateStr);
        setCheckOut(null);
      } else {
        setCheckOut(dateStr);
        setSelectingCheckOut(false);
      }
    }
  }, [checkIn, checkOut, selectingCheckOut, today]);

  // ─── Check Availability ──────
  const fetchAvailability = useCallback(async () => {
    if (!checkIn || !checkOut) return;
    setLoadingAvail(true);
    setError(null);
    try {
      const params = new URLSearchParams({ checkIn, checkOut });
      if (offerApplied) params.set('couponCode', offerApplied);
      if (certInput) params.set('certificateCode', certInput);
      const res = await fetch(`${API_BASE}/api/booking/availability?${params.toString()}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setAvailability(data);
    } catch {
      setError(t.errorOccurred);
    }
    setLoadingAvail(false);
  }, [checkIn, checkOut, offerApplied, certInput, t]);

  // ─── Apply Coupon ──────
  //
  // This used to accept anything. It never called an API: it stored whatever
  // the guest typed and answered «Успішно застосовано» — for a code that does
  // not exist, for an expired one, for the empty-ish string `  x  `. The guest
  // then reached the payment step expecting a discount the hotel had never
  // issued, and either the price silently ignored the code (a guest who feels
  // cheated) or the booking went through with it (a hotel that lost money to a
  // code it never created).
  //
  // The same endpoint the other widget uses — `/api/booking/activate` — is
  // what decides. `BookingV2` had this right the whole time; this second,
  // older widget is the one hotels get from the iframe embed, so both are
  // shipped and only one of them was telling the truth.
  const applyCoupon = useCallback(async (rawCode?: string) => {
    const code = String(rawCode ?? promoInput).trim().toUpperCase();
    if (!code) return;
    setApplyingCode(true);
    setPromoMessage(null);
    try {
      const siteParam = (window as any).__BOOKING_SITE_ID__
        ? `&siteId=${encodeURIComponent((window as any).__BOOKING_SITE_ID__)}` : '';
      const res = await fetch(
        `${API_BASE}/api/booking/activate?code=${encodeURIComponent(code)}&unitId=${selectedUnit || ''}${siteParam}`,
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.valid) {
        setOfferApplied(data.code || code);
        setPromoMessage({ type: 'success', text: t.offerApplied });
      } else {
        setOfferApplied('');
        setPromoMessage({ type: 'error', text: data.error || t.invalidCode });
      }
    } catch {
      setOfferApplied('');
      setPromoMessage({ type: 'error', text: t.errorOccurred });
    } finally {
      setApplyingCode(false);
    }
  }, [promoInput, selectedUnit, t]);

  // ─── Navigation ──────
  const goToStep = useCallback((targetStep: number) => {
    setStep(targetStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goToStep2 = useCallback(async () => {
    if (!checkIn || !checkOut) return;
    await fetchAvailability();
    goToStep(2);
  }, [checkIn, checkOut, fetchAvailability, goToStep]);

  const goToStep3 = useCallback(() => {
    if (!selectedUnit) return;
    goToStep(3);
  }, [selectedUnit, goToStep]);

  const fetchServices = useCallback(async (ciParam?: string, coParam?: string) => {
    const ci = ciParam || checkIn;
    const co = coParam || checkOut;
    if (!ci || !co) return;
    setServicesLoading(true);
    try {
      // If widget mode with siteId — load site_services list first to check if any exist
      const currentSiteId = (window as any).__BOOKING_SITE_ID__ || '';
      if (currentSiteId) {
        const listRes = await fetch(`${API_BASE}/api/booking/services?siteId=${encodeURIComponent(currentSiteId)}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          const has = listData.hasServices === true && listData.services?.length > 0;
          setHasServices(has);
          (window as any).__BOOKING_HAS_SERVICES__ = has;
          if (!has) {
            setServicesLoading(false);
            return; // skip loading individual services — step 4 will be skipped
          }
        }
      } else {
        // Desktop mode: always has services
        (window as any).__BOOKING_HAS_SERVICES__ = true;
      }


      const siteParam = (window as any).__BOOKING_SITE_ID__ ? `&siteId=${encodeURIComponent((window as any).__BOOKING_SITE_ID__)}` : '';
      // Fetch late checkout price
      const lcRes = await fetch(`${API_BASE}/api/booking/services?serviceId=svc_late_checkout&checkIn=${ci}&checkOut=${co}${siteParam}`);
      if (lcRes.ok) {
        const lcData = await lcRes.json();
        setLateCheckoutPrice(typeof lcData.price === 'number' ? lcData.price : null);
      }
      const ecRes = await fetch(`${API_BASE}/api/booking/services?serviceId=svc_early_checkin&checkIn=${ci}&checkOut=${co}${siteParam}`);
      if (ecRes.ok) {
        const ecData = await ecRes.json();
        setEarlyCheckinPrice(typeof ecData.price === 'number' ? ecData.price : null);
      }
    } catch { /* silent */ }
    setServicesLoading(false);
  }, [checkIn, checkOut, siteId]);

  // ─── Submit Booking (Step 3: create reservation, then go to services or payment step) ──────

/**
 * Ключ ідемпотентності подання (INC-046).
 *
 * Один на віджет, не на клік: подвійний клік і повтор мережі мусять прийти з
 * ТИМ САМИМ ключем, інакше сервер не впізнає їх як повтор.
 *
 * Скидати його після успіху не треба, і це не недогляд: сервер рахує ключ як
 * пару «зміст броні × ця стрічка», тож наступне бронювання того самого гостя —
 * інший номер або інші дати — дає інший ключ саме тому, що змінилось тіло. А
 * ідентичне бронювання вдруге неможливе: номер уже зайнятий.
 */
  const reserveKeyRef = useRef<string>('');
  const reserveKey = () => {
    if (!reserveKeyRef.current) {
      reserveKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }
    return reserveKeyRef.current;
  };

  const submitBooking = useCallback(async () => {
    if (!checkIn || !checkOut || !selectedUnit || !firstName || !lastName || !phone) return;
    setSubmitting(true);
    setError(null);
    try {
      const currentSiteId = siteId || '';
      
      const params = new URLSearchParams(window.location.search);
      const utmParams: Record<string, string> = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ttclid'].forEach(key => {
        const val = params.get(key);
        if (val) utmParams[key] = val;
      });
      const widgetSessionId = params.get('widget_session_id') || (typeof window !== 'undefined' ? window.sessionStorage.getItem('alisio_sid') : undefined);

      const res = await fetch(`${API_BASE}/api/booking/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': reserveKey() },
        body: JSON.stringify({
          unitId: selectedUnit,
          checkIn,
          checkOut,
          adults: cardAdults,
          children: cardChildren,
          hasPet: cardHasPet,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim(),
          couponCode: offerApplied || undefined,
          certificateCode: certInput || undefined,
          siteId: currentSiteId || undefined,
          utmParams,
          lang,
          widgetSessionId: widgetSessionId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }
      const data = await res.json() as ReserveResponse;
      setReservation(data);

      try {
        sessionStorage.setItem('booking-return-ctx', JSON.stringify({
          reservationId: data.reservationId,
          unitName: data.unitName,
          checkIn: data.checkIn,
          checkOut: data.checkOut,
          nights: data.nights,
          totalPrice: data.totalPrice,
        }));
      } catch { /* private mode — ok */ }

      // Load services and decide: go to step 4 if site has services, else skip to 5
      await fetchServices(data.checkIn, data.checkOut);
      // hasServices state is updated inside fetchServices
      // Use a short delay so state flush completes
      setStep(prev => {
        // hasServices may still be stale — read from window global set by fetchServices
        const skip = (window as any).__BOOKING_SITE_ID__ && !(window as any).__BOOKING_HAS_SERVICES__;
        return skip ? 5 : 4;
      });
    } catch (e: any) {
      setError(e?.message || t.errorOccurred);
    }
    setSubmitting(false);
  }, [checkIn, checkOut, selectedUnit, cardAdults, cardChildren, cardHasPet, firstName, lastName, email, phone, offerApplied, certInput, t, fetchServices]);

  // ─── Submit Payment (Step 5: create Teya checkout) ──────
  const submitPayment = useCallback(async () => {
    const resId = reservation?.reservationId;
    if (!resId) return;
    setRedirectingToPayment(true);
    setError(null);
    try {
      const currentSlug = (window as any).__BOOKING_SITE_SLUG__ || '';
      const currentSiteId = (window as any).__BOOKING_SITE_ID__ || '';
      const returnBase = currentSlug ? `/w/${currentSlug}` : '/booking';
      const returnPath = `${returnBase}?success=${resId}&payment_kind=room`;

      // Online payment was removed with the payments module — the booking
      // stands as created and is paid on arrival. The success return path is
      // the same one the payment redirect used to come back to.
      void currentSiteId;
      window.location.href = returnPath;
      return;
    } catch (e: any) {
      setError(e?.message || t.errorOccurred);
      setRedirectingToPayment(false);
    }
  }, [reservation, t]);

  // ─── Submit Services (Step 4: write services + second Teya checkout) ──────

  const submitServices = useCallback(async () => {
    const resId = reservation?.reservationId;
    if (!resId) return;
    const nothingPicked = !lateCheckout && !earlyCheckin;
    if (nothingPicked) { setStep(5); return; }

    setSubmitting(true);
    setError(null);
    try {
      const post = (body: any) => fetch(`${API_BASE}/api/booking/services`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (lateCheckout) {
        try { await post({ action: 'book-toggle', serviceId: 'svc_late_checkout', reservationId: resId }); } catch { /* */ }
      }
      if (earlyCheckin) {
        try { await post({ action: 'book-toggle', serviceId: 'svc_early_checkin', reservationId: resId }); } catch { /* */ }
      }

      // All services written — go to payment step (step 5 shows breakdown + Pay button)
      goToStep(5);
    } catch (e: any) {
      setError(e?.message || t.errorOccurred);
    }
    setSubmitting(false);
  }, [reservation, lateCheckout, earlyCheckin, t, goToStep]);


  // ─── Reset ──────
  const resetForm = useCallback(() => {
    setStep(1);
    setCheckIn(null);
    setCheckOut(null);
    setSelectingCheckOut(false);
    setAdults(2);
    setChildren(0);
    setPromoInput('');
    setCertInput('');
    setOfferApplied('');
    setPromoMessage(null);
    setAvailability(null);
    setSelectedUnit(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setReservation(null);
    setError(null);
    setCalMonthOffset(0);
    setPurchasedServices([]);
    try { sessionStorage.removeItem('booking-return-ctx'); } catch { /* */ }
    // Payment state
    setRedirectingToPayment(false);
    setPaymentStatus(null);
  }, []);

  // ─── Render Calendar Month ──────
  const renderMonth = (year: number, month: number) => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const todayStr = fmtDate(today);

    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`e-${i}`} className="booking-cal-day empty" />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = parseDate(dateStr);
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const isPast = dateObj < todayStart;
      const isToday = dateStr === todayStr;

      let rangeClass = '';
      if (checkIn && dateStr === checkIn) rangeClass = 'range-start';
      if (checkOut && dateStr === checkOut) rangeClass += ' range-end';
      if (checkIn && checkOut && dateStr > checkIn && dateStr < checkOut) rangeClass = 'in-range';

      const isBooked = bookedDays.has(dateStr);

      cells.push(
        <button
          key={d}
          className={`booking-cal-day ${isPast ? 'past' : ''} ${isBooked ? 'booked' : ''} ${isToday && !isBooked ? 'today' : ''} ${rangeClass}`}
          onClick={() => !isPast && !isBooked && handleDayClick(dateStr)}
          disabled={isPast || isBooked}
          type="button"
        >
          {d}
        </button>
      );
    }

    return cells;
  };

  // ─── Sidebar Content (reused for desktop & mobile) ──────
  const renderSidebarContent = () => (
    <>
      {/* Choice Summary */}
      <div className="booking-sidebar-card">
        <div className="booking-sidebar-title">{t.yourChoice}</div>

        {checkIn && checkOut ? (
          <div className="booking-sidebar-dates">
            <div className="booking-sidebar-date-col">
              <div className="booking-sidebar-label">{t.checkIn}</div>
              <div className="booking-sidebar-value">{formatDisplayDate(checkIn, lang)}</div>
            </div>
            <div className="booking-sidebar-date-col">
              <div className="booking-sidebar-label">{t.checkOut}</div>
              <div className="booking-sidebar-value">{formatDisplayDate(checkOut, lang)}</div>
            </div>
          </div>
        ) : (
          <div className="booking-sidebar-dates">
            <div className="booking-sidebar-date-col">
              <div className="booking-sidebar-label">{t.checkIn}</div>
              <div className="booking-sidebar-value" style={{ color: 'var(--bk-text-muted)' }}>—</div>
            </div>
            <div className="booking-sidebar-date-col">
              <div className="booking-sidebar-label">{t.checkOut}</div>
              <div className="booking-sidebar-value" style={{ color: 'var(--bk-text-muted)' }}>—</div>
            </div>
          </div>
        )}

        <div className="booking-sidebar-location">
          <span className="booking-sidebar-location-icon">🏕️</span>
          {siteName}
        </div>
      </div>

      {/* House Summary */}
      <div className="booking-sidebar-card">
        <div className="booking-sidebar-unit-title">
          <span>{t.yourHouse}</span>
          {selectedUnitData && (
            <button
              className="booking-sidebar-unit-delete"
              onClick={() => setSelectedUnit(null)}
              type="button"
            >
              🗑
            </button>
          )}
        </div>

        {selectedUnitData ? (
          <>
            <div className="booking-sidebar-unit-info">
              <div className="booking-sidebar-unit-thumb">🏕️</div>
              <div className="booking-sidebar-unit-details">
                <div className="booking-sidebar-unit-name">{selectedUnitData.name}</div>
                <div className="booking-sidebar-unit-meta">
                  👥 {selectedUnitData.baseOccupancy} {t.guests}{siteName ? ` · 🏕️ ${siteName}` : ''}
                </div>
              </div>
              <div className="booking-sidebar-unit-price-label">
                {formatPrice(selectedUnitData.totalPrice)} Kč
              </div>
            </div>

            <div className="booking-sidebar-guests">
              👥 {adults} {t.adults.toLowerCase()}{children > 0 ? `, ${children} ${t.children.toLowerCase()}` : ''}
              {cardHasPet && ' · 🐾'}
            </div>

            {/* Extra person charge */}
            {extraPersonTotal > 0 && (
              <div style={{ padding: '6px 12px', background: 'var(--bk-bg)', borderRadius: 'var(--bk-radius-xs)', marginBottom: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>+{adults - selectedUnitData.baseOccupancy} {t.extraPersonCharge}</span>
                <strong>+{formatPrice(extraPersonTotal)} Kč</strong>
              </div>
            )}

            {/* Pet charge */}
            {petTotal > 0 && (
              <div style={{ padding: '6px 12px', background: 'var(--bk-bg)', borderRadius: 'var(--bk-radius-xs)', marginBottom: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>🐾 {t.petCheckbox}</span>
                <strong>+{formatPrice(petTotal)} Kč</strong>
              </div>
            )}

            {/* Services in sidebar */}
            {lateCheckout && (
              <div style={{ padding: '6px 12px', background: 'var(--bk-bg)', borderRadius: 'var(--bk-radius-xs)', marginBottom: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>🕐 {t.lateCheckoutTitle}</span>
                <strong>{formatPrice(lateCheckoutPrice ?? 0)} Kč</strong>
              </div>
            )}
            {earlyCheckin && (
              <div style={{ padding: '6px 12px', background: 'var(--bk-bg)', borderRadius: 'var(--bk-radius-xs)', marginBottom: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>🕛 {t.earlyCheckinTitle}</span>
                <strong>{formatPrice(earlyCheckinPrice ?? 0)} Kč</strong>
              </div>
            )}

            <div className="booking-sidebar-total-row">
              <div className="booking-sidebar-total-details">
                {nights} {t.nightsWord(nights)}, {adults} {t.adults.toLowerCase()}
                {servicesTotal > 0 && ` + ${t.additionalServices.toLowerCase()}`}
              </div>
              <div className="booking-sidebar-total-amount">
                <span className="booking-sidebar-total-currency">Kč</span>
                {formatPrice(totalWithDiscount)}
              </div>
              <div className="booking-sidebar-total-note">{t.including}</div>
            </div>
          </>
        ) : (
          <div className="booking-sidebar-placeholder">
            <span className="booking-sidebar-placeholder-icon">ⓘ</span>
            {t.housePlaceholder}
          </div>
        )}
      </div>
    </>
  );

  // ─── Render ──────
  return (
    <div className={`booking-page ${isWidget ? 'is-widget' : ''}`}>
      {/* ═══ Header ═══ */}
      {!isWidget && (
        <header className="booking-header">
          <div className="booking-logo">
            <div className="booking-logo-icon">Q</div>
            <span>{siteName || t.brandName}</span>
          </div>
          <div className="booking-header-right">
            {/* Social icons used to sit here,
                all three linking to "#". A social link that goes nowhere is
                worse than no icon: the guest clicks and nothing happens.
                Bring them back when a site can store its own handles. */}
          </div>
        </header>
      )}

      {/* ═══ Stepper ═══ */}
      {step < 6 && (
        <div className="booking-stepper">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`booking-step-item ${step === s ? 'active' : ''} ${step > s ? 'completed' : ''}`}
            >
              {i > 0 && <div className={`booking-step-line ${step > s ? 'completed' : ''}`} />}
              <div className="booking-step-circle">
                {step > s ? '✓' : s}
              </div>
              <div
                className="booking-step-label"
                onClick={() => step > s && goToStep(s)}
              >
                {stepLabels[i]}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Main Layout ═══ */}
      <div className="booking-layout">
        {/* ─── Left Sidebar (visible on desktop only) ─── */}
        {step < 6 && (
          <aside className="booking-sidebar">
            {renderSidebarContent()}
          </aside>
        )}

        {/* ─── Center Content ─── */}
        <main className="booking-main">
          {/* Mobile Cart Toggle */}
          {step < 6 && step > 1 && (
            <button
              className="booking-mobile-summary-toggle"
              onClick={() => setMobileCartOpen(true)}
              type="button"
            >
              <span>{t.bookingDetails}</span>
              <span>{selectedUnitData ? `${formatPrice(totalWithDiscount)} Kč` : '—'}</span>
            </button>
          )}

          {/* ═══════ STEP 1: Your Choice (Dates) ═══════ */}
          {step === 1 && (
            <div className="booking-fade-in">
              <div className="booking-content-card">
                {/* Date Summary Bar */}
                <div className="booking-field" style={{ marginBottom: 16 }}>
                  <label className="booking-field-label">{t.dates} <span className="booking-field-required">*</span></label>
                  <div className="booking-dates-bar">
                    <div className={`booking-dates-bar-item ${!checkIn && !selectingCheckOut ? 'active' : ''}`}>
                      <div className="booking-dates-bar-label">{t.checkIn}</div>
                      <div className={`booking-dates-bar-value ${!checkIn ? 'placeholder' : ''}`}>
                        {checkIn ? formatDisplayDate(checkIn, lang) : t.selectCheckIn}
                      </div>
                    </div>
                    <div className={`booking-dates-bar-item ${checkIn && selectingCheckOut ? 'active' : ''}`}>
                      <div className="booking-dates-bar-label">{t.checkOut}</div>
                      <div className={`booking-dates-bar-value ${!checkOut ? 'placeholder' : ''}`}>
                        {checkOut ? formatDisplayDate(checkOut, lang) : t.selectCheckOut}
                      </div>
                    </div>
                    {nights > 0 && (
                      <div className="booking-duration-badge">
                        <div>
                          <div className="booking-duration-badge-label">{t.duration}</div>
                          <div style={{ fontWeight: 600 }}>{nights} {t.nightsWord(nights)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Calendar Navigation */}
                <div className="booking-cal-nav">
                  <button
                    className="booking-cal-nav-btn"
                    onClick={() => setCalMonthOffset(o => Math.max(0, o - 1))}
                    disabled={calMonthOffset === 0}
                    type="button"
                  >
                    ‹
                  </button>
                  <div className="booking-cal-months-label">
                    <span>{t.monthNames[calMonths[0].month]} {calMonths[0].year}</span>
                    <span>{t.monthNames[calMonths[1].month]} {calMonths[1].year}</span>
                  </div>
                  <button
                    className="booking-cal-nav-btn"
                    onClick={() => setCalMonthOffset(o => o + 1)}
                    type="button"
                  >
                    ›
                  </button>
                </div>

                {/* Calendar */}
                <div className="booking-calendars">
                  {calMonths.map(({ year, month }) => (
                    <div key={`${year}-${month}`} className="booking-cal-month">
                      <div className="booking-cal-weekdays">
                        {[1, 2, 3, 4, 5, 6, 0].map(d => (
                          <div key={d} className={`booking-cal-weekday ${d === 0 || d === 6 ? 'weekend' : ''}`}>
                            {t.dayNamesShort[d]}
                          </div>
                        ))}
                      </div>
                      <div className="booking-cal-grid">
                        {renderMonth(year, month)}
                      </div>
                    </div>
                  ))}
                </div>



                {/* Coupon & Certificate */}
                <div className="booking-codes-row">
                  <div className="booking-code-input-group">
                    <input
                      className="booking-code-input"
                      placeholder={t.couponCode}
                      value={promoInput}
                      onChange={e => { setPromoInput(e.target.value); setPromoMessage(null); }}
                    />
                    <button
                      className="booking-code-btn"
                      onClick={() => applyCoupon()}
                      disabled={applyingCode || !promoInput.trim()}
                      type="button"
                    >{applyingCode ? '…' : t.apply}</button>
                  </div>
                  <div className="booking-code-input-group">
                    <input
                      className="booking-code-input"
                      placeholder={t.certificateCode}
                      value={certInput}
                      onChange={e => setCertInput(e.target.value)}
                    />
                    {/* `onClick={() => { }}` — a button on the money path that
                        did nothing. The guest typed a certificate code, pressed
                        Apply and got no response of any kind: not an error, not
                        a discount, not even a spinner. */}
                    <button
                      className="booking-code-btn"
                      onClick={() => applyCoupon(certInput)}
                      disabled={applyingCode || !certInput.trim()}
                      type="button"
                    >{applyingCode ? '…' : t.apply}</button>
                  </div>
                </div>

                {promoMessage && (
                  <div className={`booking-alert ${promoMessage.type}`} style={{ marginTop: 12 }}>
                    <span className="booking-alert-icon">{promoMessage.type === 'success' ? '✓' : '✗'}</span>
                    {promoMessage.text}
                  </div>
                )}
              </div>

              {/* Nav Bar (sticky on mobile) */}
              <div className="booking-nav-bar sticky-mobile">
                <button className="booking-btn-back" disabled type="button">
                  ‹ {t.back}
                </button>
                <button
                  className="booking-btn-next"
                  onClick={goToStep2}
                  disabled={!checkIn || !checkOut || nights < 1}
                  type="button"
                >
                  {t.next} ›
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 2: House Selection ═══════ */}
          {step === 2 && (
            <div className="booking-fade-in">
              {/* Multi-house info tooltip */}
              <div className="booking-multi-house-info">
                <span className="booking-multi-house-info-icon">ℹ</span>
                {t.multiHouseInfo}
              </div>

              {loadingAvail ? (
                <div className="booking-loading">
                  <div className="booking-spinner" />
                </div>
              ) : availability && availability.units.length > 0 ? (
                <div>
                  {availability.units.map(unit => {
                    const isExpanded = expandedUnit === unit.id;
                    const isSelected = selectedUnit === unit.id;
                    const extraGuests = Math.max(0, cardAdults - unit.baseOccupancy);
                    const dynamicExtra = extraGuests * (unit.extraPersonCharge || 0) * nights;
                    const dynamicPet = cardHasPet ? (unit.petCharge || 0) : 0;
                    const dynamicTotal = unit.totalPrice + dynamicExtra + dynamicPet;

                    // Generate adult options for dropdown
                    const adultOptions = [];
                    for (let i = 1; i <= unit.maxAdults; i++) {
                      const extra = Math.max(0, i - unit.baseOccupancy);
                      const label = extra > 0
                        ? `${i} ${t.adultsCount} +${formatPrice(extra * (unit.extraPersonCharge || 0))} Kč`
                        : `${i} ${t.adultsCount}`;
                      adultOptions.push({ value: i, label });
                    }

                    return (
                      <div
                        key={unit.id}
                        className={`booking-house-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
                      >
                        {/* Photo */}
                        <div className="booking-house-photo-container">
                          <div className="booking-house-photo-placeholder">🏕️</div>
                        </div>

                        {/* Info — collapsed view */}
                        <div className="booking-house-info">
                          <div className="booking-house-name">{unit.name}</div>
                          <div className="booking-house-specs">
                            <div className="booking-house-spec">
                              <span className="booking-house-spec-icon">👥</span>
                              {t.totalFor} {unit.baseOccupancy} {t.guests} (+{unit.maxAdults - unit.baseOccupancy})
                            </div>
                            {siteName && (
                              <div className="booking-house-spec">
                                <span className="booking-house-spec-icon">🏕️</span>
                                {siteName}
                              </div>
                            )}
                          </div>

                          {/* Description text like ULIS */}
                          {unit.description && (
                            <p className="booking-house-desc">{unit.description}</p>
                          )}

                          {/* Pet-friendly note on card */}
                          {unit.petAllowed && (
                            <div className="booking-house-pet-note">
                              <span>{t.petFriendly}</span>
                              <span className="booking-house-pet-note-sub">{t.petFriendlyDesc} — {formatPrice(unit.petCharge)} Kč</span>
                            </div>
                          )}

                          <div className="booking-house-pricing">
                            {!unit.hasPricing && (
                              <div className="booking-house-stub-badge">⚠ {t.stubPricing}</div>
                            )}
                            {!isExpanded && (
                              <>
                                <div className="booking-house-price">
                                  <span className="booking-house-price-currency">Kč</span>
                                  <span className="booking-house-price-amount">{formatPrice(unit.totalPrice)}</span>
                                </div>
                                {!isSelected ? (
                                  <button
                                    className="booking-house-add-btn"
                                    onClick={() => {
                                      setExpandedUnit(unit.id);
                                      setCardAdults(unit.baseOccupancy);
                                      setCardChildren(0);
                                      setCardHasPet(false);
                                    }}
                                    type="button"
                                  >
                                    {`${t.addHouse} +`}
                                  </button>
                                ) : (
                                  <button className="booking-house-add-btn selected" type="button" disabled>
                                    ✓ {t.selectedHouse}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* ─── Expanded details (ULIS-style) ─── */}
                        {isExpanded && (
                          <div className="booking-house-expanded">
                            {/* Amenities */}
                            {unit.amenities && unit.amenities.length > 0 && (
                              <div className="booking-house-amenities">
                                <div className="booking-house-section-title">{t.amenitiesTitle}</div>
                                <div className="booking-house-amenities-grid">
                                  {unit.amenities.map((a: { icon: string; name: string }, i: number) => (
                                    <span key={i} className="booking-house-amenity">{a.name}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Guest selection — 3 columns like ULIS */}
                            <div className="booking-house-guests-row">
                              <div className="booking-house-guest-field">
                                <label><span className="bh-field-icon">👥</span> {t.adultsCount} *</label>
                                <select
                                  value={cardAdults}
                                  onChange={e => setCardAdults(Number(e.target.value))}
                                  className="booking-house-select"
                                >
                                  {adultOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="booking-house-guest-field">
                                <label><span className="bh-field-icon">🧒</span> {t.childrenCount}</label>
                                <select
                                  value={cardChildren}
                                  onChange={e => setCardChildren(Number(e.target.value))}
                                  className="booking-house-select"
                                >
                                  {Array.from({ length: unit.maxChildren + 1 }, (_, i) => (
                                    <option key={i} value={i}>{i} {t.childrenCount.toLowerCase()}</option>
                                  ))}
                                </select>
                              </div>
                              {unit.petAllowed && (
                                <div className="booking-house-guest-field">
                                  <label><span className="bh-field-icon">🐾</span> {t.petPresence}</label>
                                  <label className="booking-house-pet-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={cardHasPet}
                                      onChange={e => setCardHasPet(e.target.checked)}
                                    />
                                    <span>{t.petCheckbox}</span>
                                  </label>
                                </div>
                              )}
                            </div>

                            {/* Charge notes — like ULIS */}
                            <div className="booking-house-charge-notes">
                              {unit.extraPersonCharge > 0 && (
                                <div className="booking-house-charge-note">+ {formatPrice(unit.extraPersonCharge)} Kč {t.extraPersonCharge}</div>
                              )}
                              {unit.petAllowed && (
                                <div className="booking-house-charge-note">+ {formatPrice(unit.petCharge)} Kč {t.petFriendlyDesc.split('.')[0].toLowerCase()}</div>
                              )}
                            </div>

                            {/* Price + actions — like ULIS */}
                            <div className="booking-house-expanded-footer">
                              <div className="booking-house-expanded-actions">
                                <button
                                  className="booking-btn-outline"
                                  onClick={() => setExpandedUnit(null)}
                                  type="button"
                                >
                                  {t.closeCard}
                                </button>
                                <button
                                  className="booking-house-add-btn"
                                  onClick={() => {
                                    setSelectedUnit(unit.id);
                                    setAdults(cardAdults);
                                    setChildren(cardChildren);
                                    setExpandedUnit(null);
                                  }}
                                  type="button"
                                >
                                  {t.bookHouse}
                                </button>
                              </div>
                              <div className="booking-house-dynamic-price">
                                {nights} {t.nightsWord(nights)}, {cardAdults} {t.adultsCount.toLowerCase()}
                                {cardHasPet && `, 1 🐾`}
                                <div className="booking-house-dynamic-total">
                                  <span className="booking-house-price-currency">Kč</span>
                                  <span className="booking-house-price-amount">{formatPrice(dynamicTotal)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="booking-no-avail">
                  <div className="booking-no-avail-icon">🏠</div>
                  <h3>{t.noAvailability}</h3>
                  <p>{t.noAvailabilityDesc}</p>
                </div>
              )}

              {error && (
                <div className="booking-alert error" style={{ marginTop: 16 }}>
                  <span className="booking-alert-icon">✗</span>
                  {error}
                </div>
              )}

              {/* Nav Bar (sticky on mobile) */}
              <div className="booking-nav-bar sticky-mobile">
                <button className="booking-btn-back" onClick={() => goToStep(1)} type="button">
                  ‹ {t.back}
                </button>
                <button
                  className="booking-btn-next"
                  onClick={goToStep3}
                  disabled={!selectedUnit}
                  type="button"
                >
                  {t.next} ›
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 3: Personal Info ═══════ */}
          {step === 3 && (
            <div className="booking-fade-in">
              <div className="booking-content-card">
                {/* Name Row */}
                <div className="booking-form-row">
                  <div className="booking-field">
                    <label className="booking-field-label">
                      {t.firstName} <span className="booking-field-required">*</span>
                    </label>
                    <input
                      className="booking-field-input"
                      type="text"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      placeholder={t.firstName}
                    />
                  </div>
                  <div className="booking-field">
                    <label className="booking-field-label">
                      {t.lastName} <span className="booking-field-required">*</span>
                    </label>
                    <input
                      className="booking-field-input"
                      type="text"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      placeholder={t.lastName}
                    />
                  </div>
                </div>

                {/* Phone & Email */}
                <div className="booking-form-row">
                  <div className="booking-field">
                    <label className="booking-field-label">
                      {t.phone} <span className="booking-field-required">*</span>
                    </label>
                    <input
                      className="booking-field-input"
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+…"
                    />
                  </div>
                  <div className="booking-field">
                    <label className="booking-field-label">
                      {t.email} <span className="booking-field-required">*</span>
                    </label>
                    <input
                      className="booking-field-input"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="example@gmail.com"
                    />
                  </div>
                </div>

                <p className="booking-terms">{t.agreeTerms}</p>
              </div>

              {error && (
                <div className="booking-alert error" style={{ marginTop: 16 }}>
                  <span className="booking-alert-icon">✗</span>
                  {error}
                </div>
              )}

              {/* Nav Bar (sticky on mobile) — final Pay action on Step 3 */}
              <div className="booking-nav-bar sticky-mobile">
                <button className="booking-btn-back" onClick={() => goToStep(2)} type="button">
                  ‹ {t.back}
                </button>
                <button
                  className="booking-btn-next"
                  onClick={submitBooking}
                  disabled={submitting || !firstName.trim() || !lastName.trim() || !phone.trim()}
                  type="button"
                >
                  {submitting ? t.processing : `${t.payAndConfirm} ›`}
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 4: Upsell services (after room payment) ═══════ */}
          {step === 4 && (
            <div className="booking-fade-in">
              <div className="booking-alert success booking-confirmed-banner">
                <span className="booking-alert-icon">✓</span>
                <div>
                  <strong>{t.bookingConfirmedTitle}</strong>
                  <div style={{ fontSize: 13, marginTop: 2, color: 'var(--bk-text-muted)' }}>
                    {t.bookingConfirmedDesc}
                  </div>
                </div>
              </div>

              {servicesLoading ? (
                <div className="booking-loading"><div className="booking-spinner" /></div>
              ) : (
                <>
                  {/* ─── LATE CHECKOUT / EARLY CHECKIN ─── */}
                  {lateCheckoutPrice !== null && (
                  <div className={`svc-toggle-card ${lateCheckout ? 'active' : ''}`}>
                    <div className="svc-toggle-info">
                      <span className="svc-toggle-icon">🕐</span>
                      <div className="svc-toggle-text">
                        <h4>{t.lateCheckoutTitle}</h4>
                        <p>{t.lateCheckoutDesc}</p>
                      </div>
                    </div>
                    <span className="svc-toggle-price">{formatPrice(lateCheckoutPrice ?? 0)} Kč</span>
                    <button
                      className={`svc-toggle-switch ${lateCheckout ? 'on' : ''}`}
                      onClick={() => setLateCheckout(v => !v)}
                      type="button"
                      aria-label={t.lateCheckoutTitle}
                    />
                  </div>
                  )}

                  {earlyCheckinPrice !== null && (
                  <div className={`svc-toggle-card ${earlyCheckin ? 'active' : ''}`}>
                    <div className="svc-toggle-info">
                      <span className="svc-toggle-icon">🕛</span>
                      <div className="svc-toggle-text">
                        <h4>{t.earlyCheckinTitle}</h4>
                        <p>{t.earlyCheckinDesc}</p>
                      </div>
                    </div>
                    <span className="svc-toggle-price">{formatPrice(earlyCheckinPrice ?? 0)} Kč</span>
                    <button
                      className={`svc-toggle-switch ${earlyCheckin ? 'on' : ''}`}
                      onClick={() => setEarlyCheckin(v => !v)}
                      type="button"
                      aria-label={t.earlyCheckinTitle}
                    />
                  </div>
                  )}

                  {/* Services Total */}
                  {servicesTotal > 0 && (
                    <div className="booking-alert info" style={{ marginTop: 8 }}>
                      <span className="booking-alert-icon">💰</span>
                      {t.serviceTotal}: <strong>{formatPrice(servicesTotal)} Kč</strong>
                    </div>
                  )}

                </>
              )}

              {error && (
                <div className="booking-alert error" style={{ marginTop: 16 }}>
                  <span className="booking-alert-icon">✗</span>
                  {error}
                </div>
              )}

              {/* Nav Bar (sticky on mobile) — Skip vs Confirm services */}
              <div className="booking-nav-bar sticky-mobile">
                <button
                  className="booking-btn-back"
                  onClick={() => goToStep(5)}
                  type="button"
                >
                  {t.skipToThankYou}
                </button>
                <button
                  className="booking-btn-next"
                  onClick={submitServices}
                  disabled={submitting || (!lateCheckout && !earlyCheckin)}
                  type="button"
                >
                  {submitting ? t.processing : `${t.confirmServices} ›`}
                </button>
              </div>
            </div>
          )}


          {/* ═══════ STEP 5: Payment Breakdown ═══════ */}
          {step === 5 && (
            <div className="booking-fade-in">
              <div className="booking-content-card">
                <h2 style={{ fontFamily: 'var(--bk-font-heading, Fraunces, serif)', marginBottom: 4 }}>
                  {t.paymentTitle || tUi('Оплата')}
                </h2>
                <p style={{ color: 'var(--bk-ink-2, #5A5A5A)', fontSize: 13, marginBottom: 20 }}>
                  {t.paymentSubtitle || tUi('Перевірте суму і перейдіть до оплати')}
                </p>

                {/* Breakdown */}
                <div className="booking-success-details">
                  {reservation?.unitName && (
                    <div className="booking-success-detail-row">
                      <span>{t.houseName}</span>
                      <span>{reservation.unitName}</span>
                    </div>
                  )}
                  {checkIn && (
                    <div className="booking-success-detail-row">
                      <span>{t.checkIn}</span>
                      <span>{formatShortDate(checkIn, lang)}</span>
                    </div>
                  )}
                  {checkOut && (
                    <div className="booking-success-detail-row">
                      <span>{t.checkOut}</span>
                      <span>{formatShortDate(checkOut, lang)}</span>
                    </div>
                  )}
                  {(reservation?.nights ?? 0) > 0 && (
                    <div className="booking-success-detail-row">
                      <span>{t.nights}</span>
                      <span>{reservation?.nights}</span>
                    </div>
                  )}
                  {(reservation?.offerDiscount ?? 0) > 0 && (
                    <div className="booking-success-detail-row">
                      <span>{t.discount}</span>
                      <span style={{ color: 'var(--bk-accent)' }}>-{formatPrice(reservation!.offerDiscount)} Kč</span>
                    </div>
                  )}
                  {servicesTotal > 0 && (
                    <div className="booking-success-detail-row">
                      <span>{t.serviceTotal}</span>
                      <span>{formatPrice(servicesTotal)} Kč</span>
                    </div>
                  )}
                  <div className="booking-success-detail-row" style={{ borderTop: '1px solid var(--bk-line, #EAEAE4)', paddingTop: 8, marginTop: 4 }}>
                    <span><strong>{t.total}</strong></span>
                    <span><strong>{formatPrice((reservation?.totalPrice ?? 0) + servicesTotal)} Kč</strong></span>
                  </div>
                </div>

                {error && (
                  <div className="booking-alert error" style={{ marginTop: 16 }}>
                    <span className="booking-alert-icon">✗</span>
                    {error}
                  </div>
                )}
              </div>

              <div className="booking-nav-bar sticky-mobile">
                <button
                  className="booking-btn-back"
                  onClick={() => goToStep(4)}
                  type="button"
                >
                  ‹ {t.back}
                </button>
                <button
                  className="booking-btn-next"
                  onClick={submitPayment}
                  disabled={redirectingToPayment || !reservation}
                  type="button"
                  id="widget-pay-button"
                >
                  {redirectingToPayment
                    ? t.redirectingToPayment
                    : `💳 ${t.payNow || tUi('Оплатити')}`}
                </button>
              </div>
            </div>
          )}


          {/* ═══════ STEP 6: Success ═══════ */}
          {step === 6 && (
            <div className="booking-fade-in booking-success">
              {/* Payment cancelled/failed */}
              {paymentStatus === 'failed' && (
                <>
                  <div className="booking-success-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>✗</div>
                  <h2>{t.paymentFailed}</h2>
                  <p>{t.paymentFailedDesc}</p>
                  <button className="booking-btn-next" onClick={resetForm} type="button" style={{ marginTop: 16 }}>
                    {t.tryAgain}
                  </button>
                </>
              )}
              {/* Payment success or tentative booking */}
              {paymentStatus !== 'failed' && reservation && (
                <>
                  <div className="booking-success-icon">✓</div>
                  <h2>{paymentStatus === 'success' ? t.paymentSuccess : t.bookingSuccess}</h2>
                  <p>{paymentStatus === 'success' ? t.paymentSuccessDesc : t.bookingSuccessDesc}</p>
                  <p style={{ color: 'var(--bk-accent)', fontWeight: 600, fontSize: 13 }}>
                    {t.weWillContact}
                  </p>

                  <div className="booking-success-id">
                    {t.bookingId}: <strong>{reservation.reservationId}</strong>
                  </div>

                  {reservation.unitName && (
                    <div className="booking-success-details">
                      <div className="booking-success-detail-row">
                        <span>{t.houseName}</span>
                        <span>{reservation.unitName}</span>
                      </div>
                      <div className="booking-success-detail-row">
                        <span>{t.checkIn}</span>
                        <span>{formatShortDate(reservation.checkIn, lang)}</span>
                      </div>
                      <div className="booking-success-detail-row">
                        <span>{t.checkOut}</span>
                        <span>{formatShortDate(reservation.checkOut, lang)}</span>
                      </div>
                      <div className="booking-success-detail-row">
                        <span>{t.nights}</span>
                        <span>{reservation.nights}</span>
                      </div>
                      {reservation.offerDiscount > 0 && (
                        <div className="booking-success-detail-row">
                          <span>{t.discount}</span>
                          <span style={{ color: 'var(--bk-accent)' }}>−{formatPrice(reservation.offerDiscount)} Kč</span>
                        </div>
                      )}
                      <div className="booking-success-detail-row">
                        <span><strong>{t.total}</strong></span>
                        <span><strong>{formatPrice(reservation.totalPrice)} Kč</strong></span>
                      </div>
                    </div>
                  )}

                  {purchasedServices.length > 0 && (
                    <div className="booking-purchased-services">
                      <div className="booking-purchased-services-title">{t.purchasedServicesTitle}</div>
                      <ul>
                        {purchasedServices.map((s) => (
                          <li key={s.id}>
                            <span>{s.service_name || s.service_id}</span>
                            <strong>{formatPrice(s.total_price || 0)} Kč</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button className="booking-btn-next" onClick={resetForm} type="button" style={{ marginTop: 16 }}>
                    {t.backToStart}
                  </button>
                </>
              )}

              {/* Redirecting to payment overlay */}
              {redirectingToPayment && (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 16, animation: 'pulse 1.5s infinite' }}>💳</div>
                  <h2>{t.redirectingToPayment}</h2>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ═══ Mobile Cart Overlay ═══ */}
      {mobileCartOpen && (
        <div className="booking-mobile-summary-overlay" onClick={() => setMobileCartOpen(false)}>
          <div className="booking-mobile-summary-content" onClick={e => e.stopPropagation()}>
            <button className="booking-mobile-summary-close" onClick={() => setMobileCartOpen(false)} type="button">
              ‹ {t.back}
            </button>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* ═══ Footer ═══ */}
      {!isWidget && (
        <footer className="booking-footer">
          © {new Date().getFullYear()} {siteName || t.brandName} · {t.poweredBy}
        </footer>
      )}
    </div>
  );
}
