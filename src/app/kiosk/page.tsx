'use client';

/**
 * Екран самообслуговування в холі.
 *
 * ── Один файл, вісім кроків, і стан ЛИШЕ в памʼяті ──────────────────────
 *
 * Нічого з того, що гість тут набирає, не лягає в `localStorage`, у куки чи
 * в адресу. У сховищі живе рівно одне — токен ПРИСТРОЮ, який належить
 * готелю, а не гостю. Прізвище, дати, підпис, номер кімнати й код скриньки
 * живуть у React-стані і зникають разом зі скиданням: наступний, хто підійде
 * до екрана, не має дізнатися про попереднього нічого.
 *
 * ── Скидання ────────────────────────────────────────────────────────────
 *
 * 45 секунд без дотику — питання «ви ще тут?»; 60 — стан порожній, крок
 * перший. Таймер не працює на стартовому екрані: там нема чого забувати.
 *
 * ── Що екран НЕ робить сам ──────────────────────────────────────────────
 *
 * Не рахує, не вирішує і не пише: кожен крок — виклик маршруту застосунку,
 * а той — фасаду модуля. Тут немає жодного правила заселення, жодного
 * правила пошуку і жодної ціни. Екран показує те, що відповів сервер, і
 * рівно стільки, скільки той віддав, — імена вже приходять маскою.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard } from '@/apps/kiosk/ui/Keyboard';
import { KioskCalendar, formatDay, localToday } from '@/apps/kiosk/ui/KioskCalendar';
import { bandStyle, useDeviceToken, useIdleReset } from '@/apps/kiosk/ui/useKiosk';
import {
  KIOSK_LANGS, KIOSK_LANG_LABELS, KIOSK_STRINGS, kioskLang, type KioskLang,
} from '@/apps/kiosk/ui/translations';

type Step =
  | 'start' | 'pair' | 'lookup' | 'find' | 'stay' | 'sign' | 'payment' | 'key'
  | 'checkout' | 'done' | 'info' | 'walkin';

/**
 * Чим гість називає себе на кроці пошуку.
 *
 * Не косметика і не «три кнопки замість однієї»: пара чинників у кожного
 * способу СВОЯ (`domain/search.ts`), і форма, яка показує всі поля одразу,
 * читається як «заповніть усе» — а треба рівно два. Гість біля термінала
 * тримає в руці лист із номером АБО памʼятає дату заїзду, не обидва.
 */
type FindBy = 'date' | 'confirmation';

interface Session {
  property: { id: string; name: string };
  checkinPaymentPolicy: string;
  systemOfRecord: string;
  walkinUrl: string | null;
  touchBand: { top: number; bottom: number };
  /** Вигляд ЦЬОГО готелю: обидва з `config_json` пристрою, обидва можуть бути порожні. */
  logoUrl: string | null;
  backgroundUrl: string | null;
}

interface Stay {
  reservationId: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  unitName: string | null;
  registered: boolean;
}

/**
 * Іконки карток — малюнком, не символом зі шрифту.
 *
 * `→]` чи `✦` виглядають однаково лише там, де шрифт має такий гліф: на
 * терміналі під Chrome kiosk на Windows частина з них показується квадратиком,
 * і гість бачить «□ Check in». Тонка лінія кольором тексту картки — те саме,
 * що на зразку власника, і не залежить ні від чого.
 */
const ICON = {
  width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, 'aria-hidden': true,
};

const IconArrive = () => (
  <svg {...ICON} className="kiosk-card-icon">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="M10 17l5-5-5-5" /><path d="M15 12H3" />
  </svg>
);
const IconDepart = () => (
  <svg {...ICON} className="kiosk-card-icon">
    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
    <path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
  </svg>
);
const IconCalendar = () => (
  <svg {...ICON} className="kiosk-tile-icon">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" /><path d="M8 14h3v3H8z" />
  </svg>
);
const IconTicket = () => (
  <svg {...ICON} className="kiosk-tile-icon">
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M7 10h6M7 14h4" /><path d="M17 10v4" />
  </svg>
);
const IconQr = () => (
  <svg {...ICON} className="kiosk-tile-icon">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" />
  </svg>
);
const IconExtras = () => (
  <svg {...ICON} className="kiosk-card-icon">
    <path d="M4 4h16l-8 8z" /><path d="M12 12v8" /><path d="M8 20h8" />
  </svg>
);

export default function KioskPage() {
  const { token, setToken, ready } = useDeviceToken();
  const [lang, setLang] = useState<KioskLang>('de');
  const [step, setStep] = useState<Step>('start');
  const [session, setSession] = useState<Session | null>(null);
  const [info, setInfo] = useState<{ reception: { phone: string | null; whatsapp: string | null } } | null>(null);
  const [stay, setStay] = useState<Stay | null>(null);
  const [key, setKey] = useState<{ unitName: string | null; lockCode: string | null; wifi: { network: string; password: string | null } | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);

  // Поля вводу і те, яке з них зараз під клавіатурою.
  const [fields, setFields] = useState<{ lastName: string; checkIn: string; confirmation: string }>(
    { lastName: '', checkIn: '', confirmation: '' });
  const [active, setActive] = useState<'lastName' | 'confirmation'>('lastName');
  const [findBy, setFindBy] = useState<FindBy>('date');
  // Календар відкривають дотиком по полю дати; закривається він вибором дня.
  const [pickingDate, setPickingDate] = useState(false);
  // Сьогодні — за годинником САМОГО екрана, один раз на монтування: якщо
  // термінал простоїть через північ, календар не має перестрибувати під рукою
  // гостя, який уже дивиться на місяць.
  const [today] = useState(() => localToday());
  const [pairCode, setPairCode] = useState('');

  const s = KIOSK_STRINGS[lang];

  /** Усе, що гість про себе лишив, — геть. Викликається таймером і кнопкою. */
  const forget = useCallback(() => {
    setStep('start');
    setStay(null);
    setKey(null);
    setMessage(null);
    setFields({ lastName: '', checkIn: '', confirmation: '' });
    setActive('lastName');
    setFindBy('date');
    setPickingDate(false);
    setIdle(false);
  }, []);

  const { touch } = useIdleReset({
    active: step !== 'start' && step !== 'pair',
    onWarn: () => setIdle(true),
    onReset: forget,
  });

  const call = useCallback(async (path: string, payload?: unknown): Promise<any> => {
    if (!token) return null;
    const res = await fetch(`/api/apps/kiosk/${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }, [token]);

  // Сесія термінала — одразу після того, як зʼявився токен.
  useEffect(() => {
    if (!ready || !token) return;
    let alive = true;
    (async () => {
      const answer = await call('session');
      if (!alive) return;
      if (answer?.ok) {
        setSession(answer.body as Session);
      } else if (answer?.status === 401) {
        // Токен більше не дійсний (термінал відкликали). Забути його —
        // інакше екран довіку показує «помилку», якої гість не полагодить.
        setToken(null);
      }
      const i = await call('info');
      if (alive && i?.ok) setInfo(i.body);
    })();
    return () => { alive = false; };
  }, [ready, token, call, setToken]);

  const band = useMemo(() => bandStyle(session?.touchBand ?? null), [session]);

  /** Один дотик — і будь-який дотик — відсуває забуття. */
  const wrap = (fn: () => void) => () => { touch(); setIdle(false); fn(); };

  const type = (ch: string) => setFields((f) => ({ ...f, [active]: f[active] + ch }));
  const backspace = () => setFields((f) => ({ ...f, [active]: f[active].slice(0, -1) }));

  async function doFind() {
    setMessage(null);
    // Шлються рівно ті поля, які цей спосіб показував. Інакше залишок від
    // попередньої спроби (гість почав із дати, передумав, пішов у номер
    // броні) поїхав би третім чинником і звузив би пошук до нуля — а гість
    // прочитав би «броні немає» про бронь, яка є.
    const answer = await call('find', {
      lastName: fields.lastName || undefined,
      checkIn: findBy === 'date' ? (fields.checkIn || undefined) : undefined,
      confirmation: findBy === 'confirmation' ? (fields.confirmation || undefined) : undefined,
    });
    if (answer?.status === 400) { setMessage(s.needFactors); return; }
    if (!answer?.ok) { setMessage(s.notFound); return; }
    if (!answer.body.found) {
      setMessage(answer.body.reason === 'need_more' ? s.needMore : s.notFound);
      return;
    }
    setStay(answer.body.stay as Stay);
    setStep('stay');
  }

  async function doCheckIn() {
    if (!stay) return;
    setMessage(null);
    const answer = await call('checkin', { reservationId: stay.reservationId });
    if (!answer?.ok) { setMessage(s.notFoundHelp); return; }
    setKey(answer.body);
    setStep('key');
  }

  async function doCheckOut() {
    if (!stay) return;
    const answer = await call('checkout', { reservationId: stay.reservationId });
    if (!answer?.ok) { setMessage(s.payAtReception); return; }
    setMessage(answer.body.invoiceExpected ? s.invoiceByMail : s.summaryByMail);
    setStep('done');
  }

  async function doPair() {
    const res = await fetch('/api/apps/kiosk/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairCode }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) { setToken(body.token); setPairCode(''); }
    else setMessage('—');
  }

  if (!ready) return <div className="kiosk-root" />;

  // Термінал не спарований: єдиний екран, де просять код, і єдиний, де немає
  // ні гостя, ні таймера.
  if (!token) {
    return (
      <div className="kiosk-root" onPointerDown={() => setIdle(false)}>
        <div className="kiosk-top"><h1 className="kiosk-title">ALiSiO</h1></div>
        <div className="kiosk-band" style={band}>
          <div className="kiosk-field">
            <span className="kiosk-label">Code</span>
            <div className="kiosk-value" data-active="true">{pairCode}</div>
          </div>
          <Keyboard
            mode="digits"
            onKey={(ch) => setPairCode((v) => (v + ch).slice(0, 6))}
            onBackspace={() => setPairCode((v) => v.slice(0, -1))}
            onDone={doPair}
            doneLabel="OK"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-root" data-step={step} onPointerDown={() => { touch(); setIdle(false); }}>
      {/*
        Фон — фотографія САМОГО готелю з налаштувань термінала, не картинка в
        коді (інваріант 20): у сусіднього готелю свій хол. Немає адреси —
        лишається тепла заливка, і екран виглядає закінченим, а не зламаним.
        Затемнення окремим шаром: на світлому знімку холу білий напис зникає.
      */}
      {step === 'start' && (
        <div className="kiosk-backdrop">
          {session?.backgroundUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.backgroundUrl} alt="" className="kiosk-backdrop-img" />
          )}
          <div className="kiosk-scrim" />
        </div>
      )}

      <div className="kiosk-top">
        {step === 'start' ? (
          <>
            {session?.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={session.logoUrl} alt={session.property.name} className="kiosk-logo" />
              : <p className="kiosk-house">{session?.property.name ?? ''}</p>}
            <h1 className="kiosk-hero">{s.welcome}</h1>
          </>
        ) : (
          <div className="kiosk-bar">
            {/*
              Вихід із кроку. До цього його не було ЗОВСІМ: гість, який зайшов
              у пошук помилково, не мав як повернутись — лишалось чекати 60 с
              таймера або кликати рецепцію. Хрестик у шапці, а не в робочій
              смузі: смуга належить головній дії кроку.
            */}
            <button type="button" className="kiosk-close" onClick={wrap(forget)} aria-label={s.cancel}>
              ✕
            </button>
            <h1 className="kiosk-title">
              {step === 'lookup' || step === 'find' ? s.lookupTitle : session?.property.name ?? ''}
            </h1>
            <span className="kiosk-bar-tail" />
          </div>
        )}
        {stay && step !== 'start' && (
          <p className="kiosk-subtitle">{stay.guest} · {stay.checkIn} → {stay.checkOut}</p>
        )}
        {/*
          Мова — дві кнопки, не список, що розкривається: мов рівно дві, і
          випадайка коштувала б гостю зайвого дотику заради того самого.
          Прапорців немає навмисно: у Windows немає шрифту з прапорцями
          взагалі, і 🇬🇧 показався б там як літери «GB».
        */}
        <div className="kiosk-langs">
          {KIOSK_LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className="kiosk-lang"
              data-on={lang === code}
              onClick={wrap(() => setLang(kioskLang(code)))}
            >
              {KIOSK_LANG_LABELS[code]}
            </button>
          ))}
        </div>
      </div>

      <div className="kiosk-band" style={band}>
        {step === 'start' && (
          // Три дії в РЯД, а не стовпчиком: заїзд і виїзд рівноцінні, і
          // стовпчик робив би верхню кнопку «головною» самим порядком. Walk-in
          // лишається під ними окремим рядком — це дія для того, хто ще НЕ
          // гість, і в одному ряду з «виселитись» вона читалась би як рівна.
          <>
            <div className="kiosk-cards">
              <button type="button" className="kiosk-card" onClick={wrap(() => setStep('lookup'))}>
                <IconArrive />
                <span className="kiosk-card-label">{s.checkIn}</span>
              </button>
              <button type="button" className="kiosk-card" onClick={wrap(() => setStep('info'))}>
                <IconExtras />
                <span className="kiosk-card-label">{s.extras}</span>
              </button>
              <button type="button" className="kiosk-card" onClick={wrap(() => { setStep('lookup'); setMessage(null); })}>
                <IconDepart />
                <span className="kiosk-card-label">{s.checkOut}</span>
              </button>
            </div>
            {session?.walkinUrl && (
              <button type="button" className="kiosk-quiet" onClick={wrap(() => setStep('walkin'))}>
                {s.bookNow} ›
              </button>
            )}
          </>
        )}

        {step === 'lookup' && (
          // Спосіб обирають ДО того, як щось набирають. Один екран із трьома
          // полями означав би «заповніть усе», а треба рівно два чинники — і
          // саме те, що гість має при собі: лист із номером АБО спогад про
          // дату заїзду.
          <div className="kiosk-lookup">
            <p className="kiosk-lead">{s.lookupLead}</p>
            <div className="kiosk-tiles">
              <button
                type="button"
                className="kiosk-tile"
                onClick={wrap(() => { setFindBy('date'); setActive('lastName'); setStep('find'); })}
              >
                <IconCalendar />
                <span className="kiosk-tile-title">{s.byDate}</span>
                <span className="kiosk-tile-help">{s.byDateHelp}</span>
              </button>
              <button
                type="button"
                className="kiosk-tile"
                onClick={wrap(() => { setFindBy('confirmation'); setActive('lastName'); setStep('find'); })}
              >
                <IconTicket />
                <span className="kiosk-tile-title">{s.byConfirmation}</span>
                <span className="kiosk-tile-help">{s.byConfirmationHelp}</span>
              </button>
              <button type="button" className="kiosk-tile" disabled>
                <IconQr />
                <span className="kiosk-tile-title">{s.byQr}</span>
                <span className="kiosk-tile-help">{s.byQrHelp}</span>
              </button>
            </div>
          </div>
        )}

        {step === 'find' && (
          <>
            {/*
              Календар займає смугу ЦІЛКОМ, а не тулиться під поля.
              Виміряно на 1080×1920: разом із двома полями і клавіатурою його
              шість тижнів не вміщаються — останній ряд обрізало, а «Zurück»
              виїжджав за низ смуги під кнопку рецепції. Той самий клас, що
              смуга 55–88 % у рецензії Б: вміст, більший за смугу, на цьому
              екрані ніхто не прокручує.

              Тому вибір дня — окремий вигляд того самого кроку: заголовок
              каже, що саме обирають, а поля повертаються разом із «Zurück».
            */}
            {pickingDate ? (
              <>
                <span className="kiosk-label">{s.arrivalDate}</span>
                <KioskCalendar
                  value={fields.checkIn || null}
                  today={today}
                  lang={lang}
                  onPick={(date) => {
                    touch();
                    setFields((f) => ({ ...f, checkIn: date }));
                    setPickingDate(false);
                  }}
                />
                <button type="button" className="kiosk-slim" onClick={wrap(() => setPickingDate(false))}>
                  {s.back}
                </button>
              </>
            ) : (
              <>
                <div className="kiosk-field">
                  <span className="kiosk-label">{s.lastName}</span>
                  <div
                    className="kiosk-value"
                    data-active={active === 'lastName'}
                    onClick={wrap(() => setActive('lastName'))}
                  >
                    {fields.lastName}
                  </div>
                </div>
                {findBy === 'date' ? (
                  <div className="kiosk-field">
                    <span className="kiosk-label">{s.arrivalDate}</span>
                    {/*
                      Поле ДАТИ не набирається: дотик відкриває календар. Порожнє
                      поле каже про це словами, а не лишається мовчазним
                      прямокутником, у який гість друкує навмання.
                    */}
                    <div className="kiosk-value" onClick={wrap(() => setPickingDate(true))}>
                      {fields.checkIn
                        ? formatDay(fields.checkIn, lang)
                        : <span className="kiosk-placeholder">{s.pickDate}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="kiosk-field">
                    <span className="kiosk-label">{s.confirmationNo}</span>
                    <div
                      className="kiosk-value"
                      data-active={active === 'confirmation'}
                      onClick={wrap(() => setActive('confirmation'))}
                    >
                      {fields.confirmation}
                    </div>
                  </div>
                )}
                {message && <p className="kiosk-note">{message}</p>}
                {/*
                  Розкладка йде за ПОЛЕМ, а не за кроком: прізвище — літери,
                  номер броні — цифри. Номер у листі готелю числовий (свій id,
                  номер онлайн-модуля, код каналу), і QWERTZ під ним означав би,
                  що гість шукає цифри між літерами на 86-дюймовому екрані.
                */}
                <Keyboard
                  mode={active === 'confirmation' ? 'digits' : 'text'}
                  onKey={(ch) => { touch(); type(ch); }}
                  onBackspace={() => { touch(); backspace(); }}
                  onDone={() => { touch(); void doFind(); }}
                  doneLabel={s.next}
                />
              </>
            )}
          </>
        )}

        {step === 'stay' && stay && (
          <div className="kiosk-choice">
            <p className="kiosk-note">{s.paymentLater}</p>
            <button type="button" className="kiosk-big" data-primary="true" onClick={wrap(() => void doCheckIn())}>
              {s.checkIn}
            </button>
            <button type="button" className="kiosk-big" onClick={wrap(() => void doCheckOut())}>{s.checkOut}</button>
            <button type="button" className="kiosk-big" onClick={wrap(forget)}>{s.cancel}</button>
          </div>
        )}

        {step === 'key' && (
          <div className="kiosk-choice">
            <span className="kiosk-label">{s.yourRoom}</span>
            <div className="kiosk-strong">{key?.unitName ?? '—'}</div>
            {key?.lockCode && (
              <>
                <span className="kiosk-label">{s.lockCode}</span>
                <div className="kiosk-strong">{key.lockCode}</div>
              </>
            )}
            {key?.wifi && (
              <p className="kiosk-note">{s.wifi}: {key.wifi.network} · {s.wifiPassword}: {key.wifi.password ?? '—'}</p>
            )}
            <button type="button" className="kiosk-big" onClick={wrap(forget)}>{s.done}</button>
          </div>
        )}

        {step === 'done' && (
          <div className="kiosk-choice">
            <p className="kiosk-note">{message ?? s.thankYou}</p>
            <button type="button" className="kiosk-big" onClick={wrap(forget)}>{s.done}</button>
          </div>
        )}

        {step === 'info' && (
          <div className="kiosk-choice">
            <p className="kiosk-note">{s.info}</p>
            <button type="button" className="kiosk-big" onClick={wrap(forget)}>{s.back}</button>
          </div>
        )}

        {step === 'walkin' && session?.walkinUrl && (
          <div className="kiosk-choice">
            {/*
              Окрема сторінка, не рамка: онлайн-модуль готелю віддає
              `X-Frame-Options: DENY` і в iframe не вбудовується (КІ8).
              Повернення й таймер на ній тримає розширення оболонки
              (`apps/kiosk-shell/`), бо це вже чужий сайт.
            */}
            <a className="kiosk-big" data-primary="true" href={session.walkinUrl}>{s.walkinOpen}</a>
            <button type="button" className="kiosk-big" onClick={wrap(() => setStep('find'))}>{s.justBooked}</button>
            <button type="button" className="kiosk-big" onClick={wrap(forget)}>{s.back}</button>
          </div>
        )}
      </div>

      {/* Рецепція — на кожному екрані (КІ9), і телефон приходить із бази. */}
      <div className="kiosk-reception">
        {info?.reception.phone && <a href={`tel:${info.reception.phone}`}>{s.callReception}</a>}
        {info?.reception.whatsapp && (
          <a href={`https://wa.me/${info.reception.whatsapp.replace(/\D/g, '')}`}>{s.whatsapp}</a>
        )}
      </div>

      {idle && (
        <div className="kiosk-idle" onPointerDown={() => { touch(); setIdle(false); }}>
          <p className="kiosk-title">{s.idleWarning}</p>
          <p className="kiosk-note">{s.idleTitle}</p>
        </div>
      )}
    </div>
  );
}
