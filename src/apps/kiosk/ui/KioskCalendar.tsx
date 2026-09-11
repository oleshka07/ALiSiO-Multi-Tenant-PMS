'use client';

/**
 * Дату заїзду ОБИРАЮТЬ, а не набирають.
 *
 * ── Чому поля з клавіатурою тут не досить ───────────────────────────────
 *
 * Форма дати не вгадується. Німець пише `11.09.2026`, англієць `11/09/2026`,
 * американець `09/11/2026` — і всі троє мають рацію, бо екран не сказав їм
 * форми. Сервер читає рівно `YYYY-MM-DD`, тож будь-який із трьох дає «броні
 * не знайдено»; а до правки 11.09.2026 він ще й падав 500 на `Invalid Date`,
 * і гість ішов до рецепції переконаний, що його броні немає (сцена 24).
 *
 * Календар прибирає питання разом із формою: натиснув число — і те, що
 * поїхало на сервер, за побудовою вже `YYYY-MM-DD`. Набрати тут не можна
 * НІЧОГО, тому й помилитись формою — теж.
 *
 * ── Скільки місяців показувати ──────────────────────────────────────────
 *
 * Відкривається на ПОТОЧНОМУ місяці, і далі ±1 місяць — не більше.
 *
 * Термінал бачить лише перебування у вікні «сьогодні ± доба» (`inWindow`),
 * але дата в пошуку — це дата ЗАЇЗДУ, і вона цілком може бути давньою: гість,
 * який виїжджає сьогодні, заїхав тиждень тому і назве саме той день. Тому
 * місяць, а не три дні. А сусідні два — для перебування, що лежить через межу
 * місяця: заїзд 29 серпня, виїзд 2 вересня.
 *
 * Далі — ні: бронь на грудень на цьому екрані не існує, і показувати грудень
 * означало б обіцяти гостю пошук, який за побудовою нічого не знайде.
 *
 * ── Мова ────────────────────────────────────────────────────────────────
 *
 * Назви місяця й днів тижня бере `Intl`, за мовою, яку гість обрав кнопкою на
 * екрані, — не `t()` (інваріант 19: тут читає гість, не оператор) і не свій
 * список назв, який розійшовся б із рештою екрана на першій новій мові.
 *
 * Тиждень починається з понеділка: готель у DE/CZ-юрисдикції, і неділя першою
 * зсуває весь місяць на клітинку — гість тицяє в сусідній день.
 */

import { useMemo, useState } from 'react';
import type { KioskLang } from './translations';

const LOCALES: Record<KioskLang, string> = { de: 'de-DE', en: 'en-GB' };

/** Сьогодні за МІСЦЕВИМ годинником екрана, `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Дата для ОКА гостя — його мовою. На сервер однаково їде `YYYY-MM-DD`:
 * `11.09.2026` живе рівно на екрані і ніколи в запиті.
 */
export function formatDay(date: string, lang: KioskLang): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Скільки місяців від `from` до `to` — для меж гортання. */
const monthsBetween = (from: { y: number; m: number }, to: { y: number; m: number }) =>
  (to.y - from.y) * 12 + (to.m - from.m);

export function KioskCalendar({
  value,
  today,
  lang,
  onPick,
}: {
  /** Обрана дата `YYYY-MM-DD` або null. */
  value: string | null;
  /** Сьогодні `YYYY-MM-DD` — приходить ззовні, щоб сцена могла його назвати. */
  today: string;
  lang: KioskLang;
  onPick: (date: string) => void;
}) {
  const base = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    return { y, m };
  }, [today]);

  // Відкривається на місяці ОБРАНОЇ дати, якщо вона вже є, інакше — на
  // поточному: гість, який повернувся правити вибір, бачить те, що обрав.
  const [shown, setShown] = useState(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      if (Math.abs(monthsBetween(base, { y, m })) <= 1) return { y, m };
    }
    return base;
  });

  const offset = monthsBetween(base, shown);
  const step = (by: number) => {
    const next = shown.m + by;
    const y = shown.y + Math.floor((next - 1) / 12);
    const m = ((next - 1) % 12 + 12) % 12 + 1;
    if (Math.abs(monthsBetween(base, { y, m })) > 1) return;
    setShown({ y, m });
  };

  const { title, weekdays, cells } = useMemo(() => {
    const locale = LOCALES[lang];
    const first = new Date(Date.UTC(shown.y, shown.m - 1, 1));
    const daysInMonth = new Date(Date.UTC(shown.y, shown.m, 0)).getUTCDate();
    // getUTCDay(): 0 — неділя. Понеділок першим → зсув на 1.
    const lead = (first.getUTCDay() + 6) % 7;

    const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    const names: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      // 2024-01-01 — понеділок; сім днів від нього дають повний тиждень у
      // потрібному порядку, без власного списку назв.
      names.push(weekdayFmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
    }

    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    const p = (n: number) => String(n).padStart(2, '0');
    for (let d = 1; d <= daysInMonth; d += 1) out.push(`${shown.y}-${p(shown.m)}-${p(d)}`);

    return {
      title: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first),
      weekdays: names,
      cells: out,
    };
  }, [shown, lang]);

  return (
    <div className="kiosk-calendar">
      <div className="kiosk-calendar-head">
        <button
          type="button"
          className="kiosk-calendar-nav"
          onClick={() => step(-1)}
          disabled={offset <= -1}
          aria-label="−1"
        >
          ‹
        </button>
        <span className="kiosk-calendar-title">{title}</span>
        <button
          type="button"
          className="kiosk-calendar-nav"
          onClick={() => step(1)}
          disabled={offset >= 1}
          aria-label="+1"
        >
          ›
        </button>
      </div>

      <div className="kiosk-calendar-grid">
        {weekdays.map((w, i) => (
          <span className="kiosk-calendar-weekday" key={`w${i}`}>{w}</span>
        ))}
        {cells.map((date, i) => (date === null ? (
          <span className="kiosk-calendar-blank" key={`b${i}`} />
        ) : (
          <button
            type="button"
            key={date}
            className="kiosk-calendar-day"
            data-today={date === today}
            data-on={date === value}
            onClick={() => onPick(date)}
          >
            {Number(date.slice(8, 10))}
          </button>
        )))}
      </div>
    </div>
  );
}
