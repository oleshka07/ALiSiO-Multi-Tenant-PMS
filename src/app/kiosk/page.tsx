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
import { Signature } from '@/apps/kiosk/ui/Signature';
import { bandStyle, useDeviceToken, useIdleReset } from '@/apps/kiosk/ui/useKiosk';
import {
  KIOSK_LANGS, KIOSK_LANG_LABELS, KIOSK_STRINGS, kioskLang, refusalText, type KioskLang,
} from '@/apps/kiosk/ui/translations';

type Step =
  | 'start' | 'pair' | 'lookup' | 'qr' | 'find' | 'stay' | 'register' | 'sign'
  | 'key' | 'done' | 'info' | 'walkin' | 'claim';

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
  /** Скільки дорослих у броні — стільки й треба вписати, щоб стан став «registered». */
  adults: number;
}

/**
 * Картка перебування — те, чого НЕ видно з пошуку: хто вже вписаний, чи
 * потрібен підпис, чи він уже стоїть.
 *
 * Читається окремим кроком (`stay`), а не вгадується з відповіді пошуку:
 * рішення про підпис ухвалює СЕРВЕР за політикою обʼєкта поверх громадянства
 * (`signatureNeeded`, 0413), і другий примірник цього правила на екрані
 * розійшовся б із першим при першій же правці.
 */
interface StayCard {
  guests: { name: string; nationality: string | null; hasDocument: boolean }[];
  signatureNeeded: boolean;
  signed: boolean;
  earliestCheckIn: string | null;
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
  // Картка перебування — окремим читанням (`stay`), бо рішення про підпис
  // ухвалює СЕРВЕР, а не екран.
  const [card, setCard] = useState<StayCard | null>(null);
  // Один гість за прохід: форма на чотирьох одразу не вміщається в смугу, а
  // гість вписує сімʼю по черзі і бачить, кого вже вписав.
  const [person, setPerson] = useState({ firstName: '', lastName: '', nationality: '' });
  // Накопичувача вписаних гостей тут НЕМАЄ, і це навмисно.
  //
  // Він тут був: екран тримав список у React-стані і слав його цілком, бо
  // `saveRegistrations` замінює склад броні (`DELETE` і заново). Працювало
  // рівно доти, доки гість не відходив від термінала: скидання за
  // бездіяльністю (60 с) чистить стан, і другий натиск стирав першого
  // гостя — обидві відповіді `ok`, бронь не зареєстрована ніколи.
  //
  // Памʼять тепер у базі: маршрут `register` ДОПИСУЄ (`mergeParty`, сцена
  // 29), а скільки вже вписано — каже сервер у картці (`card.guests`).
  const [personField, setPersonField] = useState<'firstName' | 'lastName' | 'nationality'>('firstName');
  // «Щойно забронював» (К8): прізвище, номер підтвердження, дата заїзду.
  const [claim, setClaim] = useState({ lastName: '', confirmation: '', checkIn: '' });
  const [claimField, setClaimField] = useState<'lastName' | 'confirmation'>('lastName');
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
    setCard(null);
    setPerson({ firstName: '', lastName: '', nationality: '' });
    setPersonField('firstName');
    setClaim({ lastName: '', confirmation: '', checkIn: '' });
    setClaimField('lastName');
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
    const found = answer.body.stay as Stay;
    setStay(found);
    setCard(null);
    void loadCard(found.reservationId);
    setStep('stay');
  }

  /**
   * Картка перебування: хто вже вписаний і чи треба підпис.
   *
   * Кличеться одразу після пошуку. Саме звідси екран дізнається про підпис —
   * рішення ухвалює сервер (політика обʼєкта поверх громадянства), екран лише
   * показує.
   */
  async function loadCard(reservationId: string) {
    const answer = await call('stay', { reservationId });
    if (answer?.ok) setCard(answer.body as StayCard);
  }

  /**
   * Вписати ОДНОГО гостя. Реєстрація — закон (Meldeschein), не зручність.
   *
   * Їде рівно той, кого набрали: дописування — справа маршруту, який читає
   * уже збережених і зливає їх із новим (`mergeParty`). Маскованих імен із
   * картки сюди підмішати не можна — сервер віддає «A… B…», і воно лягло б у
   * базу замість прізвища; саме тому склад тримає СЕРВЕР, а не екран.
   *
   * Куди далі — каже теж сервер: доки склад неповний, форма лишається
   * порожньою під наступного; щойно бронь стала `registered`, екран вертає
   * гостя на картку, де вже стоїть підпис або заселення. Форма, на якій
   * гість лишається після останнього гостя, — це глухий кут у холі, де
   * немає кому підказати, що робити далі.
   */
  async function doRegister() {
    if (!stay) return;
    setMessage(null);
    const current = {
      firstName: person.firstName.trim(),
      lastName: person.lastName.trim(),
      nationality: person.nationality.trim(),
    };
    if (!current.firstName || !current.lastName) { setMessage(s.needFactors); return; }
    const answer = await call('register', {
      reservationId: stay.reservationId,
      guests: [{
        firstName: current.firstName,
        lastName: current.lastName,
        nationality: current.nationality || null,
      }],
    });
    if (!answer?.ok) { setMessage(s.notFoundHelp); return; }
    setPerson({ firstName: '', lastName: '', nationality: '' });
    setPersonField('firstName');
    // Бронь перечитується: саме сервер знає, чи склад повний.
    const again = await call('find', {
      lastName: fields.lastName || undefined,
      checkIn: findBy === 'date' ? (fields.checkIn || undefined) : undefined,
      confirmation: findBy === 'confirmation' ? (fields.confirmation || undefined) : undefined,
    });
    const now = again?.ok && again.body?.found ? (again.body.stay as Stay) : null;
    if (now) setStay(now);
    await loadCard(stay.reservationId);
    if (now?.registered) { setMessage(null); setStep('stay'); return; }
    setMessage(s.registerDone);
  }

  /** Підпис пальцем під Meldeschein — лише там, де його вимагає політика. */
  async function doSign(pngDataUrl: string) {
    if (!stay) return;
    const answer = await call('sign', { reservationId: stay.reservationId, signaturePng: pngDataUrl });
    if (!answer?.ok) { setMessage(refusalText(lang, answer?.body?.error)); return; }
    await loadCard(stay.reservationId);
    setStep('stay');
  }

  /**
   * «Ich habe gerade gebucht» (К8): попередня бронь за номером підтвердження
   * з чужого модуля. Без номера сервер відмовляє — дельті не буде за чим
   * привʼязатись, і за чверть години в базі будуть ДВІ броні на одне
   * перебування.
   */
  async function doClaim() {
    setMessage(null);
    const answer = await call('walkin', {
      lastName: claim.lastName.trim(),
      confirmation: claim.confirmation.trim(),
      checkIn: claim.checkIn,
    });
    if (!answer?.ok) { setMessage(s.needFactors); return; }
    setMessage(s.claimSaved);
    setFindBy('confirmation');
    setFields((f) => ({ ...f, lastName: claim.lastName, confirmation: claim.confirmation }));
    setStep('find');
  }

  async function doCheckIn() {
    if (!stay) return;
    setMessage(null);
    const answer = await call('checkin', { reservationId: stay.reservationId });
    // Відмова — РЕЧЕННЯМ, і тим, що пояснює саме цю відмову.
    //
    // Тут стояло одне «зверніться на рецепцію» на всі випадки, а сама
    // картка повідомлення взагалі не показувала: готель, який роздає номери
    // руками, віддає `no_unit` 409-ю — і гість бачив, що кнопка не працює.
    // Код фасаду сам по собі на екран не їде ніколи (інваріант 6).
    if (!answer?.ok) {
      setMessage(refusalText(lang, answer?.body?.error, answer?.body?.earliestCheckIn));
      return;
    }
    setKey(answer.body);
    setStep('key');
  }

  async function doCheckOut() {
    if (!stay) return;
    const answer = await call('checkout', { reservationId: stay.reservationId });
    if (!answer?.ok) { setMessage(refusalText(lang, answer?.body?.error)); return; }
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
              {step === 'qr' ? s.qrTitle
                : step === 'register' ? s.registerTitle
                  : step === 'sign' ? s.signTitle
                    : step === 'claim' ? s.claimTitle
                      : (step === 'lookup' || step === 'find' ? s.lookupTitle : session?.property.name ?? '')}
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
              <button type="button" className="kiosk-tile" onClick={wrap(() => setStep('qr'))}>
                <IconQr />
                <span className="kiosk-tile-title">{s.byQr}</span>
                <span className="kiosk-tile-help">{s.byQrHelp}</span>
              </button>
            </div>
          </div>
        )}

        {step === 'qr' && (
          // ЗАГЛУШКА, і названа такою вголос.
          //
          // Адреси, на яку веде цей код, ще немає: сторінка для телефона буде
          // окремим модулем, і маршрут до неї дасть власник. Тому тут поки
          // МІСЦЕ під код, а не сам код: намальований QR, що веде в нікуди,
          // гірший за його відсутність — гість у холі сканує його телефоном і
          // отримує 404, і це виглядає як зламаний готель, а не як
          // недороблена функція.
          //
          // Коли маршрут буде названий, міняється рівно це місце: сюди стає
          // `<img src={qr.image}>` з намальованим кодом.
          <div className="kiosk-choice">
            <div className="kiosk-qr-slot" aria-hidden="true"><IconQr /></div>
            <p className="kiosk-note">{s.qrSoon}</p>
            <button type="button" className="kiosk-big" data-primary="true" onClick={wrap(() => setStep('lookup'))}>
              {s.back}
            </button>
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
            {/*
              Відповідь сервера ЗАМІСТЬ загального рядка про оплату: на цьому
              кроці гість щойно щось натиснув, і те, чому воно не спрацювало,
              важливіше за нагадування, яке він уже прочитав. Без цього рядка
              відмова заселення не доходила до екрана взагалі.
            */}
            <p className="kiosk-note">{message ?? s.paymentLater}</p>
            {/*
              Порядок кроків тут не косметичний. Заселення фасад відхиляє, поки
              бронь не зареєстрована (`not_registered`), а підпис вимагає
              політика обʼєкта поверх громадянства. Доки екран не пропонував ні
              того, ні того, гість натискав «Check-in» і читав «зверніться на
              рецепцію» — тобто термінал був марний рівно для тих, заради кого
              стоїть. Тому кнопка веде на те, чого бракує САМЕ ЗАРАЗ.
            */}
            {!stay.registered ? (
              <button type="button" className="kiosk-big" data-primary="true" onClick={wrap(() => setStep('register'))}>
                {s.registerTitle}
              </button>
            ) : card?.signatureNeeded && !card.signed ? (
              <button type="button" className="kiosk-big" data-primary="true" onClick={wrap(() => setStep('sign'))}>
                {s.signTitle}
              </button>
            ) : (
              <button type="button" className="kiosk-big" data-primary="true" onClick={wrap(() => void doCheckIn())}>
                {s.checkIn}
              </button>
            )}
            {card && card.guests.length > 0 && (
              <p className="kiosk-note">{s.registered}: {card.guests.map((g) => g.name).join(' · ')}</p>
            )}
            <button type="button" className="kiosk-big" onClick={wrap(() => void doCheckOut())}>{s.checkOut}</button>
            <button type="button" className="kiosk-big" onClick={wrap(forget)}>{s.cancel}</button>
          </div>
        )}

        {step === 'register' && stay && (
          <>
            {/*
              Пояснення АБО відповідь, не обидва: разом вони давали два рядки
              там, де смуга має один, і форма виїжджала за низ рівно тоді,
              коли гість уже щось зробив. Відповідь сервера важливіша — вона
              про останній натиск, а пояснення гість уже прочитав.
            */}
            <p className="kiosk-note">
              {message ?? s.registerLead}{' '}
              {(card?.guests.length ?? 0) > 0 && `${card?.guests.length}/${stay.adults}`}
            </p>
            {(['firstName', 'lastName', 'nationality'] as const).map((f) => (
              <div className="kiosk-field" key={f}>
                <span className="kiosk-label">
                  {f === 'firstName' ? s.firstName : f === 'lastName' ? s.lastName : s.nationality}
                </span>
                <div
                  className="kiosk-value"
                  data-active={personField === f}
                  onClick={wrap(() => setPersonField(f))}
                >
                  {person[f]}
                </div>
              </div>
            ))}
            <Keyboard
              mode="text"
              onKey={(ch) => { touch(); setPerson((v) => ({ ...v, [personField]: v[personField] + ch })); }}
              onBackspace={() => { touch(); setPerson((v) => ({ ...v, [personField]: v[personField].slice(0, -1) })); }}
              onDone={() => { touch(); void doRegister(); }}
              doneLabel={s.addGuest}
            />
            <button type="button" className="kiosk-slim" onClick={wrap(() => setStep('stay'))}>{s.back}</button>
          </>
        )}

        {step === 'sign' && stay && (
          <div className="kiosk-choice">
            <Signature
              hint={s.signHelp}
              clearLabel={s.clearSignature}
              doneLabel={s.next}
              onDone={(png) => { touch(); void doSign(png); }}
            />
            <button type="button" className="kiosk-slim" onClick={wrap(() => setStep('stay'))}>{s.back}</button>
          </div>
        )}

        {step === 'claim' && (
          <>
            <p className="kiosk-note">{s.claimLead}</p>
            <div className="kiosk-field">
              <span className="kiosk-label">{s.lastName}</span>
              <div className="kiosk-value" data-active={claimField === 'lastName'} onClick={wrap(() => setClaimField('lastName'))}>
                {claim.lastName}
              </div>
            </div>
            <div className="kiosk-field">
              <span className="kiosk-label">{s.confirmationNo}</span>
              <div className="kiosk-value" data-active={claimField === 'confirmation'} onClick={wrap(() => setClaimField('confirmation'))}>
                {claim.confirmation}
              </div>
            </div>
            <div className="kiosk-field">
              <span className="kiosk-label">{s.arrivalDate}</span>
              <div className="kiosk-value" onClick={wrap(() => setPickingDate(true))}>
                {claim.checkIn
                  ? formatDay(claim.checkIn, lang)
                  : <span className="kiosk-placeholder">{s.pickDate}</span>}
              </div>
            </div>
            {message && <p className="kiosk-note">{message}</p>}
            {pickingDate ? (
              <>
                <KioskCalendar
                  value={claim.checkIn || null}
                  today={today}
                  lang={lang}
                  onPick={(d) => { touch(); setClaim((v) => ({ ...v, checkIn: d })); setPickingDate(false); }}
                />
                <button type="button" className="kiosk-slim" onClick={wrap(() => setPickingDate(false))}>{s.back}</button>
              </>
            ) : (
              <Keyboard
                mode={claimField === 'confirmation' ? 'digits' : 'text'}
                onKey={(ch) => { touch(); setClaim((v) => ({ ...v, [claimField]: v[claimField] + ch })); }}
                onBackspace={() => { touch(); setClaim((v) => ({ ...v, [claimField]: v[claimField].slice(0, -1) })); }}
                onDone={() => { touch(); void doClaim(); }}
                doneLabel={s.next}
              />
            )}
          </>
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
            <button type="button" className="kiosk-big" onClick={wrap(() => { setMessage(null); setStep('claim'); })}>
              {s.justBooked}
            </button>
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
