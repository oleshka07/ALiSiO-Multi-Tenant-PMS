'use client';

/**
 * Розвилка, з якої починається все: є бронювання чи немає.
 *
 * Питання ставиться ПЕРШИМ і одне. Гість щойно сканував наліпку на склі, у
 * нього валіза в одній руці й телефон у другій — екран, який одразу питає
 * прізвище, змушує його вирішити, чи він узагалі там, куди йому треба.
 *
 * Обидві відповіді ведуть в одне й те саме місце — заїзд; різниця в тому, чи
 * бронювання треба спершу створити. Тому це дві рівні картки, а не «головна
 * дія і посилання дрібним шрифтом».
 */

import { useEffect, useState } from 'react';
import {
  GUEST_LANGS, GUEST_LANG_LABELS, GUEST_STRINGS, guestLang, type GuestLang,
} from './translations';
import { GuestStay } from './GuestStay';

const LANG_KEY = 'alisio.guest.lang';

type Step = 'home' | 'find' | 'stay';

export function GuestHome({ propertyName, appKey, initialLang }: {
  propertyName: string;
  /** Ключ із адреси — його ж маршрут пошуку чекає в тілі (інваріант 8). */
  appKey: string;
  /** Мова з `Accept-Language`, вирішена на СЕРВЕРІ — щоб перший екран не блимав. */
  initialLang: GuestLang;
}) {
  const [lang, setLang] = useState<GuestLang>(initialLang);
  const [step, setStep] = useState<Step>('home');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Вибір гостя перемагає пристрій — але читається вже після гідратації, тож
  // ЩЕ раз, і лише якщо він є. На телефоні це чесно: наступний відвідувач
  // цього браузера — той самий чоловік (КІ20).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved) setLang(guestLang(saved));
    } catch {
      // Приватне вікно або вимкнені дані сайту — лишається мова пристрою.
    }
  }, []);

  const choose = (code: GuestLang) => {
    setLang(code);
    try { window.localStorage.setItem(LANG_KEY, code); } catch { /* див. вище */ }
  };

  const s = GUEST_STRINGS[lang];

  /**
   * Пошук своєї броні.
   *
   * Відповідь маршруту навмисно бідна — `{ found, token }` і не більше, — тож
   * екран не має що показати, крім переходу або речення. Саме так і треба:
   * усе, що приїхало в браузер, уже видно тому, хто дивиться через плече.
   */
  async function doFind() {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch('/api/apps/guest/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: appKey, phone, name }),
      });
      if (res.status === 429) { setMessage(s.tooMany); return; }
      const body = await res.json().catch(() => ({})) as { found?: boolean; token?: string; reason?: string };
      if (body.found && body.token) {
        // Гостьова сторінка вже вміє реєстрацію, документ, згоди й Meldeschein —
        // другого заселення в продукті не заводиться.
        window.location.href = `/guest/${body.token}`;
        return;
      }
      setMessage(body.reason === 'no_page' ? s.noPage : s.notFound);
    } catch {
      // Мережа впала — те саме речення, що й «не знайшли»: гостю однаково
      // робити одне й те саме, а різниця нічого йому не додає.
      setMessage(s.notFound);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="guest-root" data-step={step}>
      <header className="guest-top">
        <p className="guest-house">{propertyName}</p>
        <h1 className="guest-welcome">
          {step === 'find' ? s.findTitle : step === 'stay' ? s.stayTitle : s.welcome}
        </h1>
        {step === 'home' && <p className="guest-lead">{s.lead}</p>}
        {/*
          Перемикач мови стоїть ЛИШЕ на перших двох екранах (КІ20): далі гість
          уже в потоці з набраними даними, і мову там міняють не «бо
          захотілось», а бо помилились на початку.
        */}
        {/*
          Перемикач — на перших двох екранах (КІ20): розвилка і перший екран
          обраної гілки. Далі гість уже набирає дані, і мову там міняють не
          «бо захотілось», а бо помилились на початку — тоді є «назад».
        */}
        {step !== 'stay' && <div className="guest-langs">
          {GUEST_LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className="guest-lang"
              data-on={lang === code}
              onClick={() => choose(code)}
            >
              {GUEST_LANG_LABELS[code]}
            </button>
          ))}
        </div>}
      </header>

      {step === 'home' && (
        <>
          <div className="guest-cards">
            <button
              type="button"
              className="guest-card"
              data-primary="true"
              onClick={() => { setStep('find'); setMessage(null); }}
            >
              <span className="guest-card-title">{s.haveBooking}</span>
              <span className="guest-card-help">{s.haveBookingHelp}</span>
            </button>
            <button
              type="button"
              className="guest-card"
              onClick={() => { setStep('stay'); setMessage(null); }}
            >
              <span className="guest-card-title">{s.noBooking}</span>
              <span className="guest-card-help">{s.noBookingHelp}</span>
            </button>
          </div>
        </>
      )}

      {step === 'stay' && (
        <GuestStay appKey={appKey} lang={lang} onBack={() => setStep('home')} />
      )}

      {step === 'find' && (
        <form
          className="guest-form"
          onSubmit={(e) => { e.preventDefault(); void doFind(); }}
        >
          <p className="guest-lead">{s.findLead}</p>
          <label className="guest-field">
            <span className="guest-label">{s.phone}</span>
            {/* `tel` — щоб телефон відкрив цифрову клавіатуру, а не літери. */}
            <input
              className="guest-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="guest-field">
            <span className="guest-label">{s.guestName}</span>
            <input
              className="guest-input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {message && <p className="guest-note" role="status">{message}</p>}
          <button type="submit" className="guest-card" data-primary="true" disabled={busy}>
            <span className="guest-card-title">{busy ? s.searching : s.continue}</span>
          </button>
          <button
            type="button"
            className="guest-quiet"
            onClick={() => { setStep('home'); setMessage(null); }}
          >
            {s.back}
          </button>
        </form>
      )}
    </main>
  );
}
