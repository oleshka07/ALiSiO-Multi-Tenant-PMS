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
import { Keyboard, type KeyboardMode } from '@/apps/kiosk/ui/Keyboard';
import { bandStyle, useDeviceToken, useIdleReset } from '@/apps/kiosk/ui/useKiosk';
import {
  KIOSK_LANGS, KIOSK_LANG_LABELS, KIOSK_STRINGS, kioskLang, type KioskLang,
} from '@/apps/kiosk/ui/translations';

type Step =
  | 'start' | 'pair' | 'find' | 'stay' | 'sign' | 'payment' | 'key'
  | 'checkout' | 'done' | 'info' | 'walkin';

interface Session {
  property: { id: string; name: string };
  checkinPaymentPolicy: string;
  systemOfRecord: string;
  walkinUrl: string | null;
  touchBand: { top: number; bottom: number };
}

interface Stay {
  reservationId: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  unitName: string | null;
  registered: boolean;
}

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
  const [active, setActive] = useState<'lastName' | 'checkIn' | 'confirmation'>('lastName');
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
    const answer = await call('find', {
      lastName: fields.lastName || undefined,
      checkIn: fields.checkIn || undefined,
      confirmation: fields.confirmation || undefined,
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
    <div className="kiosk-root" onPointerDown={() => { touch(); setIdle(false); }}>
      <div className="kiosk-top">
        <h1 className="kiosk-title">
          {step === 'start' ? s.welcome : session?.property.name ?? ''}
        </h1>
        {step === 'start' && <p className="kiosk-subtitle">{session?.property.name ?? ''}</p>}
        {stay && step !== 'start' && (
          <p className="kiosk-subtitle">{stay.guest} · {stay.checkIn} → {stay.checkOut}</p>
        )}
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
          <div className="kiosk-choice">
            <button type="button" className="kiosk-big" data-primary="true" onClick={wrap(() => setStep('find'))}>
              {s.checkIn}
            </button>
            <button type="button" className="kiosk-big" onClick={wrap(() => { setStep('find'); setMessage(null); })}>
              {s.checkOut}
            </button>
            <button type="button" className="kiosk-big" onClick={wrap(() => setStep('info'))}>{s.info}</button>
            {session?.walkinUrl && (
              <button type="button" className="kiosk-big" onClick={wrap(() => setStep('walkin'))}>{s.bookNow}</button>
            )}
          </div>
        )}

        {step === 'find' && (
          <>
            <div className="kiosk-field">
              <span className="kiosk-label">{s.lastName}</span>
              <div className="kiosk-value" data-active={active === 'lastName'} onClick={wrap(() => setActive('lastName'))}>
                {fields.lastName}
              </div>
            </div>
            <div className="kiosk-field">
              <span className="kiosk-label">{s.arrivalDate}</span>
              <div className="kiosk-value" data-active={active === 'checkIn'} onClick={wrap(() => setActive('checkIn'))}>
                {fields.checkIn}
              </div>
            </div>
            {message && <p className="kiosk-note">{message}</p>}
            <Keyboard
              mode={(active === 'lastName' ? 'text' : 'digits') as KeyboardMode}
              onKey={(ch) => { touch(); type(ch); }}
              onBackspace={() => { touch(); backspace(); }}
              onDone={() => { touch(); void doFind(); }}
              doneLabel={s.next}
            />
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
