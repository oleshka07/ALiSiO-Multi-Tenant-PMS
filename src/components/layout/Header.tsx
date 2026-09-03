'use client';

import { useT } from '@core/i18n/client';
import { Bell, Search, Menu, ArrowLeft } from 'lucide-react';
import { useGlobalSearch } from '@/ui/GlobalSearchContext';
import AccountMenu from './AccountMenu';
import PropertySwitcher from './PropertySwitcher';

interface HeaderProps {
  title: string;
  onMenuClick?: () => void;
  onBack?: () => void;
}

export default function Header({ title, onMenuClick, onBack }: HeaderProps) {
  const t = useT();
  const openSearch = useGlobalSearch();
  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {onMenuClick && (
          <button
            className="mobile-menu-btn"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
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

      <div className="header-actions">
        {/* Область обʼєкта — один елемент на всю оболонку; зʼявляється лише
            коли обʼєктів два й більше. Див. src/ui/PropertyScopeContext.tsx. */}
        <PropertySwitcher />
        <button
          className="btn btn-ghost btn-icon"
          aria-label={t('Пошук')}
          title={`${t('Пошук')} · Ctrl+K`}
          onClick={openSearch}
        >
          <Search size={18} />
        </button>
        {/*
          Дзвіночок поки без змісту — і саме тому `disabled`.
          Кнопка, яка виглядає робочою і не робить нічого, читається як
          поломка: людина натискає її двічі, потім іде питати. Вимкнена
          каже правду — «сюди щось буде», — і не бреше щодня на 77 екранах.
        */}
        <button
          className="btn btn-ghost btn-icon"
          aria-label={t('Сповіщення')}
          title={t('Сповіщення — скоро')}
          disabled
          style={{ opacity: .45, cursor: 'default' }}
        >
          <Bell size={18} />
        </button>
        <AccountMenu />
      </div>
    </header>
  );
}
