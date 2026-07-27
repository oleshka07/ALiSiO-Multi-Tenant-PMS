'use client';
import Link from 'next/link';

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

interface NavbarProps {
  tenants: Tenant[];
  activeTenantId: string;
  onTenantChange: (tenantId: string) => void;
}

export default function Navbar({ tenants, activeTenantId, onTenantChange }: NavbarProps) {
  return (
    <nav className="bg-slate-900/80 border-b border-slate-800 sticky top-0 z-50 backdrop-blur">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Brand & Navigation */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-extrabold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              ALiSiO PMS
            </span>
            <span className="text-xs px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30">
              Stage 2
            </span>
          </Link>
          <div className="hidden md:flex gap-4 text-sm font-medium text-slate-300">
            <Link href="/" className="hover:text-white transition">
              🏨 Готелі
            </Link>
            <Link
              href="/calendar"
              className="hover:text-indigo-400 text-indigo-300 font-semibold transition"
            >
              📅 Шахматка Календаря
            </Link>
            <Link
              href="/onboarding"
              className="hover:text-indigo-400 text-indigo-400/90 transition"
            >
              + Нова Організація
            </Link>
          </div>
        </div>

        {/* Tenant Switcher (Multi-Tenant Selector) */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 hidden sm:inline">Активна Організація:</span>
          <select
            value={activeTenantId}
            onChange={(e) => onTenantChange(e.target.value)}
            className="bg-slate-800 border border-indigo-500/40 text-white text-xs font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                🏢 {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </nav>
  );
}
