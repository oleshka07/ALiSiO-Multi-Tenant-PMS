'use client';

import { useT } from '@core/i18n/client';
import { Menu, ArrowLeft } from 'lucide-react';

interface HeaderProps {
  title: string;
  onMenuClick?: () => void;
  onBack?: () => void;
}

/**
 * Шапка екрана: назва і, за потреби, «назад». Обʼєкт, пошук, сповіщення й
 * акаунт переїхали у верхнє меню (`TopNav`, П12) — вони одні на всю
 * оболонку, а не на кожному з 77 екранів. Кнопка меню видна лише на телефоні
 * і відкриває аркуш «Більше».
 */
export default function Header({ title, onMenuClick, onBack }: HeaderProps) {
  const t = useT();
  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {onMenuClick && (
          <button className="mobile-menu-btn" onClick={onMenuClick} aria-label={t('Меню')}>
            <Menu size={22} />
          </button>
        )}
        {onBack && (
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
        )}
        <h1 className="header-title">{title}</h1>
      </div>
      <div className="header-actions" />
    </header>
  );
}
