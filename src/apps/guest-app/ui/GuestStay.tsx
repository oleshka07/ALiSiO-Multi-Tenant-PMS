'use client';

/**
 * Гілка «немає бронювання»: дати → вільні номери З ЦІНАМИ → контакти → готово.
 *
 * ── Чому саме такий порядок ─────────────────────────────────────────────
 *
 * КІ24: ціна показується НА КРОЦІ ВИБОРУ, а не після. Гість обирає номер,
 * дивлячись на його ціну, — так само, як на власному сайті готелю. Порядок,
 * у якому спершу збирають контакти, а суму називають наприкінці, змушує
 * людину віддати телефон, щоб дізнатися, скільки коштує ніч.
 *
 * ── Картка — це ПАРА «номер × тариф» ────────────────────────────────────
 *
 * Один тип номера дає стільки карток, скільки в готелю видимих тарифів:
 * «невідмінна, дешевше» і «зі сніданком, відміна до 14:00» — це одна кімната
 * і дві різні угоди. Вибір між ними належить гостю; застосунок, який показує
 * одну ціну на тип, вибирає замість нього.
 *
 * ── Сума на екрані НЕ їде назад на сервер ───────────────────────────────
 *
 * У тілі бронювання її немає взагалі: там дати, тип, тариф і контакти, а
 * суму сервер рахує сам тим самим котируванням. Поле, яке приймають і
 * звіряють, рано чи пізно звіряють не з тим.
 */

import { useState } from 'react';
import { HOLD_MINUTES } from '../domain/hold';
import type { StayOffer } from '../domain/port';
import { GUEST_STRINGS, type GuestLang } from './translations';

type Stage = 'dates' | 'rooms' | 'extras' | 'details' | 'confirm' | 'claim';

/** Текст згоди, який ЦЕЙ готель справді написав (ніяких літералів у коді). */
interface ConsentOffer {
  kind: string;
  version: string;
  locale: string;
  body: string;
  /** Без неї кнопка не працює. Розсилка — ні: добровільна згода добровільна. */
  required: boolean;
}

/** Послуга, яку готель дозволив продавати онлайн (`bookable_online`, 0417). */
interface ServiceOffer {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  unitLabel: string;
  category: string;
}

interface Held {
  token: string;
  unitName: string;
  total: number;
  servicesTotal: number;
  currency: string;
  nights: number;
}

/** Завтра і післязавтра — найчастіший випадок біля дверей, але не мовчазний:
 *  обидві дати стоять у полях, і гість їх бачить, перш ніж шукати. */
function defaultDates(): { from: string; to: string } {
  const d = (shift: number) => {
    const t = new Date();
    t.setDate(t.getDate() + shift);
    return t.toISOString().slice(0, 10);
  };
  return { from: d(0), to: d(1) };
}

export function GuestStay({ appKey, lang, onBack }: {
  appKey: string;
  lang: GuestLang;
  onBack: () => void;
}) {
  const s = GUEST_STRINGS[lang];
  const start = defaultDates();

  const [stage, setStage] = useState<Stage>('dates');
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [adults, setAdults] = useState(2);
  const [offers, setOffers] = useState<StayOffer[]>([]);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentOffer[]>([]);
  const [services, setServices] = useState<ServiceOffer[]>([]);
  /** Скільки чого гість узяв. Немає ключа — не взяв; нуль тут не зберігається. */
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<StayOffer | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [held, setHeld] = useState<Held | null>(null);
  const [confirmationNo, setConfirmationNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Сума з валютою — і БЕЗ запасної валюти.
   *
   * `|| 'EUR'` тут був би тим самим, чим `|| 'CZK'` у решті продукту: гість
   * побачив би ціну в валюті, якої готель не називав, і запамʼятав саме її.
   * `calculateQuote` уже ухвалив це рішення за всіх — порожня організація
   * віддає порожню валюту, «краще показати ціну без валюти, ніж не ту». Тут
   * лишається його дотримати.
   */
  const price = (value: number, currency: string) => (currency
    ? new Intl.NumberFormat(lang, { style: 'currency', currency }).format(value)
    : new Intl.NumberFormat(lang, { minimumFractionDigits: 2 }).format(value));
  const nightsWord = (n: number) => (n === 1 ? s.nightsOne : s.nightsMany);
  /**
   * Сума послуг на екрані.
   *
   * Це ПОКАЗ, а не джерело: у тілі бронювання їде лише «що і скільки», а
   * суму рахує писач із довідника. Якщо ці два числа колись розійдуться,
   * правим буде довідник — і саме тому гість бачить суму ще до кнопки.
   */
  const extrasTotal = services.reduce((sum, x) => sum + x.price * (extras[x.id] ?? 0), 0);

  /** Кнопку тримають лише обовʼязкові роди — і рахує це екран, і звіряє сервер. */
  const allRequiredTicked = consents.every((c) => !c.required || ticked[c.kind]);

  /**
   * Речення про невдачу — ЗАВЖДИ зі свого словника, ніколи з відповіді.
   *
   * Текст відмови на сервері написаний мовою розробки, і показати його гостю
   * означає українське речення на екрані німецького портьє — рівно той
   * випадок, від якого стереже інваріант 19 і §3.2.1. Статус несе РІД
   * відмови, а рід ми вміємо сказати обома мовами застосунку.
   */
  function refusalText(status: number): string {
    if (status === 429) return s.tooMany;
    if (status === 409) return s.roomTaken;
    if (status === 400) return s.checkDetails;
    return s.bookingFailed;
  }

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/apps/guest/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: appKey, ...body }),
    });
    // Відповідь ЧИТАЄТЬСЯ, і саме вона вирішує, що показати. Екран, який
    // показує успіх, не подивившись у тіло, однаково радіє на 200 і на 400
    // (`check-unread-write-response`).
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }

  async function search() {
    setMessage(null);
    setBusy(true);
    try {
      const { ok, status, json } = await post('offers', { from, to, adults });
      if (!ok) { setMessage(refusalText(status)); return; }
      const list = (json.offers ?? []) as StayOffer[];
      const away = (json.handoff ?? null) as string | null;
      setOffers(list);
      setHandoff(away);
      setConsents((json.consents ?? []) as ConsentOffer[]);
      setServices((json.services ?? []) as ServiceOffer[]);
      // Порожньо — це стан, а не помилка: гість має бачити речення, а не
      // порожній екран, з якого не зрозуміло, чи воно шукало взагалі.
      if (list.length === 0 && !away) { setMessage(s.nothingFree); return; }
      setStage('rooms');
    } catch {
      setMessage(s.bookingFailed);
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!picked) return;
    setMessage(null);
    setBusy(true);
    try {
      const { ok, status, json } = await post('hold', {
        from, to, adults,
        unitTypeId: picked.unitTypeId,
        ratePlanId: picked.ratePlanId,
        firstName, lastName, phone, email: email || null, lang,
        services: Object.entries(extras)
          .filter(([, n]) => n > 0)
          .map(([serviceId, quantity]) => ({ serviceId, quantity })),
        // Їде ПАРА «рід + версія», не «так/ні»: галочка під старою редакцією
        // не є згодою на нову, і сервер має змогу це побачити.
        consents: consents
          .filter((c) => ticked[c.kind])
          .map((c) => ({ kind: c.kind, version: c.version })),
      });
      if (!ok) { setMessage(refusalText(status)); return; }
      setHeld({
        token: String(json.token), unitName: String(json.unitName ?? ''),
        total: Number(json.total), servicesTotal: Number(json.servicesTotal ?? 0),
        currency: String(json.currency ?? ''), nights: Number(json.nights),
      });
      setStage('confirm');
    } catch {
      setMessage(s.bookingFailed);
    } finally {
      setBusy(false);
    }
  }

  /**
   * «Я щойно забронював на сторінці готелю» (КІ8).
   *
   * Готель у фазі `external` продає в себе, і його бронь прийде до нас
   * дельтою за чверть години. Гість стоїть перед дверима зараз — тож ми
   * заводимо ПОПЕРЕДНЮ бронь із номером підтвердження як ключем, і гість
   * одразу йде заселятись. Дельта потім знайде її за тим самим ключем.
   */
  async function claim() {
    setMessage(null);
    setBusy(true);
    try {
      const { ok, status, json } = await post('claim', {
        confirmation: confirmationNo, firstName, lastName,
        checkIn: from, checkOut: to, adults,
      });
      if (!ok) {
        // Рід відмови приїжджає СЛОВОМ, і речення до нього добирає екран:
        // текст із сервера написаний мовою розробки (інваріант 19).
        const reason = String(json.error ?? '');
        setMessage(
          reason === 'need_confirmation' ? s.needConfirmation
            : reason === 'need_last_name' ? s.needLastName
              : reason === 'need_check_in' ? s.needCheckIn
                : reason === 'check_in_out_of_window' ? s.checkInOutOfWindow
                  : refusalText(status));
        return;
      }
      window.location.href = `/guest/${String(json.token)}`;
    } catch {
      setMessage(s.bookingFailed);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!held) return;
    setMessage(null);
    setBusy(true);
    try {
      const { ok, status, json } = await post('confirm', { token: held.token });
      if (!ok) { setMessage(refusalText(status)); return; }
      if (json.confirmed !== true) {
        // Строк минув — кімнату вже звільнено, і єдине чесне, що можна
        // запропонувати, це почати спочатку.
        setMessage(s.holdExpired);
        setHeld(null);
        setStage('dates');
        return;
      }
      // Далі — та сама гостьова сторінка, що й у гілки «є бронювання»:
      // реєстрація, документ, згоди, підпис. Другого заселення не заводиться.
      window.location.href = `/guest/${held.token}`;
    } catch {
      setMessage(s.bookingFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="guest-stay">
      {stage === 'dates' && (
        <form className="guest-form" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <label className="guest-field">
            <span className="guest-label">{s.arrival}</span>
            <input className="guest-input" type="date" value={from}
              onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.departure}</span>
            <input className="guest-input" type="date" value={to} min={from}
              onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.guests}</span>
            <input className="guest-input" type="number" inputMode="numeric" min={1} max={10}
              value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
          </label>
          {message && <p className="guest-note" role="status">{message}</p>}
          <button type="submit" className="guest-card" data-primary="true" disabled={busy}>
            <span className="guest-card-title">{busy ? s.searchingRooms : s.search}</span>
          </button>
          <button type="button" className="guest-quiet" onClick={onBack}>{s.back}</button>
        </form>
      )}

      {stage === 'rooms' && (
        <div className="guest-offers">
          {handoff && (
            <div className="guest-card" data-static="true">
              <span className="guest-card-title">{s.handoff}</span>
              {/*
                Чужа сторінка відкривається ОКРЕМО, не в рамці: вона віддає
                `X-Frame-Options: DENY`, тож рамка показала б порожнечу.
              */}
              <a className="guest-quiet" href={handoff} target="_blank" rel="noreferrer">{s.handoffOpen}</a>
            </div>
          )}
          {/*
            Повернувшись із чужої сторінки, гість каже, що забронював, — і
            заселяється. Кнопка стоїть ПОРУЧ із посиланням, а не після нього:
            він повертається в цю ж вкладку і має побачити наступний крок, а
            не шукати його.
          */}
          {handoff && (
            <button
              type="button"
              className="guest-card"
              data-primary="true"
              onClick={() => { setStage('claim'); setMessage(null); }}
            >
              <span className="guest-card-title">{s.justBooked}</span>
            </button>
          )}
          {offers.map((o) => (
            <button
              key={`${o.unitTypeId}:${o.ratePlanId ?? 'base'}`}
              type="button"
              className="guest-card"
              onClick={() => {
                setPicked(o);
                setMessage(null);
                // Готель, який нічого не продає онлайн, кроку послуг не має:
                // порожній екран «оберіть щось» — це крок, якого гість не
                // просив і на якому нема чого обрати.
                setStage(services.length > 0 ? 'extras' : 'details');
              }}
            >
              <span className="guest-card-title">{o.name}</span>
              {o.ratePlanName && <span className="guest-rate">{o.ratePlanName}</span>}
              <span className="guest-card-help">
                {price(o.perNight, o.currency)} {s.perNight} · {o.nights} {nightsWord(o.nights)}
              </span>
              {o.mealPlan && <span className="guest-rate-line">{s.breakfast}</span>}
              {/*
                Умови скасування — дослівно з довідника готелю. Переказ своїми
                словами тут був би обіцянкою, якої готель не давав.
              */}
              {o.cancellationPolicy && <span className="guest-rate-line">{o.cancellationPolicy}</span>}
              <span className="guest-total">{s.totalLabel}: {price(o.total, o.currency)}</span>
              <span className="guest-card-help">{o.free} {s.freeLeft}</span>
            </button>
          ))}
          <button type="button" className="guest-quiet" onClick={() => setStage('dates')}>{s.back}</button>
        </div>
      )}

      {stage === 'extras' && picked && (
        <div className="guest-offers">
          <p className="guest-lead">{s.extrasTitle}</p>
          <p className="guest-note">{s.extrasLead}</p>
          {/*
            Кожна позиція — ціна за ОДИНИЦЮ і текст одиниці той, що написав
            готель («за особу/добу»). Свій переказ тут означав би, що гість
            рахує за одним правилом, а рахунок виставлять за іншим.
          */}
          {services.map((x) => {
            const n = extras[x.id] ?? 0;
            return (
              <div key={x.id} className="guest-card" data-static="true">
                <span className="guest-card-title">{x.name}</span>
                {x.description && <span className="guest-card-help">{x.description}</span>}
                <span className="guest-rate">
                  {price(x.price, x.currency)} {x.unitLabel}
                </span>
                <span className="guest-qty">
                  <button type="button" className="guest-qty-btn" aria-label={s.remove}
                    disabled={n === 0}
                    onClick={() => setExtras((was) => ({ ...was, [x.id]: Math.max(0, n - 1) }))}>−</button>
                  <span className="guest-qty-n">{n}</span>
                  <button type="button" className="guest-qty-btn" aria-label={s.add}
                    disabled={n >= 20}
                    onClick={() => setExtras((was) => ({ ...was, [x.id]: n + 1 }))}>+</button>
                </span>
              </div>
            );
          })}
          <p className="guest-note">
            {s.roomLabel}: {price(picked.total, picked.currency)}
            {extrasTotal > 0 && <> · {s.extrasLabel}: {price(extrasTotal, picked.currency)}</>}
          </p>
          <p className="guest-total">
            {s.grandTotal}: {price(picked.total + extrasTotal, picked.currency)}
          </p>
          <button type="button" className="guest-card" data-primary="true"
            onClick={() => { setStage('details'); setMessage(null); }}>
            <span className="guest-card-title">{extrasTotal > 0 ? s.extrasNext : s.extrasSkip}</span>
          </button>
          <button type="button" className="guest-quiet" onClick={() => setStage('rooms')}>{s.back}</button>
        </div>
      )}

      {stage === 'details' && picked && (
        <form className="guest-form" onSubmit={(e) => { e.preventDefault(); void book(); }}>
          <p className="guest-lead">{s.yourDetails}</p>
          {/*
            Умови скасування повторюються ПОРУЧ ІЗ СУМОЮ, а не лишаються на
            картці, з якої гість уже пішов. Так само робить зразок власника:
            на екрані, де натискають кнопку, ще раз стоїть, за що саме платять
            і на яких умовах. Людина, яка дочитала до кнопки, не має гортати
            назад, щоб згадати, чи можна це скасувати.
          */}
          <p className="guest-note">
            {picked.name}{picked.ratePlanName ? ` · ${picked.ratePlanName}` : ''} ·{' '}
            {picked.nights} {nightsWord(picked.nights)} ·{' '}
            {s.totalLabel}: {price(picked.total, picked.currency)}
          </p>
          {picked.mealPlan && <p className="guest-note">{s.breakfast}</p>}
          {picked.cancellationPolicy && <p className="guest-note">{picked.cancellationPolicy}</p>}
          {extrasTotal > 0 && (
            <p className="guest-note">
              {s.extrasLabel}: {price(extrasTotal, picked.currency)} ·{' '}
              {s.grandTotal}: {price(picked.total + extrasTotal, picked.currency)}
            </p>
          )}
          <label className="guest-field">
            <span className="guest-label">{s.firstName}</span>
            <input className="guest-input" type="text" autoComplete="given-name"
              value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.lastName}</span>
            <input className="guest-input" type="text" autoComplete="family-name"
              value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.phone}</span>
            <input className="guest-input" type="tel" inputMode="tel" autoComplete="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.email}</span>
            <input className="guest-input" type="email" inputMode="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            <span className="guest-card-help">{s.emailHelp}</span>
          </label>
          <p className="guest-note">{s.payAtReception}</p>
          {/*
            Умови — те, що написав ГОТЕЛЬ, дослівно і своєю версією. Готель без
            заведених текстів галочок не показує, і бронювання від цього не
            спиняється: прийняти те, чого немає, не можна.
          */}
          {consents.map((c) => (
            <label key={c.kind} className="guest-consent">
              <input
                type="checkbox"
                checked={Boolean(ticked[c.kind])}
                onChange={(e) => setTicked((was) => ({ ...was, [c.kind]: e.target.checked }))}
              />
              <span className="guest-consent-text" lang={c.locale}>
                {c.body}{c.required ? ' *' : ''}
              </span>
            </label>
          ))}
          {message && <p className="guest-note" role="status">{message}</p>}
          <button type="submit" className="guest-card" data-primary="true"
            disabled={busy || !allRequiredTicked}>
            <span className="guest-card-title">{busy ? s.booking : s.bookNow}</span>
          </button>
          <button type="button" className="guest-quiet"
            onClick={() => setStage(services.length > 0 ? 'extras' : 'rooms')}>{s.back}</button>
        </form>
      )}

      {stage === 'claim' && (
        <form className="guest-form" onSubmit={(e) => { e.preventDefault(); void claim(); }}>
          <p className="guest-lead">{s.claimTitle}</p>
          <p className="guest-note">{s.claimLead}</p>
          <label className="guest-field">
            <span className="guest-label">{s.firstName}</span>
            <input className="guest-input" type="text" autoComplete="given-name"
              value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.lastName}</span>
            <input className="guest-input" type="text" autoComplete="family-name"
              value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.confirmationNo}</span>
            <input className="guest-input" type="text" inputMode="text"
              value={confirmationNo} onChange={(e) => setConfirmationNo(e.target.value)} />
            <span className="guest-card-help">{s.confirmationHelp}</span>
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.arrival}</span>
            <input className="guest-input" type="date" value={from}
              onChange={(e) => setFrom(e.target.value)} />
          </label>
          {message && <p className="guest-note" role="status">{message}</p>}
          <button type="submit" className="guest-card" data-primary="true" disabled={busy}>
            <span className="guest-card-title">{busy ? s.claiming : s.claimSubmit}</span>
          </button>
          <button type="button" className="guest-quiet" onClick={() => setStage('rooms')}>{s.back}</button>
        </form>
      )}

      {stage === 'confirm' && held && (
        <div className="guest-form">
          <p className="guest-lead">{s.confirmTitle}</p>
          <p className="guest-note">
            {held.unitName} · {held.nights} {nightsWord(held.nights)} ·{' '}
            {s.roomLabel}: {price(held.total, held.currency)}
          </p>
          {/*
            Сума послуг ОКРЕМИМ числом, бо в базі вона теж окрема: послуги
            живуть рядками замовлень і потрапляють у рахунок власним шляхом.
            Одне злите число на екрані обіцяло б гостю рівно те, чого в
            рахунку не буде.
          */}
          {held.servicesTotal > 0 && (
            <p className="guest-note">
              {s.extrasLabel}: {price(held.servicesTotal, held.currency)} ·{' '}
              {s.grandTotal}: {price(held.total + held.servicesTotal, held.currency)}
            </p>
          )}
          <p className="guest-note">{s.confirmLead}</p>
          {/*
            Де і коли платять — НА ОСТАННЬОМУ екрані теж, не лише на кроці
            вибору номера. Гість, який дійшов сюди, вирішує «підтверджувати чи
            ні», і саме тут питання «а гроші?» стоїть найгостріше. Рядком
            нижче він піде на гостьову сторінку, де побачить суму до сплати, —
            і без цього речення вона читалася б як вимогу заплатити зараз.
          */}
          <p className="guest-note">{s.payAtReception}</p>
          {/* Число береться з коду, а не з тексту: строк і речення про строк
              не мають розходитись. */}
          <p className="guest-note">{s.heldFor.replace('{minutes}', String(HOLD_MINUTES))}</p>
          {message && <p className="guest-note" role="status">{message}</p>}
          <button type="button" className="guest-card" data-primary="true" disabled={busy}
            onClick={() => { void confirm(); }}>
            <span className="guest-card-title">{busy ? s.confirming : s.confirm}</span>
          </button>
        </div>
      )}
    </div>
  );
}
