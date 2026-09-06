'use client';

import { useT } from '@core/i18n/client';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Loader2, Save, Plus } from 'lucide-react';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import { shouldAskQuote, readQuote, type QuoteResponse } from './quote-prefill';
import { percentOf } from '@core/money';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BookingFormValues {
  category: string;
  unitTypeId: string;
  unitId: string;
  source: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  paymentStatus: string;
  totalPrice: string;
  commissionAmount: string;
  cityTaxAmount: string;
  cityTaxIncluded: boolean;
  cityTaxPaid: string;
  internalNotes: string;
}

export interface UnitTypeRow {
  id: string;
  name: string;
  category_type: string;
  /** The category's own name — what the operator actually called it. */
  category_name?: string;
  unit_count?: number;
}

export interface UnitRow {
  id: string;
  name: string;
  code?: string;
  category_type: string;
  unit_type_id: string;
}

export interface BookingSourceRow {
  code: string;
  name: string;
  color?: string;
  commission_percent?: number;
  city_tax_included_default?: number | boolean;
}

export interface WidgetSiteSourceRow {
  code: string;   // 'widget:<siteId>'
  name: string;
  color?: string;
  site_url?: string | null;
  site_id?: string;
}

interface BookingFormProps {
  mode: 'create' | 'edit';
  bookingId?: string;
  initial?: Partial<BookingFormValues>;
  currency?: string;
  unitTypes: UnitTypeRow[];
  allUnits: UnitRow[];
  bookingSources: BookingSourceRow[];
  /** Active booking_sites to show under the "Widgets" optgroup */
  widgetSources?: WidgetSiteSourceRow[];
  onSaved: (bookingId: string) => void;
  onCancel: () => void;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Чернетка' },
  { value: 'tentative', label: 'Очікується' },
  { value: 'confirmed', label: 'Підтверджено' },
  { value: 'checked_in', label: 'Заселено' },
  { value: 'checked_out', label: 'Виселено' },
  { value: 'cancelled', label: 'Скасовано' },
];

/**
 * «Частково» тут ВИДНО, але руками не ставиться.
 *
 * Це значення рахують гроші, а не оператор: `recalcReservationPaymentStatus`
 * ставить його, коли внесків більше нуля й менше за суму. Дати його в список
 * як звичайний пункт означало б другого писача одного поля — рівно та розбіжність,
 * через яку в Д17 не завели колонку «хто скасував».
 *
 * Але й прибрати не можна: `<select>` зі значенням, якого немає серед
 * пунктів, малюється ПОРОЖНІМ, і на броні з депозитом оператор бачив би
 * пусте поле, а один випадковий клік затирав би пораховане число словом.
 * Тому пункт є і вимкнений: своє значення показує, вибрати себе не дає.
 */
const PAYMENT_STATUS_OPTIONS: { value: string; label: string; derived?: boolean }[] = [
  { value: 'unpaid', label: 'Не оплачено' },
  { value: 'payment_requested', label: 'Запит на оплату' },
  { value: 'partial', label: 'Частково оплачено', derived: true },
  { value: 'prepaid', label: 'Передплата' },
  { value: 'paid', label: 'Оплачено' },
];

const CITY_TAX_PAID_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: '⏳ Очікує оплати' },
  { value: 'paid', label: '✅ Оплачено' },
  { value: 'exempt', label: '🚫 Звільнено' },
];


function emptyValues(): BookingFormValues {
  return {
    // Filled from the hotel's own categories once unit types load — a
    // hardcoded default here was one customer's vocabulary in every other
    // hotel's form, and their room types invisible behind it.
    category: '',
    unitTypeId: '',
    unitId: '',
    source: 'direct',
    checkIn: '',
    checkOut: '',
    adults: 2,
    children: 0,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    status: 'confirmed',
    paymentStatus: 'unpaid',
    totalPrice: '',
    commissionAmount: '',
    cityTaxAmount: '',
    cityTaxIncluded: false,
    cityTaxPaid: 'pending',
    internalNotes: '',
  };
}

function calcNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, Math.floor((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
}

function nightsLabel(n: number): string {
  if (n === 1) return 'ніч';
  if (n >= 2 && n <= 4) return 'ночі';
  return 'ночей';
}

export default function BookingForm({
  mode,
  bookingId,
  initial,
  currency: propCurrency,
  unitTypes,
  allUnits,
  bookingSources,
  widgetSources = [],
  onSaved,
  onCancel,
}: BookingFormProps) {
  const t = useT();
  const [form, setForm] = useState<BookingFormValues>(() => {
    const base = emptyValues();
    if (!initial) return base;
    return { ...base, ...initial };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Ціна з прайсингу, поки оператор ще заповнює форму.
  //
  // `priceTouched` — щойно оператор сам щось увів у «Вартість», автоматика
  // більше не втручається: його число і є домовленість із гостем.
  // `quoteSeq` — номер останнього запиту; відповідь із попереднього вибору
  // не має права перезаписати поле (клік по типу номера двічі поспіль дає
  // дві відповіді, і повільніша приходить другою).
  const priceTouched = useRef(mode === 'edit' || Boolean(initial?.totalPrice));
  const quoteSeq = useRef(0);
  const [quoteState, setQuoteState] = useState<{ loading: boolean; missingDays: number; failed: boolean }>(
    { loading: false, missingDays: 0, failed: false });

  // The property's OWN city tax per adult per night. The literal 25 that
  // used to sit here was the first customer's Kurtaxe in the first
  // customer's currency, prefilled into every hotel's bookings. 0 until the
  // property says otherwise — the operator can always type the amount.
  //
  // Ставка — ОБРАНОГО в шапці обʼєкта (область обʼєкта). `props[0]`, що
  // стояло тут, означало ставку ПЕРШОГО обʼєкта в кожній броні організації
  // з двома — мовчки, і курортний збір потрапляв у бронь чужого обʼєкта.
  // Обрано «Усі обʼєкти» — ставки немає: поле лишається порожнім, портьє
  // вводить суму сам, як і для готелю без збору. Нуль тут не помилка.
  const { property: scopedProperty } = usePropertyScope();
  const [cityTaxRate, setCityTaxRate] = useState(0);
  useEffect(() => {
    setCityTaxRate(Number(scopedProperty?.city_tax_per_night) || 0);
  }, [scopedProperty]);
  // The organization's currency, never a hardcoded one: 'CZK' here labelled
  // every hotel's money with the first customer's currency.
  const { organization } = useCurrentUser();
  const currency = propCurrency || organization?.currency || '';

  const getCommissionPct = useCallback((sourceCode: string) => {
    const src = bookingSources.find(s => s.code === sourceCode);
    return src?.commission_percent || 0;
  }, [bookingSources]);

  const recalcCommission = useCallback((price: string, sourceCode: string) => {
    const pct = getCommissionPct(sourceCode);
    // Комісія — це гроші: `percentOf`, а не округлення до цілого. 15 % від
    // 119 € — 17,85 €, а не 18 €, і саме це число їде у звірку з каналом.
    if (pct > 0 && Number(price) > 0) return String(percentOf(Number(price), pct));
    return '0';
  }, [getCommissionPct]);

  const recalcCityTax = useCallback((adults: number, checkIn: string, checkOut: string) => {
    const nights = calcNights(checkIn, checkOut);
    if (nights > 0 && adults > 0 && cityTaxRate > 0) return String(adults * nights * cityTaxRate);
    return '0';
  }, [cityTaxRate]);

  // The hotel's own categories, from its own unit types — label is the name
  // the operator gave the category, the type stays the behaviour key.
  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const ut of unitTypes) {
      if (!seen.has(ut.category_type)) seen.set(ut.category_type, ut.category_name || ut.category_type);
    }
    return [...seen.entries()].map(([type, label]) => ({ type, label }));
  }, [unitTypes]);

  // Pick the first real category once types load; never invent one.
  useEffect(() => {
    if (mode !== 'create') return;
    if (categoryOptions.length === 0) return;
    if (categoryOptions.some(c => c.type === form.category)) return;
    setForm(p => ({ ...p, category: categoryOptions[0].type, unitTypeId: '', unitId: '' }));
  }, [mode, categoryOptions, form.category]);

  const unitTypesForCategory = useMemo(
    () => unitTypes.filter(ut => ut.category_type === form.category),
    [unitTypes, form.category],
  );

  const unitsForType = useMemo(() => {
    if (!form.unitTypeId) return allUnits.filter(u => u.category_type === form.category);
    return allUnits.filter(u => u.unit_type_id === form.unitTypeId);
  }, [allUnits, form.unitTypeId, form.category]);

  useEffect(() => {
    if (mode !== 'create') return;
    if (form.unitTypeId) return;
    if (unitTypesForCategory.length === 0) return;
    setForm(p => ({ ...p, unitTypeId: unitTypesForCategory[0].id }));
  }, [mode, form.unitTypeId, unitTypesForCategory]);

  const nights = calcNights(form.checkIn, form.checkOut);

  const onCategoryChange = (category: string) => {
    const firstType = unitTypes.find(ut => ut.category_type === category);
    setForm(p => ({ ...p, category, unitTypeId: firstType?.id || '', unitId: '' }));
  };

  const onUnitTypeChange = (utId: string) => {
    setForm(p => ({ ...p, unitTypeId: utId, unitId: '' }));
  };

  const onSourceChange = (code: string) => {
    const src = bookingSources.find(s => s.code === code);
    setForm(p => ({
      ...p,
      source: code,
      commissionAmount: recalcCommission(p.totalPrice, code),
      cityTaxIncluded: src?.city_tax_included_default ? true : p.cityTaxIncluded,
    }));
  };

  const onDateOrAdultsChange = (next: Partial<BookingFormValues>) => {
    setForm(p => {
      const merged = { ...p, ...next };
      const previousAuto = recalcCityTax(p.adults, p.checkIn, p.checkOut);
      const cityTaxAmount = !p.cityTaxAmount || p.cityTaxAmount === previousAuto
        ? recalcCityTax(merged.adults, merged.checkIn, merged.checkOut)
        : p.cityTaxAmount;
      return { ...merged, cityTaxAmount };
    });
  };

  const onPriceChange = (price: string) => {
    // Оператор увів суму сам — з цієї миті прайсинг поле не чіпає.
    priceTouched.current = true;
    setQuoteState({ loading: false, missingDays: 0, failed: false });
    setForm(p => ({ ...p, totalPrice: price, commissionAmount: recalcCommission(price, p.source) }));
  };

  // Ціна номера підтягується, щойно відомі тип номера, дати й кількість
  // гостей — а не при збереженні.
  //
  // Помилка, яка тут була: єдиний виклик `/api/pricing/quote` жив усередині
  // `handleSubmit`. Портьє обирав кількість гостей і номер, поле «Вартість»
  // із підказкою «авто з прайсингу» лишалось порожнім, і вартість номера він
  // бачив аж у створеній броні. Прайсинг відповідав правильно — його ніхто
  // не питав.
  //
  // Ночі, яких не покриває жодне джерело, у поле НЕ підставляються (інваріант
  // 17): часткова сума виглядає як повна.
  useEffect(() => {
    // Лічильник збільшується ПЕРШИМ, до будь-якого виходу.
    //
    // Було навпаки: коли `shouldAskQuote` ставало false — портьє стер дату
    // виїзду, змінив тип номера, — ефект виходив, НЕ чіпаючи `quoteSeq`. Запит,
    // який на той момент летів за старі дати, повертався, бачив свій номер
    // актуальним і дописував ціну ТИХ дат у поле, що вже показує інші. Тобто
    // сторож існував і саме в цьому випадку не спрацьовував.
    //
    // Тепер кожен перерахунок умов знецінює відповідь, яка ще в дорозі, — і
    // тоді, коли новий запит іде, і тоді, коли він уже не потрібен.
    const seq = ++quoteSeq.current;

    if (!shouldAskQuote({
      mode, priceTouched: priceTouched.current,
      unitTypeId: form.unitTypeId, checkIn: form.checkIn, checkOut: form.checkOut,
    })) {
      // Умови більше не дають питати ціну — «рахуємо» знімається, інакше
      // кнопка збереження лишалась би заблокованою назавжди.
      setQuoteState((p) => (p.loading ? { ...p, loading: false } : p));
      return;
    }

    setQuoteState({ loading: true, missingDays: 0, failed: false });

    (async () => {
      let res: { ok: boolean; body?: QuoteResponse | null } = { ok: false };
      try {
        const r = await fetch('/api/pricing/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unitTypeId: form.unitTypeId,
            checkIn: form.checkIn,
            checkOut: form.checkOut,
            adults: form.adults,
            children: form.children,
          }),
        });
        res = { ok: r.ok, body: r.ok ? await r.json() : null };
      } catch { /* мережа: нижче це «не дізнались», а не «ціна нуль» */ }

      // Відповідь на застарілий вибір нікого не цікавить.
      if (seq !== quoteSeq.current) return;
      if (priceTouched.current) return;

      const outcome = readQuote(res);
      setQuoteState({ loading: false, missingDays: outcome.missingDays, failed: outcome.reason === 'failed' });
      setForm(p => ({
        ...p,
        totalPrice: outcome.price,
        commissionAmount: recalcCommission(outcome.price, p.source),
        // Турзбір, який приїхав рядком квоти, УЖЕ всередині суми вище.
        //
        // Без цих двох рядків він там і лишався б — мовчки, як частина
        // проживання: `postStayCharges` бере збір із `city_tax_amount`, а
        // порожнє поле означає «збору немає», тож на рахунку він поїхав би в
        // рядок проживання під його ставкою ПДВ. Готель, який завів турзбір
        // на екрані зборів, отримав би 7 % на гроші громади.
        //
        // Прапорець «включено» тут істина за визначенням: сума в полі
        // «Вартість» його вже містить. Сказати «не включено» означало б
        // порахувати збір двічі.
        ...(outcome.cityTax > 0
          ? { cityTaxAmount: String(outcome.cityTax), cityTaxIncluded: true }
          : {}),
      }));
    })();
  }, [mode, form.unitTypeId, form.checkIn, form.checkOut, form.adults, form.children, recalcCommission]);

  const validate = (): string => {
    if (!form.firstName.trim()) return "Ім'я обовʼязкове";
    if (!form.lastName.trim()) return 'Прізвище обовʼязкове';
    if (!form.checkIn || !form.checkOut) return 'Дати заїзду та виїзду обовʼязкові';
    if (nights <= 0) return 'Дата виїзду має бути після заїзду';
    if (mode === 'edit' && !form.unitId) return 'Юніт обовʼязковий';
    return '';
  };

  const resolveUnitId = (): string => {
    if (form.unitId) return form.unitId;
    return unitsForType[0]?.id || '';
  };

  /**
   * Остання спроба дізнатись ціну перед записом — на випадок, коли ефект вище
   * ще не встиг або тип номера з'ясувався лише з обраного юніта.
   *
   * `null` означає «ціни немає»: раніше тут повертався `0`, і бронь тихо
   * створювалась на нуль гривень/євро — гість отримував підтвердження на
   * вартість, якої готель ніколи не називав (інваріант 17).
   */
  const fetchQuoteIfNeeded = async (unitTypeId: string): Promise<number | null> => {
    if (Number(form.totalPrice) > 0) return Number(form.totalPrice);
    if (!unitTypeId) return null;
    let res: { ok: boolean; body?: QuoteResponse | null } = { ok: false };
    try {
      const r = await fetch('/api/pricing/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitTypeId,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          adults: form.adults,
          children: form.children,
        }),
      });
      res = { ok: r.ok, body: r.ok ? await r.json() : null };
    } catch { /* нижче це «не дізнались» */ }
    const outcome = readQuote(res);
    return outcome.reason === 'priced' ? Number(outcome.price) : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Поки квота летить, поле «Вартість» ще порожнє. Збереження в цю мить
    // створювало бронь за нуль — а через частку секунди прилітала правильна
    // ціна й дописувалась у поле форми, якої вже немає. Портьє бачив, як
    // число зʼявилось, і не мав підстав думати, що в базу пішло інше.
    if (quoteState.loading) {
      setError(t('Ціна ще рахується — секунду'));
      return;
    }
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setSaving(true);
    try {
      if (mode === 'create') {
        const unitId = resolveUnitId();
        if (!unitId) {
          setError(t('Немає доступних юнітів для цього типу'));
          setSaving(false);
          return;
        }
        const unitTypeForQuote = form.unitTypeId
          || allUnits.find(u => u.id === unitId)?.unit_type_id
          || '';
        const totalPrice = await fetchQuoteIfNeeded(unitTypeForQuote);
        if (totalPrice === null) {
          // Відмова, а не нуль: ночі без ціни готель не продає, а оператор
          // завжди може ввести суму в поле «Вартість» руками.
          setError(t('Немає ціни для такої кількості гостей або цих дат — введіть вартість вручну'));
          setSaving(false);
          return;
        }

        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            unitId,
            checkIn: form.checkIn,
            checkOut: form.checkOut,
            nights,
            adults: form.adults,
            children: form.children,
            status: form.status,
            paymentStatus: form.paymentStatus,
            source: form.source,
            totalPrice,
            commissionAmount: form.commissionAmount ? Number(form.commissionAmount) : undefined,
            cityTaxAmount: Number(form.cityTaxAmount) || 0,
            cityTaxIncluded: form.cityTaxIncluded,
            cityTaxPaid: form.cityTaxPaid,
            internalNotes: form.internalNotes.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Помилка створення');
          setSaving(false);
          return;
        }
        onSaved(data.id);
      } else {
        if (!bookingId) {
          setError(t('Відсутній ID бронювання для редагування'));
          setSaving(false);
          return;
        }
        const res = await fetch(`/api/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit_id: form.unitId,
            check_in: form.checkIn,
            check_out: form.checkOut,
            nights,
            adults: form.adults,
            children: form.children,
            status: form.status,
            payment_status: form.paymentStatus,
            source: form.source,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            total_price: form.totalPrice ? Number(form.totalPrice) : undefined,
            commission_amount: form.commissionAmount ? Number(form.commissionAmount) : 0,
            city_tax_amount: Number(form.cityTaxAmount) || 0,
            city_tax_included: form.cityTaxIncluded ? 1 : 0,
            city_tax_paid: form.cityTaxPaid,
            internal_notes: form.internalNotes.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Помилка збереження');
          setSaving(false);
          return;
        }
        onSaved(bookingId);
      }
    } catch {
      setError(t('Помилка мережі'));
      setSaving(false);
    }
  };

  const commissionPct = getCommissionPct(form.source);
  const netRate = Number(form.totalPrice) > 0 && Number(form.commissionAmount) > 0
    ? Number(form.totalPrice) - Number(form.commissionAmount)
    : 0;

  return (
    <form onSubmit={handleSubmit} className="booking-form">
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t('Категорія *')}</label>
          <select className="form-select" value={form.category} onChange={e => onCategoryChange(e.target.value)}>
            {categoryOptions.length === 0 && <option value="">—</option>}
            {categoryOptions.map(c => (
              <option key={c.type} value={c.type}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Тип розміщення *')}</label>
          <select className="form-select" value={form.unitTypeId} onChange={e => onUnitTypeChange(e.target.value)}>
            {unitTypesForCategory.length === 0 && <option value="">—</option>}
            {unitTypesForCategory.map(ut => (
              <option key={ut.id} value={ut.id}>{ut.name}{ut.unit_count ? ` (${ut.unit_count})` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t('Юніт')} {mode === 'edit' && '*'}</label>
          <select className="form-select" value={form.unitId} onChange={e => setForm(p => ({ ...p, unitId: e.target.value }))}>
            {mode === 'create' && <option value="">{t('Автоматично (перший вільний)')}</option>}
            {unitsForType.map(u => (
              <option key={u.id} value={u.id}>{u.code ? `${u.code} — ${u.name}` : u.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Джерело')}</label>
          <select className="form-select" value={form.source} onChange={e => onSourceChange(e.target.value)}>
            {bookingSources.length === 0 && widgetSources.length === 0 && (
              <option value="direct">Direct</option>
            )}
            {/* ── Standard channels ── */}
            {bookingSources.length > 0 && (
              <optgroup label={t('Канали')}>
                {bookingSources.map(s => (
                  <option key={s.code} value={s.code}>{t(s.name)}</option>
                ))}
              </optgroup>
            )}
            {/* ── Booking widget sites ── */}
            {widgetSources.length > 0 && (
              <optgroup label={t('🌐 Віджети бронювань')}>
                {widgetSources.map(s => (
                  <option key={s.code} value={s.code}>🌐 {t(s.name)}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t('Заїзд *')}</label>
          <input
            className="form-input"
            type="date"
            value={form.checkIn}
            onChange={e => onDateOrAdultsChange({ checkIn: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Виїзд *')} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{t('(ніч виїзду не входить)')}</span></label>
          <input
            className="form-input"
            type="date"
            value={form.checkOut}
            onChange={e => onDateOrAdultsChange({ checkOut: e.target.value })}
          />
        </div>
      </div>

      {nights > 0 && (
        <div style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 600, marginBottom: 12 }}>
          📅 {nights} {t(nightsLabel(nights))}
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{t('Дорослих')}</label>
          <input
            className="form-input"
            type="number"
            min={1}
            max={20}
            value={form.adults}
            onChange={e => onDateOrAdultsChange({ adults: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Дітей')}</label>
          <input
            className="form-input"
            type="number"
            min={0}
            max={20}
            value={form.children}
            onChange={e => setForm(p => ({ ...p, children: Number(e.target.value) || 0 }))}
          />
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 16, paddingTop: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('Дані гостя')}</h4>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Ім\'я *')}</label>
            <input className="form-input" value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} placeholder={t('Іван')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Прізвище *')}</label>
            <input className="form-input" value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} placeholder={t('Іваненко')} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Телефон')}</label>
            <input className="form-input" type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+…" />
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 16, paddingTop: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('💰 Фінанси')}</h4>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              {t('Вартість (')}{currency})
              {quoteState.loading && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>{t('рахуємо…')}</span>
              )}
            </label>
            <input
              className="form-input"
              type="number"
              min={0}
              placeholder={mode === 'create' ? t('авто з прайсингу') : '0'}
              value={form.totalPrice}
              onChange={e => onPriceChange(e.target.value)}
            />
            {/* Порожнє поле мусить пояснити себе. Мовчазна порожнеча — це і був
                баг: портьє не міг відрізнити «прайсинг ще думає» від «на ці
                дати ціни немає» і від «сталася помилка». */}
            {quoteState.missingDays > 0 && (
              <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
                {t('Прайсинг не покриває всі ночі — введіть вартість вручну')}
              </div>
            )}
            {quoteState.failed && (
              <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
                {t('Не вдалося дізнатись ціну — введіть вартість вручну')}
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('Комісія (')}{currency})
              {commissionPct > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>{t('авто:')} {commissionPct}%</span>
              )}
            </label>
            <input
              className="form-input"
              type="number"
              min={0}
              placeholder="0"
              value={form.commissionAmount}
              onChange={e => setForm(p => ({ ...p, commissionAmount: e.target.value }))}
            />
          </div>
        </div>
        {netRate > 0 && (
          <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 8 }}>
            {t('Чиста ставка:')} {netRate.toLocaleString()} {currency}
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('Статус')}</label>
            <select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Статус оплати')}</label>
            <select className="form-select" value={form.paymentStatus} onChange={e => setForm(p => ({ ...p, paymentStatus: e.target.value }))}>
              {/* Параметр зветься `ps`, а не `s`, і це не косметика.
                  Екстрактор рядків веде походження константи за ІМЕНЕМ
                  параметра, без урахування області видимості, тож два
                  `.map(s => …)` в одному файлі дають у каталог літерали лише
                  однієї константи. Тут таких сусідів двоє — `STATUS_OPTIONS`
                  нижче і `CITY_TAX_PAID_OPTIONS`, — і поки цей список теж
                  звався `s`, «Частково оплачено» не потрапляло в каталог
                  зовсім: німецький портьє бачив би українське слово при
                  заявлених 100 %. (Перша версія цього коментаря звинувачувала
                  `.filter` перед `.map` і умовний `null` усередині —
                  неправильно: екстрактор дивиться крізь них, винен виключно
                  збіг імені. Похідний пункт ховається атрибутом просто тому,
                  що так простіше читати.) */}
              {PAYMENT_STATUS_OPTIONS.map(ps => (
                <option key={ps.value} value={ps.value}
                  disabled={ps.derived}
                  hidden={ps.derived && form.paymentStatus !== ps.value}>
                  {t(ps.label)}{ps.derived ? ` — ${t('рахується з оплат')}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* A hotel without a city tax must not see the section at all; a booking
          that already carries an amount stays visible so it can be corrected. */}
      {(cityTaxRate > 0 || Number(form.cityTaxAmount) > 0) && (
      <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 16, paddingTop: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('🏛️ Туристичний збір')}</h4>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              {t('Сума збору (')}{currency})
              {form.checkIn && form.checkOut && form.adults > 0 && cityTaxRate > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                  {t('авто:')} {form.adults}×{nights}×{cityTaxRate}
                </span>
              )}
            </label>
            <input
              className="form-input"
              type="number"
              min={0}
              placeholder="0"
              value={form.cityTaxAmount}
              onChange={e => setForm(p => ({ ...p, cityTaxAmount: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Статус збору')}</label>
            <select className="form-select" value={form.cityTaxPaid} onChange={e => setForm(p => ({ ...p, cityTaxPaid: e.target.value }))}>
              {CITY_TAX_PAID_OPTIONS.map(s => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <input
            type="checkbox"
            id="bf-cityTaxIncluded"
            checked={form.cityTaxIncluded}
            onChange={e => setForm(p => ({ ...p, cityTaxIncluded: e.target.checked }))}
          />
          <label htmlFor="bf-cityTaxIncluded" style={{ fontSize: 13, cursor: 'pointer' }}>
            {t('Збір включено у вартість бронювання')}
          </label>
        </div>
      </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 16, paddingTop: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('📝 Примітки')}</h4>
        <textarea
          className="form-input"
          placeholder={t('Внутрішні примітки (бачить лише персонал)...')}
          value={form.internalNotes}
          onChange={e => setForm(p => ({ ...p, internalNotes: e.target.value }))}
          style={{ minHeight: 60, resize: 'vertical', width: '100%' }}
        />
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div className="booking-form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-primary)' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {t('Скасувати')}
        </button>
        {/*
          Кнопка гасне і поки летить квота: інакше вона виглядає готовою в ту
          саму мить, коли поле «Вартість» ще порожнє. Обробник це теж
          перевіряє — кнопка тільки показує стан, вона не сторож.
        */}
        <button type="submit" className="btn btn-primary" disabled={saving || quoteState.loading}>
          {saving
            ? <><Loader2 size={14} className="animate-pulse" /> {t('Збереження...')}</>
            : quoteState.loading
              ? <><Loader2 size={14} className="animate-pulse" /> {t('Ціна рахується...')}</>
            : mode === 'create'
              ? <><Plus size={14} /> {t('Створити бронювання')}</>
              : <><Save size={14} /> {t('Зберегти зміни')}</>
          }
        </button>
      </div>
    </form>
  );
}
