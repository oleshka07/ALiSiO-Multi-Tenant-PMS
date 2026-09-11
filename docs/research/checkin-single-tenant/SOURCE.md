# Самостійний чек-ін: вихідний код односерверної PMS, дослівно

Витяг з `oleshka07/ALiSiO-Hotel-PMS` (односерверна PMS першого клієнта,
жива сторінка — `/checkin`). Скопійовано **як є**, без правок: це матеріал
дослідження, а не код продукту. Що з цим робити й що саме треба змінити —
`README.md` поруч.

**Цей файл не імпортується і не збирається.** Він містить літерали одного
клієнта (назва, номер WhatsApp, ідентифікатор сайту, `'CZK'`, `'camping'`) —
саме те, що в мультитенанті заборонено інваріантами 20 і 22. Вони лишені
навмисно: видалити їх зі зразка означало б сховати те, що при переносі треба
знайти й замінити. Кожне таке місце назване в `README.md`, розділ «Що НЕ
переноситься».

Гейт `check-no-tenant-names` цей файл не бачить: він обходить `src`,
`scripts` і `db`, розширення `.ts/.tsx/.mjs/.json/.sql`. `docs/**/*.md` —
поза обходом. Перевірено прогоном, не припущенням.

---

## `src/app/checkin/page.tsx`

_340 рядків, повністю. Вся вирва: мова → розвилка → пошук броні / вибір спорядження → контакти → готово._

````tsx
'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Self check-in at the gate.
 *
 * The website's booking wizard is for someone planning a trip: it opens on a
 * choice of accommodation and a calendar reaching eleven months out. Whoever
 * scans the QR on the door is not planning anything — they have arrived, it may
 * be dark, and they want a spot, a price and a way in.
 *
 * So the flow is the same engine and the same stylesheet as /book, with the
 * planning removed: dates default to tonight, there is no browsing, and the
 * pitch is chosen by the system. Every screen is one decision.
 */
import { useState, useEffect, useMemo } from 'react';
import { loadPriceList, calcCampingBreakdown, getRate, formatPrice, getNightDates, type PriceItem, type CampingItemCode } from '../book/lib/pricing';
import { LANGS, ITEM_NAMES, T, type Lang } from './locales';

const WHATSAPP = 'https://wa.me/420723565616';
const ORDER: CampingItemCode[] = ['small_tent', 'large_tent', 'car', 'minibus', 'caravan', 'motorhome', 'motorcycle'];
const ICONS: Record<string, string> = {
  small_tent: '⛺', large_tent: '🏕️', car: '🚗', minibus: '🚐',
  caravan: '🚙', motorhome: '🚌', motorcycle: '🏍️',
};

type Screen = 'lang' | 'fork' | 'find' | 'camping' | 'contact' | 'done';

// Local date parts, not toISOString(). The two disagree everywhere east of
// Greenwich, and addDays mixed them: `new Date('2026-08-26T00:00:00')` parses as
// LOCAL midnight, which in Prague is 22:00 UTC the day before, so +1 day landed
// back on 2026-08-26 and toISOString() handed the same date straight back.
// The guest saw «0 ночей — 0 Kč» and the + button could not get them off it,
// because every press returned the date it started from. A test browser running
// in UTC never sees it.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };

export default function CheckinPage() {
  const [lang, setLang] = useState<Lang>('cs');
  const [screen, setScreen] = useState<Screen>('lang');
  const t = T[lang];

  const [prices, setPrices] = useState<PriceItem[] | null>(null);
  useEffect(() => { loadPriceList().then((p) => setPrices(p || [])).catch(() => setPrices([])); }, []);
  const rates = prices || [];
  const pricesReady = prices !== null && prices.length > 0;

  // ── Find an existing booking ──────────────────────────────────────────────
  const [findPhone, setFindPhone] = useState('');
  const [findSurname, setFindSurname] = useState('');
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  async function doFind() {
    setFinding(true); setFindError(null);
    try {
      const res = await fetch('/api/public/checkin/find', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: findPhone, surname: findSurname }),
      });
      const data = await res.json();
      if (res.status === 429) { setFindError(t.throttled); return; }
      if (data.found && data.token) { window.location.href = `/guest/${data.token}`; return; }
      setFindError(data.found ? t.noPage : t.notFoundSub);
    } catch {
      setFindError(t.notFoundSub);
    } finally { setFinding(false); }
  }

  // ── Camping selection ─────────────────────────────────────────────────────
  const today = useMemo(() => iso(new Date()), []);
  const [checkOut, setCheckOut] = useState(() => addDays(iso(new Date()), 1));
  const [qty, setQty] = useState<Partial<Record<CampingItemCode, number>>>({});
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [electricity, setElectricity] = useState(false);
  const [pets, setPets] = useState(0);
  const [mhService, setMhService] = useState(false);

  const selectedItems = useMemo(() => {
    const arr: CampingItemCode[] = [];
    for (const code of Object.keys(qty) as CampingItemCode[]) {
      for (let i = 0; i < (qty[code] || 0); i++) arr.push(code);
    }
    return arr;
  }, [qty]);

  const nights = getNightDates(today, checkOut).length;
  const pricing = useMemo(
    () => (selectedItems.length ? calcCampingBreakdown(selectedItems, adults, children, electricity, pets, mhService, today, checkOut, rates) : null),
    [selectedItems, adults, children, electricity, pets, mhService, today, checkOut, rates],
  );

  const bump = (code: CampingItemCode, d: number) => setQty((p) => {
    const next = Math.max(0, (p[code] ?? 0) + d);
    if (next === 0 && code === 'motorhome') setMhService(false);
    return { ...p, [code]: next };
  });

  // ── Contact + create ──────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string | null; unit: string | null; total: number } | null>(null);

  async function createBooking() {
    if (!name.trim() || !phone.trim()) { setSaveError(t.nameRequired); return; }
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch('/api/booking/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accommodation_type: 'camping',
          accommodation_data: {
            selectedItems, adults, children, electricity, pets,
            motorhomeService: mhService, checkIn: today, checkOut,
          },
          check_in: today, check_out: checkOut,
          extras: [],
          guest_name: name.trim(), guest_phone: phone.trim(), guest_email: '',
          total_price: pricing?.total ?? 0, deposit_amount: 0,
          // Marks the booking as made at the gate, not on the website — the
          // operations list needs to tell "walk-in, unpaid, standing here" from
          // "someone on the internet who may never come".
          source: 'checkin:qr',
          site_id: 'kemp-carlsbad',
          payment_method: 'reception',
          booked_at: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || 'Error'); return; }
      setResult({ token: data.guest_page_token || null, unit: data.unit_code || data.unit || null, total: pricing?.total ?? 0 });
      setScreen('done');
    } catch (e: any) {
      setSaveError(e?.message || 'Error');
    } finally { setSaving(false); }
  }

  // ── Screens ───────────────────────────────────────────────────────────────
  const wrap = (children: any) => (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px 40px' }}>{children}</div>
  );

  if (screen === 'lang') return wrap(<>
    <h1 className="kc-title" style={{ textAlign: 'center' }}>Kemp Carlsbad</h1>
    <p className="kc-subtitle" style={{ textAlign: 'center' }}>Choose your language</p>
    {LANGS.map((l) => (
      <button key={l.code} className="kc-btn kc-btn-secondary" style={{ marginBottom: 10, fontSize: 18 }}
        onClick={() => { setLang(l.code); setScreen('fork'); }} type="button">
        <span style={{ fontSize: 24 }}>{l.flag}</span> {l.name}
      </button>
    ))}
  </>);

  if (screen === 'fork') return wrap(<>
    <h1 className="kc-title">Kemp Carlsbad</h1>
    <div className="kc-card kc-card-clickable" style={{ padding: 20, marginBottom: 12 }}
      onClick={() => setScreen('find')}>
      <div className="kc-card-name">{t.haveBooking}</div>
      <div className="kc-card-desc" style={{ marginBottom: 0 }}>{t.haveBookingSub}</div>
    </div>
    <div className="kc-card kc-card-clickable" style={{ padding: 20, marginBottom: 20 }}
      onClick={() => setScreen('camping')}>
      <div className="kc-card-name">{t.noBooking}</div>
      <div className="kc-card-desc" style={{ marginBottom: 0 }}>{t.noBookingSub}</div>
    </div>
    <a className="kc-btn kc-btn-ghost" href={WHATSAPP} target="_blank" rel="noreferrer">{t.contactAdmin}</a>
  </>);

  if (screen === 'find') return wrap(<>
    <button className="kc-btn kc-btn-ghost" style={{ width: 'auto', minHeight: 32, padding: 0, marginBottom: 8 }}
      onClick={() => setScreen('fork')} type="button">{t.back}</button>
    <h1 className="kc-title">{t.findTitle}</h1>
    <p className="kc-subtitle">{t.findSub}</p>
    <div className="kc-card" style={{ padding: 16 }}>
      <label className="kc-form-row-label">{t.phone}</label>
      <input className="kc-input" inputMode="tel" value={findPhone} onChange={(e) => setFindPhone(e.target.value)}
        placeholder="+420 777 123 456" style={{ width: '100%', marginBottom: 12 }} />
      <label className="kc-form-row-label">{t.surname}</label>
      <input className="kc-input" value={findSurname} onChange={(e) => setFindSurname(e.target.value)}
        style={{ width: '100%' }} />
    </div>
    {findError && <div className="kc-alert" style={{ marginTop: 12 }}>
      <span className="kc-alert-icon">⚠️</span><div><b>{t.notFound}</b><div style={{ fontSize: 13 }}>{findError}</div></div>
    </div>}
    <button className="kc-btn kc-btn-primary" style={{ marginTop: 16 }} disabled={finding}
      onClick={doFind} type="button">{finding ? t.searching : t.find}</button>
    <button className="kc-btn kc-btn-secondary" style={{ marginTop: 8 }}
      onClick={() => setScreen('camping')} type="button">{t.noBooking}</button>
    <a className="kc-btn kc-btn-ghost" href={WHATSAPP} target="_blank" rel="noreferrer">{t.contactAdmin}</a>
  </>);

  if (screen === 'camping') return wrap(<>
    <button className="kc-btn kc-btn-ghost" style={{ width: 'auto', minHeight: 32, padding: 0, marginBottom: 8 }}
      onClick={() => setScreen('fork')} type="button">{t.back}</button>
    <h1 className="kc-title">{t.campTitle}</h1>
    <p className="kc-subtitle">{t.campSub}</p>

    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.yourSetup}</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
      {ORDER.map((code) => {
        const n = qty[code] ?? 0;
        const rate = getRate(rates, code)?.rate_standard ?? 0;
        return (
          <div key={code} className={`kc-svc-card ${n > 0 ? 'added' : ''}`}
            style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12px 8px', gap: 4 }}>
            <div style={{ fontSize: 28 }}>{ICONS[code]}</div>
            <div className="kc-svc-name" style={{ fontSize: 13 }}>{ITEM_NAMES[code][lang]}</div>
            <div className="kc-svc-price" style={{ fontSize: 11 }}>
              {pricesReady ? `${formatPrice(rate)} ${t.perNight}` : '…'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button className="kc-stepper-btn" onClick={() => bump(code, -1)} disabled={n === 0} type="button">−</button>
              <span className="kc-stepper-val" style={{ minWidth: 20 }}>{n}</span>
              <button className="kc-stepper-btn" onClick={() => bump(code, 1)} type="button">+</button>
            </div>
          </div>
        );
      })}
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.guests}</div>
    <div className="kc-form-row">
      <div className="kc-form-row-label">{t.adults}</div>
      <div className="kc-stepper">
        <button className="kc-stepper-btn" onClick={() => setAdults(Math.max(1, adults - 1))} disabled={adults <= 1} type="button">−</button>
        <span className="kc-stepper-val">{adults}</span>
        <button className="kc-stepper-btn" onClick={() => setAdults(adults + 1)} type="button">+</button>
      </div>
    </div>
    <div className="kc-form-row">
      <div><div className="kc-form-row-label">{t.children}</div><div className="kc-form-row-sub">{t.childrenFree}</div></div>
      <div className="kc-stepper">
        <button className="kc-stepper-btn" onClick={() => setChildren(Math.max(0, children - 1))} disabled={children <= 0} type="button">−</button>
        <span className="kc-stepper-val">{children}</span>
        <button className="kc-stepper-btn" onClick={() => setChildren(children + 1)} type="button">+</button>
      </div>
    </div>

    <div style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 8px' }}>{t.extras}</div>
    <div className="kc-form-row">
      <div><div className="kc-form-row-label">{t.electricity}</div>
        <div className="kc-form-row-sub">+{formatPrice(getRate(rates, 'electricity')?.rate_standard ?? 120)} {t.perNight}</div></div>
      <button className={`kc-toggle ${electricity ? 'on' : ''}`} onClick={() => setElectricity(!electricity)} type="button" />
    </div>
    <div className="kc-form-row">
      <div><div className="kc-form-row-label">{t.pets}</div>
        <div className="kc-form-row-sub">+{formatPrice(getRate(rates, 'pet')?.rate_standard ?? 50)} {t.perAnimalNight}</div></div>
      <div className="kc-stepper">
        <button className="kc-stepper-btn" onClick={() => setPets(Math.max(0, pets - 1))} disabled={pets <= 0} type="button">−</button>
        <span className="kc-stepper-val">{pets}</span>
        <button className="kc-stepper-btn" onClick={() => setPets(pets + 1)} type="button">+</button>
      </div>
    </div>
    {selectedItems.includes('motorhome') && (
      <div className="kc-form-row">
        <div><div className="kc-form-row-label">{t.motorhomeService}</div>
          <div className="kc-form-row-sub">+{formatPrice(getRate(rates, 'motorhome_service')?.rate_standard ?? 100)} Kč ({t.once})</div></div>
        <button className={`kc-toggle ${mhService ? 'on' : ''}`} onClick={() => setMhService(!mhService)} type="button" />
      </div>
    )}

    {/* No eleven-month calendar: they are here tonight. One button adds a night. */}
    <div className="kc-form-row" style={{ marginTop: 16 }}>
      <div><div className="kc-form-row-label">{nights} {nights === 1 ? t.night : t.nights}</div>
        <div className="kc-form-row-sub">{t.leavingOn}: {checkOut}</div></div>
      <div className="kc-stepper">
        <button className="kc-stepper-btn" onClick={() => setCheckOut(addDays(checkOut, -1))} disabled={nights <= 1} type="button">−</button>
        <span className="kc-stepper-val">{nights}</span>
        <button className="kc-stepper-btn" onClick={() => setCheckOut(addDays(checkOut, 1))} type="button">+</button>
      </div>
    </div>

    {pricing && (
      <div className="kc-breakdown">
        {/* Itemised, because the guest pays this in cash at a desk in a minute
            and "375" on its own invites an argument. Every line is one entry of
            the same rate card the total is summed from. */}
        {pricing.lines.map((l) => (
          <div className="kc-breakdown-row" key={l.code}>
            <span>{ITEM_NAMES[l.code]?.[lang] ?? l.code}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
            <span>{formatPrice(l.total)} Kč</span>
          </div>
        ))}
        <div className="kc-breakdown-total"><span>{t.total}</span><span>{formatPrice(pricing.total)} Kč</span></div>
        <div className="kc-breakdown-remaining"><span>{t.priceIncl}</span></div>
      </div>
    )}

    <button className="kc-btn kc-btn-primary" disabled={!selectedItems.length || !pricesReady || nights < 1}
      onClick={() => setScreen('contact')} type="button">
      {selectedItems.length ? t.finish : t.pickSomething}
    </button>
  </>);

  if (screen === 'contact') return wrap(<>
    <button className="kc-btn kc-btn-ghost" style={{ width: 'auto', minHeight: 32, padding: 0, marginBottom: 8 }}
      onClick={() => setScreen('camping')} type="button">{t.back}</button>
    <h1 className="kc-title">{t.payAtReception}</h1>
    <p className="kc-subtitle">{t.payAtReceptionSub}</p>
    <div className="kc-card" style={{ padding: 16 }}>
      <label className="kc-form-row-label">{t.yourName}</label>
      <input className="kc-input" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
      <label className="kc-form-row-label">{t.yourPhone}</label>
      <input className="kc-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%' }} />
    </div>
    {pricing && (
      <div className="kc-breakdown">
        <div className="kc-breakdown-total"><span>{t.total}</span><span>{formatPrice(pricing.total)} Kč</span></div>
      </div>
    )}
    {saveError && <div className="kc-alert" style={{ marginTop: 12 }}><span className="kc-alert-icon">⚠️</span><div>{saveError}</div></div>}
    <button className="kc-btn kc-btn-primary" disabled={saving} onClick={createBooking} type="button">
      {saving ? t.working : t.finish}
    </button>
  </>);

  return wrap(<>
    <div style={{ textAlign: 'center', fontSize: 56, marginBottom: 8 }}>✅</div>
    <h1 className="kc-title" style={{ textAlign: 'center' }}>{t.doneTitle}</h1>
    <p className="kc-subtitle" style={{ textAlign: 'center' }}>{t.doneSub}</p>
    {result?.unit && (
      <div className="kc-card" style={{ padding: 20, textAlign: 'center' }}>
        <div className="kc-form-row-sub">{t.yourSpot}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--kc-green)' }}>{result.unit}</div>
      </div>
    )}
    {!!result?.total && (
      <div className="kc-breakdown">
        <div className="kc-breakdown-total"><span>{t.toPay}</span><span>{formatPrice(result.total)} Kč</span></div>
      </div>
    )}
    {result?.token
      ? <a className="kc-btn kc-btn-primary" href={`/guest/${result.token}`}>{t.openGuestPage}</a>
      : <a className="kc-btn kc-btn-secondary" href={WHATSAPP} target="_blank" rel="noreferrer">{t.contactAdmin}</a>}
  </>);
}
````

## `src/app/checkin/locales.ts`

_172 рядків, повністю. Словник вирви, чотири мови, окремо від каталогу застосунку._

````ts
/**
 * Self check-in — four languages, one screen's worth of words each.
 *
 * Deliberately its own file rather than a reach into the website's `booking_b`
 * bundle: that lives in another repository and another deployment, and a guest
 * standing at the gate should not depend on the marketing site being up. The
 * item names below are the same ones the price-list popup already carries.
 */
export type Lang = 'cs' | 'en' | 'de' | 'uk';

export const LANGS: { code: Lang; flag: string; name: string }[] = [
  { code: 'cs', flag: '🇨🇿', name: 'Čeština' },
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська' },
];

export const ITEM_NAMES: Record<string, Record<Lang, string>> = {
  small_tent: { cs: 'Malý stan', en: 'Small tent', de: 'Kleines Zelt', uk: 'Малий намет' },
  large_tent: { cs: 'Velký stan', en: 'Large tent', de: 'Großes Zelt', uk: 'Великий намет' },
  car: { cs: 'Auto', en: 'Car', de: 'Auto', uk: 'Авто' },
  minibus: { cs: 'Minibus / Dodávka', en: 'Minibus / Van', de: 'Kleinbus', uk: 'Мінівен' },
  caravan: { cs: 'Karavan', en: 'Caravan', de: 'Wohnwagen', uk: 'Караван' },
  motorhome: { cs: 'Obytné auto', en: 'Motorhome', de: 'Wohnmobil', uk: 'Автодім' },
  motorcycle: { cs: 'Motocykl', en: 'Motorcycle', de: 'Motorrad', uk: 'Мотоцикл' },
  // The receipt itemises people and extras too, not just equipment.
  adult_person: { cs: 'Dospělý', en: 'Adult', de: 'Erwachsener', uk: 'Дорослий' },
  child_person: { cs: 'Dítě (3-15)', en: 'Child (3-15)', de: 'Kind (3-15)', uk: 'Дитина (3-15)' },
  electricity: { cs: 'Přípojka elektřiny', en: 'Electricity', de: 'Stromanschluss', uk: 'Електрика' },
  pet: { cs: 'Zvíře', en: 'Pet', de: 'Haustier', uk: 'Тварина' },
  tourist_tax: { cs: 'Turistický poplatek', en: 'Tourist tax', de: 'Kurtaxe', uk: 'Курортний збір' },
  motorhome_service: { cs: 'Servis kazety', en: 'Cassette service', de: 'Kassettenservice', uk: 'Сервіс касети' },
};

interface Dict {
  pickLang: string;
  haveBooking: string; haveBookingSub: string;
  noBooking: string; noBookingSub: string;
  contactAdmin: string;
  findTitle: string; findSub: string;
  phone: string; surname: string; find: string; searching: string;
  notFound: string; notFoundSub: string; throttled: string; noPage: string;
  campTitle: string; campSub: string; yourSetup: string;
  guests: string; adults: string; children: string; childrenFree: string;
  extras: string; electricity: string; pets: string;
  motorhomeService: string; once: string;
  perNight: string; perAnimalNight: string;
  nights: string; night: string; oneMoreNight: string; leavingOn: string;
  total: string; touristTax: string; priceIncl: string;
  yourName: string; yourPhone: string;
  payAtReception: string; payAtReceptionSub: string;
  finish: string; working: string;
  doneTitle: string; doneSub: string; yourSpot: string; openGuestPage: string;
  pickSomething: string; nameRequired: string;
  back: string;
  toPay: string;
}

export const T: Record<Lang, Dict> = {
  cs: {
    pickLang: 'Vyberte jazyk',
    haveBooking: '🔑 Mám rezervaci', haveBookingSub: 'Najdeme ji a dáme vám pokyny k příjezdu.',
    noBooking: '⛺ Nemám rezervaci', noBookingSub: 'Vyberte si místo — ubytujeme vás hned teď.',
    contactAdmin: '💬 Kontaktovat správce',
    findTitle: 'Najít rezervaci', findSub: 'Zadejte telefon a příjmení, jak jste je uvedli při rezervaci.',
    phone: 'Telefon', surname: 'Příjmení', find: 'Najít', searching: 'Hledám…',
    notFound: 'Rezervaci jsme nenašli',
    notFoundSub: 'Zkontrolujte číslo a příjmení. Hledáme jen příjezdy na dnešek a zítřek.',
    throttled: 'Příliš mnoho pokusů. Zkuste to za 15 minut nebo napište správci.',
    noPage: 'Rezervaci jsme našli, ale nemá stránku hosta. Napište prosím správci.',
    campTitle: 'Kemping', campSub: 'Vyberte vše, co přivážíte', yourSetup: 'Vaše vybavení',
    guests: 'Hosté', adults: 'Dospělí', children: 'Děti (3-15)', childrenFree: 'Do 3 let — zdarma',
    extras: 'Doplňky', electricity: 'Přípojka elektřiny', pets: 'Zvířata',
    motorhomeService: 'Servis obytného auta', once: 'jednorázově',
    perNight: 'Kč / noc', perAnimalNight: 'Kč / zvíře / noc',
    nights: 'nocí', night: 'noc', oneMoreNight: '+ další noc', leavingOn: 'Odjezd',
    total: 'Celkem', touristTax: 'Turistický poplatek', priceIncl: 'Cena včetně poplatku',
    yourName: 'Jméno a příjmení', yourPhone: 'Telefon',
    payAtReception: 'Rezervovat a zaplatit na recepci',
    payAtReceptionSub: 'Hotově nebo kartou. Místo je pro vás rezervováno.',
    finish: 'Dokončit', working: 'Pracuji…',
    doneTitle: 'Hotovo!', doneSub: 'Vaše místo je zarezervováno.',
    yourSpot: 'Vaše místo', openGuestPage: 'Otevřít pokyny k příjezdu →',
    pickSomething: 'Vyberte alespoň jednu položku.', nameRequired: 'Zadejte jméno a telefon.',
    back: '‹ Zpět',
    toPay: 'K úhradě na recepci',
  },
  en: {
    pickLang: 'Choose your language',
    haveBooking: '🔑 I have a booking', haveBookingSub: "We'll find it and give you arrival instructions.",
    noBooking: '⛺ I have no booking', noBookingSub: 'Pick a spot — we can check you in right now.',
    contactAdmin: '💬 Contact the manager',
    findTitle: 'Find your booking', findSub: 'Enter the phone number and surname you booked with.',
    phone: 'Phone', surname: 'Surname', find: 'Find', searching: 'Searching…',
    notFound: "We couldn't find that booking",
    notFoundSub: 'Check the number and surname. We only search arrivals for today and tomorrow.',
    throttled: 'Too many attempts. Try again in 15 minutes or message the manager.',
    noPage: 'We found the booking but it has no guest page. Please message the manager.',
    campTitle: 'Camping', campSub: "Select everything you're bringing", yourSetup: 'Your setup',
    guests: 'Guests', adults: 'Adults', children: 'Children (3-15)', childrenFree: 'Under 3 — free',
    extras: 'Extras', electricity: 'Electricity hookup', pets: 'Pets',
    motorhomeService: 'Motorhome service', once: 'once',
    perNight: 'Kč / night', perAnimalNight: 'Kč / animal / night',
    nights: 'nights', night: 'night', oneMoreNight: '+ one more night', leavingOn: 'Leaving',
    total: 'Total', touristTax: 'Tourist tax', priceIncl: 'Price includes the tourist tax',
    yourName: 'Full name', yourPhone: 'Phone',
    payAtReception: 'Book and pay at reception',
    payAtReceptionSub: 'Cash or card. Your spot is held for you.',
    finish: 'Finish', working: 'Working…',
    doneTitle: 'All set!', doneSub: 'Your spot is booked.',
    yourSpot: 'Your spot', openGuestPage: 'Open arrival instructions →',
    pickSomething: 'Select at least one item.', nameRequired: 'Enter your name and phone.',
    back: '‹ Back',
    toPay: 'To pay at reception',
  },
  de: {
    pickLang: 'Sprache wählen',
    haveBooking: '🔑 Ich habe eine Buchung', haveBookingSub: 'Wir finden sie und geben Ihnen die Anfahrt.',
    noBooking: '⛺ Ich habe keine Buchung', noBookingSub: 'Platz wählen — wir checken Sie sofort ein.',
    contactAdmin: '💬 Verwalter kontaktieren',
    findTitle: 'Buchung finden', findSub: 'Telefonnummer und Nachname wie bei der Buchung.',
    phone: 'Telefon', surname: 'Nachname', find: 'Suchen', searching: 'Suche…',
    notFound: 'Buchung nicht gefunden',
    notFoundSub: 'Prüfen Sie Nummer und Nachname. Wir suchen nur Anreisen heute und morgen.',
    throttled: 'Zu viele Versuche. In 15 Minuten erneut oder den Verwalter anschreiben.',
    noPage: 'Buchung gefunden, aber ohne Gästeseite. Bitte den Verwalter anschreiben.',
    campTitle: 'Camping', campSub: 'Wählen Sie alles, was Sie mitbringen', yourSetup: 'Ihre Ausrüstung',
    guests: 'Gäste', adults: 'Erwachsene', children: 'Kinder (3-15)', childrenFree: 'Unter 3 — kostenlos',
    extras: 'Extras', electricity: 'Stromanschluss', pets: 'Haustiere',
    motorhomeService: 'Wohnmobil-Service', once: 'einmalig',
    perNight: 'Kč / Nacht', perAnimalNight: 'Kč / Tier / Nacht',
    nights: 'Nächte', night: 'Nacht', oneMoreNight: '+ eine Nacht', leavingOn: 'Abreise',
    total: 'Gesamt', touristTax: 'Kurtaxe', priceIncl: 'Preis inkl. Kurtaxe',
    yourName: 'Vor- und Nachname', yourPhone: 'Telefon',
    payAtReception: 'Buchen und an der Rezeption zahlen',
    payAtReceptionSub: 'Bar oder Karte. Ihr Platz ist reserviert.',
    finish: 'Fertig', working: 'Einen Moment…',
    doneTitle: 'Fertig!', doneSub: 'Ihr Platz ist gebucht.',
    yourSpot: 'Ihr Platz', openGuestPage: 'Anfahrt öffnen →',
    pickSomething: 'Wählen Sie mindestens eine Position.', nameRequired: 'Name und Telefon eingeben.',
    back: '‹ Zurück',
    toPay: 'An der Rezeption zu zahlen',
  },
  uk: {
    pickLang: 'Оберіть мову',
    haveBooking: '🔑 У мене є бронювання', haveBookingSub: 'Знайдемо його і дамо інструкції для заїзду.',
    noBooking: '⛺ У мене немає бронювання', noBookingSub: 'Оберіть місце — оформимо заселення зараз.',
    contactAdmin: '💬 Звʼязатися з адміністратором',
    findTitle: 'Знайти бронювання', findSub: 'Введіть телефон і прізвище, які вказували при бронюванні.',
    phone: 'Телефон', surname: 'Прізвище', find: 'Знайти', searching: 'Шукаю…',
    notFound: 'Бронювання не знайшли',
    notFoundSub: 'Перевірте номер і прізвище. Шукаємо лише заїзди на сьогодні й завтра.',
    throttled: 'Забагато спроб. Спробуйте за 15 хвилин або напишіть адміністратору.',
    noPage: 'Бронювання знайшли, але в нього немає гостьової сторінки. Напишіть адміністратору.',
    campTitle: 'Кемпінг', campSub: 'Оберіть усе, що привезли', yourSetup: 'Ваше спорядження',
    guests: 'Гості', adults: 'Дорослі', children: 'Діти (3-15)', childrenFree: 'До 3 років — безкоштовно',
    extras: 'Додатково', electricity: 'Підключення електрики', pets: 'Тварини',
    motorhomeService: 'Сервіс автодому', once: 'разово',
    perNight: 'Kč / ніч', perAnimalNight: 'Kč / тварина / ніч',
    nights: 'ночей', night: 'ніч', oneMoreNight: '+ ще ніч', leavingOn: 'Виїзд',
    total: 'Разом', touristTax: 'Курортний збір', priceIncl: 'Ціна вже зі збором',
    yourName: 'Імʼя та прізвище', yourPhone: 'Телефон',
    payAtReception: 'Забронювати й оплатити на ресепшн',
    payAtReceptionSub: 'Готівкою або карткою. Місце тримаємо за вами.',
    finish: 'Готово', working: 'Працюю…',
    doneTitle: 'Готово!', doneSub: 'Ваше місце заброньоване.',
    yourSpot: 'Ваше місце', openGuestPage: 'Відкрити інструкцію заїзду →',
    pickSomething: 'Оберіть хоча б одну позицію.', nameRequired: 'Введіть імʼя і телефон.',
    back: '‹ Назад',
    toPay: 'До сплати на ресепшн',
  },
};
````

## `src/app/checkin/layout.tsx`

_22 рядків, повністю. Обгортка: палітра майстра бронювання, `robots: noindex`, тема під телефон._

````tsx
import type { Viewport } from 'next';
import '../book/booking-wizard.css';

export const metadata = {
  title: 'Check-in — Kemp Carlsbad',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#2E6B4F',
};

export default function CheckinLayout({ children }: { children: React.ReactNode }) {
  // .kc-root is where the wizard's palette lives — background, text colour and
  // the font all hang off it. Without it the page inherits the app's own body
  // colour, which on a phone in dark mode is light text on the light card
  // background: readable in the simulator, invisible at the gate.
  return <div className="kc-root">{children}</div>;
}
````

## `src/app/api/public/checkin/find/route.ts`

_4 рядків, повністю. Маршрут — сам по собі порожній, уся суть у хендлері нижче._

````ts
import { findMyBooking, findMyBookingOptions } from '@bookings';
export const POST = findMyBooking;
export const OPTIONS = findMyBookingOptions;
export const dynamic = 'force-dynamic';
````

## `src/modules/bookings/api/checkin-lookup.handlers.ts`

_116 рядків, повністю. Пошук «моєї броні» за телефоном і прізвищем — головний безпековий вузол усієї вирви._

````ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Find my booking — the QR self check-in entry point.
 *
 * A guest standing at the gate types their phone number and surname, and gets
 * back the link to their own guest page. That is a lookup into personal data by
 * a public, unauthenticated endpoint, so the shape of it matters more than the
 * code:
 *
 *   - The search window is arrivals within a day of today. The guest is
 *     physically here; a booking for next month is not what they are asking
 *     about. It also shrinks the searchable set from the whole database to the
 *     handful of people arriving, which is what makes guessing phone numbers
 *     pointless — you would have to guess the number of someone arriving today.
 *   - Phone AND surname must both match. A phone alone is guessable; a phone
 *     plus the right surname is not.
 *   - The response carries the token and nothing else. No name, no dates, no
 *     amount. A caller who guesses right gets in; a caller who guesses wrong
 *     learns nothing, including whether the number exists at all.
 *   - Wrong guesses are counted per IP. Ten in fifteen minutes and that address
 *     is done, the same brake the reception PIN uses.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { publicMessage } from '@core/security/public-error';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function findMyBookingOptions() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;
const attempts = new Map<string, { count: number; first: number }>();

function blocked(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) return false;
  return rec.count >= LIMIT;
}

function recordMiss(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else rec.count++;
  if (attempts.size > 5000) attempts.clear();
}

function clientKey(req: Request): string {
  const h = req.headers;
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
}

/** Compare on digits only: +420 777 123 456, 777123456 and 00420777123456 are one number. */
const digits = (s: string) => String(s || '').replace(/\D/g, '');

export async function findMyBooking(req: Request) {
  try {
    const body = await req.json();
    const phone = digits(body.phone);
    const surname = String(body.surname || '').trim().toLowerCase();

    // Same answer for a malformed request as for a wrong one — an error that
    // distinguishes them is a way to probe.
    const notFound = NextResponse.json({ found: false }, { status: 200, headers: CORS });
    if (phone.length < 6 || surname.length < 2) return notFound;

    const key = clientKey(req);
    if (blocked(key)) {
      return NextResponse.json(
        { error: 'Забагато спроб. Спробуйте за 15 хвилин або зверніться до адміністратора.', code: 'THROTTLED' },
        { status: 429, headers: CORS },
      );
    }

    const rows = getDb().prepare(`
      SELECT r.id, r.guest_page_token, g.phone, g.last_name, g.first_name
      FROM reservations r
      JOIN guests g ON g.id = r.guest_id
      WHERE r.status NOT IN ('cancelled', 'no_show')
        AND date(r.check_in) BETWEEN date('now', '-1 day') AND date('now', '+1 day')
    `).all() as any[];

    // The last six digits, so a number stored with a country code still matches
    // one typed without it.
    const tail = phone.slice(-6);
    const hit = rows.find((r) => {
      const stored = digits(r.phone);
      if (!stored || stored.slice(-6) !== tail) return false;
      const last = String(r.last_name || '').trim().toLowerCase();
      const first = String(r.first_name || '').trim().toLowerCase();
      // Either name half counts: bookings arrive from channels with the two
      // swapped often enough that insisting on the surname would turn away
      // guests who are standing at the desk.
      return last === surname || first === surname;
    });

    if (!hit) { recordMiss(key); return notFound; }
    if (!hit.guest_page_token) {
      return NextResponse.json(
        { found: true, token: null, code: 'NO_PAGE' },
        { status: 200, headers: CORS },
      );
    }
    return NextResponse.json({ found: true, token: hit.guest_page_token }, { status: 200, headers: CORS });
  } catch (error: any) {
    console.error('[checkin/find] error:', error?.message);
    return NextResponse.json({ error: publicMessage(error) }, { status: 500, headers: CORS });
  }
}
````

## `src/app/book/lib/pricing.ts`

_33 рядків, повністю. Як прайс потрапляє в браузер: чистий шматок цінового модуля + кеш на 5 хв._

````ts
/**
 * Kemp Carlsbad — widget pricing entry point.
 *
 * The rules moved into the pricing module so the server can price a camping
 * stay too. This file keeps the widget's imports working and holds the one
 * browser-only piece: fetching the price list.
 *
 * Reaches the rate card directly rather than through '@pricing': that barrel
 * also exports the route handlers, which pull better-sqlite3 in behind them.
 * The rate card is pure — no db, no fetch — so it is the half that can ship to
 * a browser.
 */
export * from '@/modules/pricing/domain/rate-card';
import type { PriceItem } from '@/modules/pricing/domain/rate-card';

// Cache loaded rates
let _priceListCache: PriceItem[] | null = null;
let _priceListCacheTime = 0;

export async function loadPriceList(): Promise<PriceItem[]> {
  const now = Date.now();
  if (_priceListCache && now - _priceListCacheTime < 5 * 60 * 1000) return _priceListCache;
  try {
    const res = await fetch('/api/widget/prices');
    if (res.ok) {
      _priceListCache = await res.json();
      _priceListCacheTime = now;
      return _priceListCache!;
    }
  } catch { /* fallback */ }
  return [];
}

````

## `src/app/api/booking/drafts/route.ts`

_6 рядків, повністю. Маршрут створення броні з вирви (той самий, що в майстра сайту)._

````ts
import { createBookingDraft, getBookingDraft, deleteBookingDraft, updateBookingDraft, createBookingDraftOptions } from '@bookings/booking-drafts.handlers';
export const POST = createBookingDraft;
export const GET = getBookingDraft;
export const PUT = updateBookingDraft;
export const DELETE = deleteBookingDraft;
export const OPTIONS = createBookingDraftOptions;
````

## `src/modules/bookings/api/booking-drafts.handlers.ts`

_рядки 1–327 з 704. POST: чернетка → гість → номер → бронь → послуги. Далі в файлі йдуть PUT (підтвердження оплати PIN-ом рецепції), GET (опитування статусу) і DELETE — вони в вирву чек-іну не входять, опис у README._

````ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { findFreeUnit } from '../data/bot-catalog.repo';
import { sendBookingConfirmationEmail } from '../data/send-confirmation-email';
import { publicMessage } from '@core/security/public-error';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function createBookingDraftOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Helper: generate a short token ─────────────────────────────────────────
function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function genToken(len = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ─── POST — create draft + real PMS reservation ──────────────────────────────
export async function createBookingDraft(req: Request) {
  try {
    const body = await req.json();
    const db = getDb();

    const draftId = genId('bkd');
    const sessionId = body.session_id || genId('sess');

    // 1. Save booking_draft (always — as a log)
    db.prepare(`
      INSERT INTO booking_drafts (id, session_id, accommodation_type, unit_type, check_in, check_out,
        adults, children, extras, options, guest_name, guest_email, guest_phone,
        total_price, deposit_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      draftId, sessionId,
      body.accommodation_type || null,
      body.accommodation_data?.unit || body.accommodation_data?.building || null,
      body.check_in || null,
      body.check_out || null,
      body.accommodation_data?.adults || 1,
      body.accommodation_data?.children || 0,
      JSON.stringify(body.extras || []),
      JSON.stringify(body.accommodation_data || {}),
      body.guest_name || null,
      body.guest_email || null,
      body.guest_phone || null,
      body.total_price || 0,
      body.deposit_amount || 0,
    );

    // 2. Find or create Guest in PMS
    const [firstName, ...rest] = (body.guest_name || 'Guest').trim().split(' ');
    const lastName = rest.join(' ') || '';

    // Get first property's organization_id
    const property = db.prepare(`SELECT id, organization_id FROM properties LIMIT 1`).get() as any;
    if (!property) {
      console.warn('[BookingDraft] No property found — returning draft only');
      return NextResponse.json({ id: draftId, session_id: sessionId }, { headers: CORS_HEADERS });
    }

    let guestId: string | null = null;

    // ⚠️ Widget bookings ALWAYS create a new guest record.
    // We intentionally do NOT look up by email here — reusing an existing
    // guest by email caused one person's name (e.g. "Lukeš Jaroslav") to
    // appear on completely different guests' bookings whenever the same
    // e-mail was entered for multiple people.
    // A staff member can later merge duplicate guest profiles in the PMS.
    guestId = genId('g');
    db.prepare(`
      INSERT INTO guests (id, organization_id, first_name, last_name, email, phone, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'widget_kemp', datetime('now'))
    `).run(guestId, property.organization_id, firstName, lastName, body.guest_email || null, body.guest_phone || null);


    // 3. Find a suitable unit
    const accommodationType: string = body.accommodation_type || 'camping';
    let unitId: string | null = null;

    if (accommodationType === 'camping') {
      const checkIn = body.check_in || null;
      const checkOut = body.check_out || null;

      // Was a hand-written list of type codes — 'bb', 'fr', 'br' — which quietly
      // left out FB (Front Pitch, fifteen units). Those pitches could not be
      // booked from the website at all, and once the listed ones filled up the
      // fallback below handed out an occupied pitch instead of a free FB one.
      // bot_rate_code says which types are camping; nothing has to be guessed.
      const free = (checkIn && checkOut) ? findFreeUnit(db, 'camping', checkIn, checkOut) : null;
      unitId = free?.id || null;

      if (!unitId) {
        // Everything taken. Deliberately still books — the operator's rule is
        // that a booking must not be lost, and reception sorts the pitch out on
        // the ground. Same behaviour as before, now only when it is really full.
        const anyCamping = db.prepare(`
          SELECT u.id FROM units u
          JOIN unit_types ut ON ut.id = u.unit_type_id
          WHERE u.property_id = ? AND COALESCE(u.is_active, 1) = 1 AND ut.bot_rate_code = 'camping'
          ORDER BY u.sort_order, u.code LIMIT 1
        `).get(property.id) as any;
        unitId = anyCamping?.id || null;
        if (unitId) console.warn('[BookingDraft] All camping pitches occupied — assigning', unitId, 'for staff to sort out');
      }
    } else if (accommodationType === 'glamping') {
      const unitCode = (body.accommodation_data?.unit === 'barn') ? 'barn' : 'tiny';
      const glamUnit = db.prepare(`
        SELECT u.id FROM units u
        JOIN unit_types ut ON u.unit_type_id = ut.id
        WHERE u.property_id = ? AND u.is_active = 1
          AND (LOWER(ut.code) LIKE '%glamp%' OR LOWER(ut.name) LIKE '%glamp%'
               OR LOWER(u.name) LIKE ? OR LOWER(ut.code) LIKE ?)
        ORDER BY u.sort_order LIMIT 1
      `).get(property.id, `%${unitCode}%`, `%${unitCode}%`) as any;
      unitId = glamUnit?.id || null;
    } else if (accommodationType === 'buildings') {
      const bld = body.accommodation_data?.building === 'budova_f' ? 'bldg_f' : 'bldg_d';
      const checkIn  = body.check_in  || null;
      const checkOut = body.check_out || null;

      const buildingUnit = (checkIn && checkOut)
        ? db.prepare(`
            SELECT u.id FROM units u
            WHERE u.property_id = ? AND u.is_active = 1
              AND u.building_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.unit_id = u.id
                  AND r.status NOT IN ('cancelled', 'no_show')
                  AND r.check_in  < ?
                  AND r.check_out > ?
              )
            ORDER BY u.sort_order, u.name
            LIMIT 1
          `).get(property.id, bld, checkOut, checkIn) as any
        : db.prepare(`
            SELECT u.id FROM units u
            WHERE u.property_id = ? AND u.is_active = 1
              AND u.building_id = ?
            ORDER BY u.sort_order, u.name
            LIMIT 1
          `).get(property.id, bld) as any;

      if (!buildingUnit) {
        const fallbackBld = db.prepare(`
          SELECT u.id FROM units u
          WHERE u.property_id = ? AND u.is_active = 1 AND u.building_id = ?
          ORDER BY u.sort_order, u.name LIMIT 1
        `).get(property.id, bld) as any;
        unitId = fallbackBld?.id || null;
      } else {
        unitId = buildingUnit.id;
      }
    }

    // Ultimate fallback: any unit at all (so we never fail with NOT NULL constraint)
    if (!unitId) {
      const anyUnit = db.prepare(`SELECT id FROM units WHERE property_id = ? AND is_active = 1 ORDER BY sort_order LIMIT 1`).get(property.id) as any;
      unitId = anyUnit?.id || null;
    }

    // If still no unit — abort gracefully (return draft without PMS reservation)
    if (!unitId) {
      console.warn('[BookingDraft] No units found — returning draft only');
      db.prepare(`UPDATE booking_drafts SET guest_page_token = ? WHERE id = ?`).run(genToken(32), draftId);
      const d = db.prepare('SELECT * FROM booking_drafts WHERE id = ?').get(draftId) as any;
      return NextResponse.json({ id: draftId, session_id: sessionId, reservation_id: null, guest_page_token: d?.guest_page_token }, { headers: CORS_HEADERS });
    }

    // 4. Calculate nights
    const nights = (() => {
      if (!body.check_in || !body.check_out) return 1;
      const d1 = new Date(body.check_in);
      const d2 = new Date(body.check_out);
      return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
    })();

    // 5. Create Reservation in PMS
    const reservationId = genId('r');
    const guestPageToken = genToken(32);

    const utmParams = body.utm_params || {};
    const utmSource = utmParams['utm_source'] || null;
    const utmMedium = utmParams['utm_medium'] || null;
    const utmCampaign = utmParams['utm_campaign'] || null;
    const utmContent = utmParams['utm_content'] || null;
    const utmTerm = utmParams['utm_term'] || null;
    const gaClientId = utmParams['ga_client_id'] || null;

    // A caller may name its own source. The gate check-in does: a walk-in who is
    // standing on the pitch must not be filed as a website booking, because
    // /api/cron/expire-unpaid cancels unpaid `widget%` bookings the day after
    // arrival — which would cancel a guest who is asleep in their tent.
    const campingSel: string[] = Array.isArray(body.accommodation_data?.selectedItems)
      ? body.accommodation_data.selectedItems.map(String) : [];
    const TENT_CODES = new Set(['small_tent', 'large_tent']);
    const campingTents = campingSel.filter((c) => TENT_CODES.has(c)).join(',') || null;
    const campingVehicles = campingSel.filter((c) => !TENT_CODES.has(c)).join(',') || null;
    const campingElectricity = body.accommodation_data?.electricity ? 1 : 0;
    const campingPetsCount = Math.max(0, Math.floor(Number(body.accommodation_data?.pets) || 0));
    const campingPets = campingPetsCount ? String(campingPetsCount) : null;

    const draftSource = typeof body.source === 'string' && body.source.trim()
      ? body.source.trim()
      : (body.site_id ? `widget:${body.site_id}` : 'widget_kemp');

    const refUrl = body.source_url || 'Прямий захід';
    const ua = body.user_agent || '';
    const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Edge') ? 'Edge' : 'Інший';
    const device = ua.includes('Mobile') ? 'Mobile' : 'Desktop';
    
    let marketingNotes = `🌐 Джерело: ${refUrl}\n`;
    marketingNotes += `💻 Пристрій: ${device} · ${browser}\n`;
    if (body.language || body.time_zone) {
      marketingNotes += `🌍 Мова/Локація: ${body.language || '?'} · ${body.time_zone || '?'}\n`;
    }
    if (body.accommodation_data) {
      marketingNotes += `ℹ️ Опції: ${JSON.stringify(body.accommodation_data)}`;
    }

    db.prepare(`
      INSERT INTO reservations (
        id, property_id, unit_id, guest_id, source,
        check_in, check_out, nights,
        adults, children,
        total_price, currency,
        status, payment_status,
        guest_page_token,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, ga_client_id,
        camping_tent_type, camping_vehicle_type, camping_electricity, camping_pets,
        notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, 'CZK',
        'tentative', 'unpaid',
        ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, datetime('now'), datetime('now')
      )
    `).run(
      reservationId,
      property.id,
      unitId,
      guestId,
      draftSource,
      body.check_in || null,
      body.check_out || null,
      nights,
      body.accommodation_data?.adults || 1,
      body.accommodation_data?.children || 0,
      body.total_price || 0,
      guestPageToken,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm, gaClientId,
      // What the guest brought, split the way the rest of the PMS reads it:
      // what they sleep in, what they drove in on, animals. It used to live only
      // in the draft's options JSON, so the booking card showed a camping stay
      // with no equipment on it and re-pricing had nothing to re-price.
      campingTents, campingVehicles, campingElectricity, campingPets,
      marketingNotes,
    );

    // Link draft → reservation + save token in draft
    db.prepare(`UPDATE booking_drafts SET reservation_id = ?, guest_page_token = ? WHERE id = ?`).run(reservationId, guestPageToken, draftId);

    // 6. Create service_orders for extras
    const extras: any[] = body.extras || [];
    for (const extra of extras) {
      if (!extra.id || !extra.price) continue;
      const orderId = genId('so');
      try {
        db.prepare(`
          INSERT INTO service_orders (
            id, reservation_id, service_id, quantity, total_price,
            status, payment_status, service_date, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', 'unpaid', ?, 'Booked via widget', datetime('now'))
        `).run(orderId, reservationId, extra.id, extra.quantity || 1, extra.price || 0, body.check_in || null);
      } catch (e: any) {
        // service_orders table might use different schema — try booking_service_orders
        try {
          db.prepare(`
            INSERT INTO booking_service_orders (
              id, reservation_id, service_id, quantity, unit_price, total_price,
              status, payment_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid', datetime('now'))
          `).run(orderId, reservationId, extra.id, extra.quantity || 1,
            (extra.price / (extra.quantity || 1)) || 0, extra.price || 0);
        } catch { /* ignore if neither table exists */ }
      }
    }

    console.log(`[BookingDraft] Created draft=${draftId} reservation=${reservationId} guest=${guestId}`);

    // The unit code is the one thing a guest standing at the barrier actually
    // needs: which pitch is theirs. It was computed here and thrown away.
    const assigned = unitId
      ? db.prepare('SELECT code, name FROM units WHERE id = ?').get(unitId) as any
      : null;

    return NextResponse.json({
      id: draftId,
      session_id: sessionId,
      reservation_id: reservationId,
      guest_page_token: guestPageToken,
      unit_code: assigned?.code || assigned?.name || null,
    }, { headers: CORS_HEADERS });

  } catch (err: any) {
    console.error('[BookingDraft] Error:', err.message);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500, headers: CORS_HEADERS });
  }
}

````

## `src/app/guest/[token]/page.tsx`

_рядки 456–509 з 1832. Надсилання реєстрації з гостьової сторінки — куди вирва приводить гостя після створення броні._

````tsx
  // ─── Registration submit (one guest at a time) ──
  const handleRegSubmit = async () => {
    setRegLoading(true);
    try {
      const nameParts = regData.fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      // Collect all previously registered guests + this new one
      const VALID_DOC_TYPES = ['id_card', 'passport', 'driving_license', 'other'];
      const existingGuests = (data?.registeredGuests || []).map((g: any) => ({
        firstName: g.first_name, lastName: g.last_name,
        dateOfBirth: g.date_of_birth || null, address: g.address || null,
        nationality: g.nationality || null,
        documentType: VALID_DOC_TYPES.includes(g.document_type) ? g.document_type : 'other',
        documentNumber: g.document_number || null,
        purposeOfStay: g.purpose_of_stay || 'Tourism',
        visaNumber: g.visa_number || null,
      }));
      const allGuests = [...existingGuests, {
        firstName, lastName,
        dateOfBirth: regData.dateOfBirth, address: regData.address,
        nationality: regData.nationality,
        documentType: regData.documentType,
        documentNumber: regData.documentNumber,
        purposeOfStay: regData.purposeOfStay || 'Tourism',
        visaNumber: regData.visaNumber || '',
      }];
      const res = await fetch(`/api/guest/${token}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guests: allGuests }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Registration failed');
      }
      const result = await res.json();
      setData((prev: any) => ({ ...prev, registeredGuests: result.registeredGuests }));
      const newCount = result.registeredGuests?.length || 0;
      if (newCount >= requiredGuests) {
        // All guests registered
        setShowReg(false);
        showToast(t.regSaved);
      } else {
        // More guests to register — reset form for next guest
        setRegCurrentGuest(newCount);
        setRegStep(1);
        setRegData({ fullName: '', email: '', phone: '', dateOfBirth: '', documentType: '', documentNumber: '', nationality: '', address: '', purposeOfStay: 'Tourism', visaNumber: '' });
        setConsent(false);
        showToast(`✅ ${t.guestReg} ${newCount}/${requiredGuests}`);
      }
    } catch { showToast(t.regError, 'error'); }
    setRegLoading(false);
  };

````

## `src/app/guest/[token]/page.tsx`

_рядки 1458–1645 з 1832. Сама форма реєстрації: три кроки, OCR документа, підтвердження. Це «повна форма з реєстрацією», про яку йдеться в задачі._

````tsx
      {/* ════ REGISTRATION OVERLAY ════ */}
      {showReg && (
        <div className="gp-reg-overlay">
          <div className="gp-reg-header">
            <button className="gp-reg-back" onClick={() => {
              if (regStep === 1) setShowReg(false);
              else setRegStep(s => s - 1);
            }}>{regStep === 1 ? '✕' : t.back}</button>
            <span className="gp-reg-step">{requiredGuests > 1 ? `${t.guest} ${regCurrentGuest + 1}/${requiredGuests} · ` : ''}{t.stepOf(regStep, 3)}</span>
            <div style={{ width: 48 }} />
          </div>
          <div className="gp-reg-progress">
            <div className="gp-reg-progress-fill" style={{ width: `${(regStep / 3) * 100}%` }} />
          </div>


          {/* Hidden file input for OCR photo */}
          <input
            ref={ocrInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setOcrLoading(true);
              try {
                const reader = new FileReader();
                const base64 = await new Promise<string>((resolve) => {
                  reader.onload = () => resolve(reader.result as string);
                  reader.readAsDataURL(file);
                });
                const res = await fetch(`/api/guest/${token}/ocr`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ image: base64 }),
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok || !result.success) {
                  const msg = result?.error || `HTTP ${res.status}`;
                  console.error('[OCR]', msg);
                  showToast(`OCR error: ${msg}. Please fill in manually.`, 'error');
                } else if (result.data) {
                  const d = result.data;
                  setRegData(prev => ({
                    ...prev,
                    fullName: d.fullName || prev.fullName,
                    dateOfBirth: d.dateOfBirth || prev.dateOfBirth,
                    documentType: d.documentType || prev.documentType,
                    documentNumber: d.documentNumber || prev.documentNumber,
                    nationality: d.nationality || prev.nationality,
                    address: d.address || prev.address,
                  }));
                  showToast(`✅ ${d.confidence > 70 ? 'Data extracted!' : 'Partial data — please review'}`);
                } else {
                  showToast('Could not read document. Please fill in manually.', 'error');
                }
              } catch (err) {
                const msg = (err as Error)?.message || 'unknown';
                console.error('[OCR]', err);
                showToast(`OCR error: ${msg}. Please fill in manually.`, 'error');
              }
              setOcrLoading(false);
              if (ocrInputRef.current) ocrInputRef.current.value = '';
            }}
          />


          <div className="gp-reg-body">
            {/* Step 1: Guest Details */}
            {regStep === 1 && (
              <>
                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>{t.step1Title}</h2>
                <div className="gp-field">
                  <div className="gp-field-label">{t.fullName} *</div>
                  <input className="gp-field-input" value={regData.fullName} autoComplete="off"
                    onChange={e => setRegData(d => ({ ...d, fullName: e.target.value }))} />
                </div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.email} *</div>
                  <input className="gp-field-input" type="email" value={regData.email} autoComplete="email"
                    onChange={e => setRegData(d => ({ ...d, email: e.target.value }))} />
                </div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.phone}</div>
                  <input className="gp-field-input" type="tel" value={regData.phone} autoComplete="tel"
                    onChange={e => setRegData(d => ({ ...d, phone: e.target.value }))} />
                  <div className="gp-field-hint">{t.phoneHint}</div>
                </div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.dateOfBirth} *</div>
                  <input className="gp-field-input" type="date" value={regData.dateOfBirth} autoComplete="bday"
                    onChange={e => setRegData(d => ({ ...d, dateOfBirth: e.target.value }))} />
                </div>
              </>
            )}

            {/* Step 2: ID Document */}
            {regStep === 2 && (
              <>
                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{t.step2Title}</h2>
                <p style={{ fontSize: 14, color: 'var(--gp-sub)', marginBottom: 16 }}>{t.step2Why}</p>
                <div className="gp-security-notice">{t.securityNotice}</div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.documentType} *</div>
                  <select className="gp-field-input" value={regData.documentType}
                    onChange={e => setRegData(d => ({ ...d, documentType: e.target.value }))}>
                    <option value="">{t.selectDoc}</option>
                    <option value="passport">{t.passportDoc}</option>
                    <option value="id_card">{t.idCardDoc}</option>
                    <option value="driving_license">{t.drivingLicenseDoc}</option>
                  </select>
                </div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.documentNumber} *</div>
                  <input className="gp-field-input" value={regData.documentNumber}
                    onChange={e => setRegData(d => ({ ...d, documentNumber: e.target.value }))} />
                </div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.nationality} *</div>
                  <input className="gp-field-input" value={regData.nationality} autoComplete="country-name"
                    placeholder="DEU, CZE, UKR..."
                    onChange={e => setRegData(d => ({ ...d, nationality: e.target.value }))} />
                </div>
                <div className="gp-field">
                  <div className="gp-field-label">{t.permanentAddress} *</div>
                  <input className="gp-field-input" value={regData.address} autoComplete="street-address"
                    placeholder="München, Germany"
                    onChange={e => setRegData(d => ({ ...d, address: e.target.value }))} />
                </div>
              </>
            )}

            {/* Step 3: Confirm */}
            {regStep === 3 && (
              <>
                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{t.step3Title}</h2>
                <div className="gp-confirm-table">
                  {[
                    [t.fullName, regData.fullName],
                    [t.email, regData.email],
                    [t.phone, regData.phone || '—'],
                    [t.dateOfBirth, regData.dateOfBirth],
                    [t.documentType, regData.documentType],
                    [t.documentNumber, regData.documentNumber],
                    [t.nationality, regData.nationality],
                    [t.permanentAddress, regData.address],
                  ].map(([label, value], i) => (
                    <div key={i} className="gp-confirm-row">
                      <span className="gp-confirm-label">{label}</span>
                      <span className="gp-confirm-value">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="gp-confirm-success">{t.confirmNotice}</div>
              </>
            )}
          </div>

          <div className="gp-reg-footer">
            {regStep < 3 ? (
              <button className="gp-btn gp-btn-primary" onClick={() => {
                // Validation
                if (regStep === 1) {
                  if (!regData.fullName.trim() || !regData.email.trim() || !regData.dateOfBirth) {
                    showToast(t.regError, 'error'); return;
                  }
                }
                if (regStep === 2) {
                  if (!regData.documentType || !regData.documentNumber.trim() || !regData.nationality.trim() || !regData.address.trim()) {
                    showToast(t.regError, 'error'); return;
                  }
                }
                setRegStep(s => s + 1);
              }}>
                {t.continue_}
              </button>
            ) : (
              <button className="gp-btn gp-btn-primary" onClick={handleRegSubmit} disabled={regLoading}>
                {regLoading ? '...' : t.confirmReg}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════ BOTTOM TAB BAR ════ */}
      <div className="gp-tab-bar">
````

## `src/modules/guests/api/register.handlers.ts`

_198 рядків, повністю. Приймач реєстрації: zod-схема, обмеження частоти, Telegram і Google Sheets. Два останні — спадок односерверної, у мультитенанті їх немає._

````ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as registrationRepo from '../data/registration.repo';
// TODO: replace with @channels eventBus event when channels module is migrated
import { checkRateLimit } from '@/lib/rate-limit';
import { sendTelegramMessage } from '@/lib/channels/telegram-bot';
import { isMuted } from '@/modules/notifications/data/muted';
import { maskFullName, maskDob, maskDocNumber, maskDobForSheets, maskDocNumberForSheets } from '@core/security/pii-mask';
import { publicMessage } from '@core/security/public-error';

/** POST to Google Apps Script (same endpoint as the Telegram bot uses) */
async function syncToGoogleSheets(guests: any[], reservation: any): Promise<void> {
  const url = process.env.GOOGLE_GUESTS_SCRIPT_URL;
  if (!url) return; // not configured — skip silently

  for (const guest of guests) {
    const nights = reservation.check_in && reservation.check_out
      ? Math.max(0, (new Date(reservation.check_out + 'T00:00:00Z').getTime() - new Date(reservation.check_in + 'T00:00:00Z').getTime()) / 86400000)
      : 0;

    const payload = {
      action: 'guest',
      full_name: `${guest.lastName || ''} ${guest.firstName || ''}`.trim(),
      surname: guest.lastName || '',
      first_name: guest.firstName || '',
      birth_date: maskDobForSheets(guest.dateOfBirth),
      doc_type: guest.documentType || '',
      doc_number: maskDocNumberForSheets(guest.documentNumber),
      country_code: '',
      nationality: guest.nationality || '',
      address: '',  // PII minimization — full address stays in PMS only
      visa_number: '',
      check_in: reservation.check_in || '',
      check_out: reservation.check_out || '',
      nights,
      is_foreigner: 'Tak',
      tax_amount: 0,
      exempt_reason: '',
      purpose: '',
      note: '[Web registration via guest portal]',
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      const text = await resp.text();
      if (resp.ok && !text.toLowerCase().includes('error')) {
        console.log('[GuestReg Sheets] Synced:', payload.full_name);
      } else {
        console.error('[GuestReg Sheets] Error:', resp.status, text.slice(0, 200));
      }
    } catch (e: any) {
      console.error('[GuestReg Sheets] Failed:', e.message);
    }
  }
}

/** Send TG alert when critical fields are missing — manager can follow up */
async function alertMissingFields(guests: any[], reservation: any): Promise<void> {
  if (isMuted('incomplete_registration')) return;
  const esc = (s: string) => s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  const REQUIRED = ['firstName', 'lastName', 'dateOfBirth', 'documentType', 'documentNumber'];
  const LABELS: Record<string, string> = {
    firstName: 'Ім\'я', lastName: 'Прізвище', dateOfBirth: 'Дата народження',
    documentType: 'Тип документа', documentNumber: 'Номер документа',
    nationality: 'Національність', address: 'Адреса',
  };

  for (const [i, guest] of guests.entries()) {
    const missing = REQUIRED.filter(f => !guest[f as keyof typeof guest]);
    if (missing.length === 0) continue;

    const missingStr = missing.map(f => `• ${LABELS[f] || f}`).join('\n');
    const text = [
      `⚠️ <b>Неповна реєстрація гостя</b>`,
      ``,
      `👤 Гість ${i + 1}: <b>${esc(guest.firstName || '?')} ${esc(guest.lastName || '?')}</b>`,
      `🏠 ${esc(reservation.unit_name)} (${reservation.check_in} → ${reservation.check_out})`,
      ``,
      `❌ <b>Відсутні поля:</b>`,
      missingStr,
      ``,
      `<i>Гість зареєструвався через гостьову сторінку. Уточніть дані особисто або через чат.</i>`,
    ].join('\n');

    sendTelegramMessage(text).catch(() => {});
  }
}

export async function registerGuests(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const body = await request.json();

    const reservation = registrationRepo.getReservationForRegistration(token);
    if (!reservation) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const rl = checkRateLimit(token, 'registration', 3, 5);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
    }

    const { guests } = body;
    if (!guests || !Array.isArray(guests) || guests.length === 0) {
      return NextResponse.json({ error: 'At least one guest is required' }, { status: 400 });
    }

    const { z } = require('zod');
    const VALID_DOC_TYPES = ['id_card', 'passport', 'driving_license', 'other'] as const;
    const guestSchema = z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
      // Optional fields — Telegram alert fires when they are missing (alertMissingFields)
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
      documentType: z.enum(VALID_DOC_TYPES).nullable().optional().default('other'),
      documentNumber: z.string().max(50).nullable().optional(),
      nationality: z.string().max(50).nullable().optional(),
      address: z.string().max(255).nullable().optional(),
      purposeOfStay: z.string().max(100).nullable().optional(),
      visaNumber: z.string().max(50).nullable().optional(),
    });

    const parsedGuests = [];
    for (const g of guests) {
      // Normalise documentType: empty string → 'other'
      const normalized = {
        ...g,
        documentType: VALID_DOC_TYPES.includes(g.documentType) ? g.documentType : 'other',
        dateOfBirth: g.dateOfBirth || null,
        documentNumber: g.documentNumber || null,
        nationality: g.nationality || null,
      };
      const result = guestSchema.safeParse(normalized);
      if (!result.success) {
        return NextResponse.json({ error: `Validation failed: ${result.error.issues[0].message}` }, { status: 400 });
      }
      parsedGuests.push(result.data);
    }

    const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
    const registeredGuests = registrationRepo.saveRegistrations(reservation.id, reservation.organization_id, parsedGuests, clientIp);

    // ── Auto-sync to Google Sheets (non-blocking) ─────────────────────────
    syncToGoogleSheets(parsedGuests, reservation).catch(() => {});

    // ── Alert if critical fields are missing ──────────────────────────────
    alertMissingFields(parsedGuests, reservation).catch(() => {});

    try {
      const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const guestLines = registeredGuests.map((g: any, i: number) => {
        const docLabel: Record<string, string> = { passport: 'Passport', id_card: 'ID Card', driving_license: 'Driving Licence' };
        return [
          `\n👤 <b>Гість ${i + 1}:</b> ${escHtml(maskFullName(g.first_name, g.last_name))}`,
          g.date_of_birth ? `🎂 ${maskDob(g.date_of_birth)}` : '',
          g.document_type ? `🪪 ${docLabel[g.document_type] || g.document_type}: ${maskDocNumber(g.document_number)}` : '',
          g.nationality ? `🌍 ${escHtml(g.nationality)}` : '',
        ].filter(Boolean).join('\n');
      }).join('\n');

      const text = [
        `✅ <b>Реєстрація гостя</b>`,
        ``,
        `🏠 ${escHtml(reservation.unit_name)} (${escHtml(reservation.unit_type_name)})`,
        `📅 ${reservation.check_in} — ${reservation.check_out} (${reservation.nights} ночей)`,
        `💰 ${reservation.total_price} ${reservation.currency} | ${escHtml(reservation.source || 'Direct')}`,
        `📊 Статус: ${reservation.status} | Оплата: ${reservation.payment_status}`,
        ``,
        `━━━ Бронювання ━━━`,
        `👤 ${escHtml(maskFullName(reservation.booking_first_name, reservation.booking_last_name))}`,
        ``,
        `━━━ Зареєстровані гості (${registeredGuests.length}/${reservation.adults}) ━━━`,
        guestLines,
      ].filter(Boolean).join('\n');

      if (!isMuted('guest_registration')) {
        sendTelegramMessage(text).catch(err =>
          console.error('[Registration Telegram] Error:', err.message),
        );
      }
    } catch (tgErr: any) {
      console.error('[Registration Telegram] Error:', tgErr.message);
    }

    return NextResponse.json({ success: true, registeredGuests });
  } catch (error: any) {
    console.error('POST /api/guest/[token]/register error:', error?.message || error);
    return NextResponse.json({ error: publicMessage(error, 'Failed to register guests') }, { status: 500 });
  }
}
````

## `src/modules/guests/data/registration.repo.ts`

_рядки 1–22 з 369. Як токен гостьової сторінки перетворюється на бронь. Далі у файлі — двобічна синхронізація `reservation_guests` ↔ `guest_registrations`, у мультитенанті є свій відповідник._

````ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';
import type { RegisteredGuest } from '../domain/types';
import { findOrCreateGuest } from './guest-dedup.repo';
import crypto from 'crypto';

export function getReservationForRegistration(token: string) {
  return getDb().prepare(`
    SELECT r.id, r.guest_id as booking_guest_id, r.check_in, r.check_out, r.nights,
           r.adults, r.total_price, r.currency, r.source, r.status, r.payment_status,
           g.first_name as booking_first_name, g.last_name as booking_last_name,
           g.email as booking_email, g.phone as booking_phone,
           u.name as unit_name, ut.name as unit_type_name,
           p.organization_id, p.name as property_name
    FROM reservations r
    JOIN properties p ON r.property_id = p.id
    JOIN guests g ON r.guest_id = g.id
    JOIN units u ON r.unit_id = u.id
    JOIN unit_types ut ON u.unit_type_id = ut.id
    WHERE r.guest_page_token = ?
  `).get(token) as any;
}
````

