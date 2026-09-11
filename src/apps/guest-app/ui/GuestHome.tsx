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

const LANG_KEY = 'alisio.guest.lang';

export function GuestHome({ propertyName, initialLang }: {
  propertyName: string;
  /** Мова з `Accept-Language`, вирішена на СЕРВЕРІ — щоб перший екран не блимав. */
  initialLang: GuestLang;
}) {
  const [lang, setLang] = useState<GuestLang>(initialLang);

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

  return (
    <main className="guest-root" data-step="home">
      <header className="guest-top">
        <p className="guest-house">{propertyName}</p>
        <h1 className="guest-welcome">{s.welcome}</h1>
        <p className="guest-lead">{s.lead}</p>
        {/*
          Перемикач мови стоїть ЛИШЕ на перших двох екранах (КІ20): далі гість
          уже в потоці з набраними даними, і мову там міняють не «бо
          захотілось», а бо помилились на початку.
        */}
        <div className="guest-langs">
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
        </div>
      </header>

      <div className="guest-cards">
        <button type="button" className="guest-card" data-primary="true" disabled>
          <span className="guest-card-title">{s.haveBooking}</span>
          <span className="guest-card-help">{s.haveBookingHelp}</span>
        </button>
        <button type="button" className="guest-card" disabled>
          <span className="guest-card-title">{s.noBooking}</span>
          <span className="guest-card-help">{s.noBookingHelp}</span>
        </button>
      </div>

      {/*
        Обидві картки поки неактивні, і екран каже це СЛОВАМИ. Кнопка, яка
        виглядає робочою і нічого не робить, — це той самий рід, що
        намальований QR у нікуди: гість вирішує, що зламаний готель, а не що
        функція ще не дороблена.
      */}
      <p className="guest-note">{s.soon}</p>
    </main>
  );
}
