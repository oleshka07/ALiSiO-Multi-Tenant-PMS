/**
 * Верхнє меню — один список для десктопа, телефона і аркуша «Більше» (П12).
 *
 * Структура — за Hoteliera (MASTER-PLAN §1.1): Dashboard · Ціни та наявність ·
 * Планер · Бронювання · Гості · Звіти · Налаштування. Платні модулі, які
 * колись були окремими пунктами бічної панелі (задачі, зали), зʼявляються в
 * меню лише коли ключ увімкнено — «за платним ключем», не «зникли».
 *
 * Тут лише ФОРМА меню. Права, ключі модулів і країни фільтруються там само,
 * де й раніше (`visibleNavItems`): реєстр фіч вирішує, меню віддзеркалює —
 * той самий рядок `organization_features`, який читають маршрути. Повний
 * каталог екранів для пошуку і заслінки `ModuleGate` — `core/navigation.ts`;
 * цей список — кураторський вибір з нього, і `feature` тут мусить збігатися
 * з тим, що стоїть у каталозі (тримає `features.check.ts` через каталог).
 *
 * Без імпортів із серверного коду: цей файл їде в бандл браузера.
 */
import type { Permission } from '@core/auth/permissions';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, DollarSign, CalendarDays, BookOpen, Users, BarChart3, Settings,
  CheckSquare, Presentation, ClipboardList, Brush,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Ключ із core/features.ts — пункт видно лише з увімкненим модулем. */
  feature?: string;
  /** Лише для організації з обʼєктом у цих країнах (Evidenční kniha — CZ). */
  countries?: string[];
  /** Підпункти: пункт стає меню, перший підпункт — його власна адреса. */
  children?: NavItem[];
  /** У нижній панелі телефона (4 пункти). */
  primary?: boolean;
}

export const TOP_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/app/dashboard', icon: LayoutDashboard, permission: 'nav:dashboard', feature: 'dashboard', primary: true },
  { label: 'Ціни та наявність', href: '/app/pricing', icon: DollarSign, permission: 'nav:pricing' },
  { label: 'Планер', href: '/app/calendar', icon: CalendarDays, permission: 'nav:calendar', primary: true },
  { label: 'Бронювання', href: '/app/bookings', icon: BookOpen, permission: 'nav:bookings', primary: true },
  {
    label: 'Гості', href: '/app/guests', icon: Users, permission: 'nav:guests', primary: true,
    children: [
      { label: 'Гості', href: '/app/guests', icon: Users, permission: 'nav:guests' },
      { label: 'Evidenční kniha', href: '/app/guest-registry', icon: ClipboardList, permission: 'nav:guests', countries: ['CZ'] },
    ],
  },
  // Звіти — один вхід (MASTER-PLAN §1.1): сторінка сама показує лише ті
  // звіти, на які є право і ключ. Пункт без окремого права: хто не має
  // жодного звіту, побачить порожній стан із поясненням.
  { label: 'Звіти', href: '/app/reports', icon: BarChart3 },
  // Прибирання — під Reports, як у Hoteliera (Блок 4 §2.2). Ядро, без ключа;
  // право `manage_housekeeping` мають покоївка, рецепція і менеджер.
  { label: 'Прибирання', href: '/app/housekeeping', icon: Brush, permission: 'manage_housekeeping' },
  // Платні модулі — зʼявляються з ключем.
  { label: 'Задачі', href: '/app/tasks', icon: CheckSquare, permission: 'nav:tasks', feature: 'tasks' },
  { label: 'Зали', href: '/app/events', icon: Presentation, permission: 'nav:bookings', feature: 'events' },
  { label: 'Налаштування', href: '/app/settings', icon: Settings, permission: 'nav:settings' },
];

export interface NavViewer {
  permissions: Permission[];
  features: Record<string, boolean>;
  countries?: readonly string[];
}

type HasPermission = (perms: Permission[], p: Permission) => boolean;

const allowed = (item: NavItem, v: NavViewer, has: HasPermission): boolean => {
  if (item.permission && !has(v.permissions, item.permission)) return false;
  // Реєстр вирішує, меню віддзеркалює — ключ, якого сервер не назвав,
  // вважається вимкненим (інваріант 13).
  if (item.feature && !v.features[item.feature]) return false;
  if (item.countries && !item.countries.some((c) => v.countries?.includes(c))) return false;
  return true;
};

/** Пункти, які цей користувач бачить, із відфільтрованими підпунктами. */
export function visibleNavItems(items: NavItem[], viewer: NavViewer, has: HasPermission): NavItem[] {
  return items
    .filter((i) => allowed(i, viewer, has))
    .map((i) => {
      if (!i.children) return i;
      const children = i.children.filter((c) => allowed(c, viewer, has));
      // Один підпункт — це не меню, а посилання.
      return children.length > 1 ? { ...i, children } : { ...i, children: undefined };
    });
}

/** Чи належить адреса пункту (точно або як вкладена сторінка). */
export function navItemActive(item: NavItem, pathname: string): boolean {
  const hit = (href: string) => pathname === href || (href !== '/app/dashboard' && pathname.startsWith(`${href}/`));
  return hit(item.href) || (item.children ?? []).some((c) => hit(c.href));
}
