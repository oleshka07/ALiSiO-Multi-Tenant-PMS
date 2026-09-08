'use client';

import { useT } from '@core/i18n/client';
import { ArrowLeft } from 'lucide-react';

interface HeaderProps {
  onBack: () => void;
}

/**
 * Шапка екрана — тільки коли в ній справді щось є.
 *
 * ── Чому вона перестала бути завжди ──────────────────────────────────────
 *
 * Рядок займав 60 px на КОЖНОМУ з 39 екранів і не ніс жодної дії. Виміряно в
 * браузері на семи розділах (планер, броні, дашборд, гості, звіти, ціни,
 * прибирання): висота 60, `.header-actions` — нуль дітей і нуль байтів
 * розмітки. Не «зазвичай порожня», а порожня ЗАВЖДИ і за побудовою:
 * `Header` не приймав дітей, тож заповнити її не міг жоден екран.
 *
 * Що в ній лежало і куди поділось:
 *
 *   * **заголовок** — дублював верхнє меню, де активний розділ і так
 *     підсвічений. Один раз назвати, де ти є, досить;
 *   * **кнопка меню** (`mobile-menu-btn`, ≤768 px) — на тій самій ширині
 *     показується `BottomNav` зі своєю кнопкою «Більше», і обидві кличуть той
 *     самий `onMoreClick`. Тобто доступ до аркуша не втрачено, він просто не
 *     дублюється;
 *   * **`onBack`** — єдина справжня дія, і вона лишається. Її мають три
 *     екрани: `sites/[siteId]`, `settings/legend`, `reports/sales`.
 *
 * ── Чому рядок більше не `position: fixed` ───────────────────────────────
 *
 * Фіксований рядок накривав випадайку верхнього меню: виміряно на трьох
 * розділах — меню «Гості» займає 49–141 px, шапка 56–116, перекриття 60 px, і
 * `document.elementFromPoint` у центрі меню повертав `header`. Власник
 * підтвердив із іншого боку: видалив вузол у консолі — накладання зникло.
 *
 * Порядком накладання це НЕ лікувалось. Перевірено чотири розклади:
 * `nav` 100 / `header` 90 (як було), перевернутий 90/100, `header` без
 * `z-index` і `header` без `position: fixed` — у всіх чотирьох згори лишалась
 * шапка. Чому саме так, я не встановила і не вигадуватиму пояснення; що
 * встановлено — фіксованого рядка над вмістом більше немає, тож накривати
 * випадайку нема чому. Рядок «назад» іде у потоці сторінки.
 */
export default function Header({ onBack }: HeaderProps) {
  const t = useT();
  return (
    <header className="header">
      <button
        onClick={onBack}
        aria-label={t('Назад')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
          padding: '4px 6px', borderRadius: 6, transition: 'color .15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
      >
        <ArrowLeft size={20} />
      </button>
    </header>
  );
}
