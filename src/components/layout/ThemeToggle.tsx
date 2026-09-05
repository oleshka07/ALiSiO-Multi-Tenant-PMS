'use client';

/**
 * Перемикач теми (П18): світла за замовчуванням, темна на вибір. Живе в меню
 * акаунта — це те, що коригують раз, а не щодня. Стан читається з атрибута,
 * який поставив скрипт завантаження, тож перемикач ніколи не бреше про тему.
 */
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useT } from '@core/i18n/client';
import { applyTheme, currentTheme, type Theme } from '@/ui/theme';

export default function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => { setTheme(currentTheme()); }, []);

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      role="switch"
      aria-checked={theme === 'dark'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%',
        padding: '9px 14px', fontSize: 14, border: 'none', background: 'transparent',
        cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
        {t('Темна тема')}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{theme === 'dark' ? t('увімкнено') : t('вимкнено')}</span>
    </button>
  );
}
