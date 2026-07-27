'use client';
import type { Property, Tenant } from '@/lib/store';
import { Bell, Building2, Home, Menu, Search, User } from 'lucide-react';

interface HeaderProps {
  title: string;
  tenants?: Tenant[];
  activeTenantId?: string;
  onTenantChange?: (tenantId: string) => void;
  properties?: Property[];
  activePropertyId?: string;
  onPropertyChange?: (propertyId: string) => void;
  onMenuClick?: () => void;
}

export default function Header({
  title,
  tenants = [],
  activeTenantId,
  onTenantChange,
  properties = [],
  activePropertyId,
  onPropertyChange,
  onMenuClick,
}: HeaderProps) {
  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {onMenuClick && (
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
        )}
        <h1 className="header-title">{title}</h1>
      </div>

      <div className="header-actions">
        {/* Multi-Tenant Organization Switcher */}
        {tenants.length > 0 && onTenantChange && (
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700/80 px-2.5 py-1.5 rounded-lg text-xs">
            <Building2 size={14} className="text-indigo-400" />
            <select
              value={activeTenantId}
              onChange={(e) => onTenantChange(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                  🏢 {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Property Selector */}
        {properties.length > 0 && onPropertyChange && (
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700/80 px-2.5 py-1.5 rounded-lg text-xs">
            <Home size={14} className="text-emerald-400" />
            <select
              value={activePropertyId}
              onChange={(e) => onPropertyChange(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                  🏨 {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="button" className="btn btn-ghost btn-icon" aria-label="Search">
          <Search size={18} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Notifications">
          <Bell size={18} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Profile">
          <User size={18} />
        </button>
      </div>
    </header>
  );
}
