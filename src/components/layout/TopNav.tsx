'use client';

/**
 * Верхнє меню (П12, MASTER-PLAN §1.1) — замість бічної панелі.
 *
 * Ліворуч логотип, у центрі пункти з `nav-items.ts`, праворуч те, що раніше
 * жило в шапці кожного екрана: обʼєкт, пошук, сповіщення, акаунт. Пункти
 * фільтруються правами, ключами модулів і країною — той самий предикат, що
 * й у пошуку Ctrl+K та заслінці `ModuleGate` (реєстр вирішує, меню
 * віддзеркалює). Активний пункт підкреслено.
 *
 * На телефоні (≤768 px) пункти ховаються (CSS), лишаються логотип і дії;
 * навігація — нижня панель і аркуш «Більше».
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Search, ChevronDown } from 'lucide-react';
import { useT, usePlural } from '@core/i18n/client';
import { hasPermission } from '@core/auth/permissions';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { useGlobalSearch } from '@/ui/GlobalSearchContext';
import AccountMenu from './AccountMenu';
import PropertySwitcher from './PropertySwitcher';
import { TOP_NAV, navItemActive, visibleNavItems, type NavItem } from './nav-items';

/**
 * Випадайка розділу — і чому вона малюється КООРДИНАТАМИ, а не просто «під
 * кнопкою».
 *
 * Симптом від власника: меню «Гості» ховається під вміст сторінки. Причина
 * виявилась не в порядку накладання, хоч виглядала саме так. `.topnav-items`
 * має `overflow-x: auto` — щоб пункти прокручувались на вузькому вікні, — а
 * `overflow-x: auto` з видимим `overflow-y` за специфікацією обчислюється в
 * `auto` по ОБОХ осях: одну вісь зробити прокруткою, а другу лишити видимою
 * не можна. Виміряно в браузері: `getComputedStyle(.topnav-items)` дає
 * `auto/auto`, і меню, що звисає нижче 56-піксельної смуги, просто
 * ОБРІЗАЄТЬСЯ — воно має правильний прямокутник, але не малюється зовсім.
 *
 * Саме тому жоден z-index не допомагав: перевірено чотири розклади (nav 100 /
 * header 90, перевернутий, `z-index: auto`, `position: static`) — у всіх меню
 * лишалось невидимим, бо обрізання це не накладання. Доказ від протилежного:
 * `overflow: visible` на `.topnav-items` робить меню клікабельним негайно.
 *
 * Прибрати `overflow-x` не можна — він тримає прокрутку пунктів на середніх
 * ширинах (на ≤768 px пункти й так сховані). Тож меню виходить із коробки, що
 * його ріже: `position: fixed` і координати від кнопки. Позиція
 * перераховується на прокрутку смуги пунктів і на зміну розміру вікна, бо
 * фіксований елемент за кнопкою сам не піде.
 */
function Dropdown({ item, active, t }: { item: NavItem; active: boolean; t: (s: string) => string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname() || '';
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (b) setPos({ top: Math.round(b.bottom + 6), left: Math.round(b.left) });
    };
    place();
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    // Смуга пунктів прокручується по горизонталі — фіксоване меню має їхати
    // за своєю кнопкою, інакше воно лишиться там, де кнопка була.
    const items = btnRef.current?.closest('.topnav-items');
    items?.addEventListener('scroll', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      items?.removeEventListener('scroll', place);
    };
  }, [open]);
  const Icon = item.icon;
  return (
    <div ref={ref} className="topnav-wrap">
      <button ref={btnRef} type="button" className={`topnav-item ${active ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon size={16} />
        {t(item.label)}
        <ChevronDown size={14} />
      </button>
      {open && pos && (
        <div className="topnav-menu" role="menu" style={{ top: pos.top, left: pos.left }}>
          {item.children!.map((c) => {
            const CIcon = c.icon;
            const isActive = pathname === c.href || pathname.startsWith(`${c.href}/`);
            return (
              <Link key={c.href} href={c.href} role="menuitem" className={isActive ? 'active' : ''} onClick={() => setOpen(false)}>
                <CIcon size={15} />
                {t(c.label)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TopNav() {
  const t = useT();
  const plural = usePlural();
  const pathname = usePathname() || '';
  const openSearch = useGlobalSearch();
  const { user, features, organization } = useCurrentUser();
  const [draftCount, setDraftCount] = useState(0);

  // Лічильник чорновиків на «Планері» — був на бічній панелі, лишається тут.
  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const res = await fetch('/api/booking/drafts-count');
        if (res.ok) setDraftCount((await res.json()).count || 0);
      } catch { /* non-critical */ }
    };
    fetchDrafts();
    const interval = setInterval(fetchDrafts, 60000);
    return () => clearInterval(interval);
  }, []);

  const items = user
    ? visibleNavItems(TOP_NAV, { permissions: user.permissions, features, countries: organization?.countries }, hasPermission)
    : [];

  return (
    <nav className="topnav" aria-label={t('Головне меню')}>
      <Link href="/app/dashboard" className="topnav-logo" aria-label="ALiSiO">
        <span className="topnav-logo-icon">A</span>
        <span className="topnav-logo-text">ALiSiO</span>
      </Link>

      <div className="topnav-items">
        {items.map((item) => {
          const active = navItemActive(item, pathname);
          if (item.children) return <Dropdown key={item.href} item={item} active={active} t={t} />;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`topnav-item ${active ? 'active' : ''}`}>
              <Icon size={16} />
              {t(item.label)}
              {item.href === '/app/calendar' && draftCount > 0 && (
                <span className="topnav-badge" title={`${draftCount} ${plural(draftCount, 'бронювань у чорновику')}`}>{draftCount}</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="topnav-actions">
        {/* Область обʼєкта — один елемент на всю оболонку; зʼявляється лише
            коли обʼєктів два й більше. Див. src/ui/PropertyScopeContext.tsx. */}
        <PropertySwitcher />
        <button className="btn btn-ghost btn-icon" aria-label={t('Пошук')} title={`${t('Пошук')} · Ctrl+K`} onClick={openSearch}>
          <Search size={18} />
        </button>
        {/* Дзвіночок поки без змісту — і саме тому `disabled`: кнопка, яка
            виглядає робочою і не робить нічого, читається як поломка. */}
        <button className="btn btn-ghost btn-icon" aria-label={t('Сповіщення')} title={t('Сповіщення — скоро')} disabled style={{ opacity: .45, cursor: 'default' }}>
          <Bell size={18} />
        </button>
        <AccountMenu />
      </div>
    </nav>
  );
}
