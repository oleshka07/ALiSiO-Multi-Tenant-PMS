// ============================================================
// ALiSiO ERP — Permissions & Role-based Access Control
// ============================================================

import type { UserRole } from '@/types/database';

// ─── All available permissions ─────────────────────────────
export const ALL_PERMISSIONS = [
  // Navigation
  'nav:dashboard',
  'nav:calendar',
  'nav:bookings',
  'nav:pricing',
  'nav:reports',
  'nav:guests',
  'nav:documents',
  'nav:finance',
  'nav:settings',
  'nav:sites',
  'nav:tasks',
  // Features
  'manage_users',
  'manage_pricing',
  'manage_properties',
  'manage_bookings',
  'manage_guests',
  'view_reports',
  'manage_payments',
  'manage_documents',
  'manage_expenses',
  'view_finance',
  'manage_finance_settings',
  'manage_sites',
  'manage_tasks',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// ─── Permission groups for UI display ──────────────────────
export const PERMISSION_GROUPS: { title: string; permissions: { key: Permission; label: string }[] }[] = [
  {
    title: 'Навігація',
    permissions: [
      { key: 'nav:dashboard', label: 'Dashboard' },
      { key: 'nav:calendar', label: 'Календар' },
      { key: 'nav:bookings', label: 'Бронювання' },
      { key: 'nav:pricing', label: 'Ціноутворення' },
      { key: 'nav:reports', label: 'Звіти' },
      { key: 'nav:guests', label: 'Гості' },
      { key: 'nav:documents', label: 'Документи' },
      { key: 'nav:finance', label: 'Фінанси' },
      { key: 'nav:sites', label: 'Сайти бронювання' },
      { key: 'nav:tasks', label: 'Задачі' },
      { key: 'nav:settings', label: 'Налаштування' },
    ],
  },
  {
    title: 'Функції',
    permissions: [
      { key: 'manage_users', label: 'Керування користувачами' },
      { key: 'manage_pricing', label: 'Керування цінами' },
      { key: 'manage_properties', label: "Керування об'єктами" },
      { key: 'manage_bookings', label: 'Керування бронюваннями' },
      { key: 'manage_guests', label: 'Керування гостями' },
      { key: 'view_reports', label: 'Перегляд звітів' },
      { key: 'manage_payments', label: 'Керування оплатами' },
      { key: 'manage_documents', label: 'Керування документами' },
      { key: 'manage_expenses', label: 'Керування витратами' },
      { key: 'view_finance', label: 'Перегляд фінансів' },
      { key: 'manage_finance_settings', label: 'Налаштування фінансів (рахунки, категорії, контрагенти)' },
      { key: 'manage_sites', label: 'Керування сайтами' },
      { key: 'manage_tasks', label: 'Керування задачами' },
    ],
  },
];

// ─── Default permissions per role ──────────────────────────
export const ROLE_DEFAULTS: Record<UserRole, Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  director: [...ALL_PERMISSIONS],
  manager: [
    'nav:dashboard', 'nav:calendar', 'nav:bookings', 'nav:pricing',
    'nav:reports', 'nav:guests', 'nav:documents', 'nav:finance', 'nav:sites', 'nav:tasks',
    'manage_bookings', 'manage_guests', 'manage_pricing',
    'view_reports', 'manage_payments', 'manage_documents',
    'manage_expenses', 'view_finance', 'manage_finance_settings',
    'manage_sites', 'manage_tasks',
  ],
  receptionist: [
    'nav:dashboard', 'nav:calendar', 'nav:bookings', 'nav:guests', 'nav:tasks',
    // Документи — рішення власника від 2026-08-28: виставити й відредагувати
    // фактуру це частина роботи рецепції, а не привілей бухгалтера. Гість
    // виїжджає о сьомій ранку, і чекати, поки хтось із правами прокинеться,
    // він не буде.
    //
    // `manage_documents` дає виписати, змінити, провести оплату у фоліо.
    // Чого воно НЕ дає: `manage_finance_settings` — ставки ПДВ, серії
    // нумерації, бланк і сторно лишаються за тим, хто відповідає за
    // звітність. Сторно тут навмисно: виданий документ не редагується, він
    // скасовується зустрічним, і це не рішення зміни.
    'nav:documents',
    'manage_bookings', 'manage_guests', 'manage_tasks', 'manage_documents',
  ],
  housekeeper: [
    'nav:dashboard',
  ],
  maintenance: [
    'nav:dashboard',
  ],
  accountant: [
    'nav:dashboard', 'nav:reports', 'nav:documents', 'nav:finance',
    'view_reports', 'manage_payments', 'manage_documents',
    'manage_expenses', 'view_finance', 'manage_finance_settings',
  ],
};

// ─── Role labels (Ukrainian) ──────────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Власник',
  director: 'Директор',
  manager: 'Менеджер',
  receptionist: 'Рецепціоніст',
  housekeeper: 'Покоївка',
  maintenance: 'Технік',
  accountant: 'Бухгалтер',
};

// ─── Role colors for badges ───────────────────────────────
export const ROLE_COLORS: Record<UserRole, string> = {
  owner: '#ef4444',
  director: '#f97316',
  manager: '#8b5cf6',
  receptionist: '#3b82f6',
  housekeeper: '#10b981',
  maintenance: '#6b7280',
  accountant: '#eab308',
};

// ─── Permission override type ─────────────────────────────
export interface PermissionOverride {
  permission: Permission;
  granted: boolean; // true = grant, false = revoke
}

// ─── Merge defaults with overrides ────────────────────────
export function getUserPermissions(
  role: UserRole,
  overrides: PermissionOverride[] = []
): Permission[] {
  const defaults = new Set<Permission>(ROLE_DEFAULTS[role] || []);

  for (const override of overrides) {
    if (override.granted) {
      defaults.add(override.permission);
    } else {
      defaults.delete(override.permission);
    }
  }

  return Array.from(defaults);
}

// ─── Check if user has a specific permission ──────────────
export function hasPermission(
  userPermissions: Permission[],
  permission: Permission
): boolean {
  return userPermissions.includes(permission);
}

// ─── Nav items → required permissions mapping ─────────────
export const NAV_PERMISSION_MAP: Record<string, Permission> = {
  '/app/dashboard': 'nav:dashboard',
  '/app/calendar': 'nav:calendar',
  '/app/bookings': 'nav:bookings',
  '/app/pricing': 'nav:pricing',
  '/app/reports': 'nav:dashboard',
  '/app/reports/sales': 'nav:reports',
  '/app/reports/city-tax': 'nav:reports',
  '/app/guests': 'nav:guests',
  '/app/documents': 'nav:documents',
  '/app/finance': 'nav:finance',
  '/app/finance/expenses': 'nav:finance',
  '/app/finance/pnl': 'nav:finance',
  '/app/finance/cashflow': 'nav:finance',
  '/app/finance/capex': 'nav:finance',
  '/app/finance/expected-payments': 'nav:finance',
  '/app/finance/accruals': 'nav:finance',
  '/app/finance/bank': 'nav:finance',
  '/app/settings': 'nav:settings',
  '/app/settings/properties': 'nav:settings',
  '/app/settings/units': 'nav:settings',
  '/app/settings/legend': 'nav:settings',
  '/app/settings/users': 'manage_users',
  '/app/sites': 'nav:sites',
  '/app/tasks': 'nav:tasks',
  '/app/audit': 'nav:settings',
};
