'use client';

import { Bell, Search, User, Menu, ArrowLeft } from 'lucide-react';

interface HeaderProps {
  title: string;
  onMenuClick?: () => void;
  onBack?: () => void;
}

export default function Header({ title, onMenuClick, onBack }: HeaderProps) {
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
            aria-label="Назад"
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
        <button className="btn btn-ghost btn-icon" aria-label="Search">
          <Search size={18} />
        </button>
        <button className="btn btn-ghost btn-icon" aria-label="Notifications">
          <Bell size={18} />
        </button>
        <button className="btn btn-ghost btn-icon" aria-label="Profile">
          <User size={18} />
        </button>
      </div>
    </header>
  );
}
