/**
 * Core Auth — public re-export.
 * Real implementation lives in src/lib/auth.ts + src/lib/permissions.ts until full migration.
 * Modules should import from '@core/auth', not directly from src/lib/auth.
 */
export {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionUser,
  getSessionIdFromCookies,
  type SessionUser,
} from '@/lib/auth';

export {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  ROLE_COLORS,
  getUserPermissions,
  hasPermission,
  NAV_PERMISSION_MAP,
  type Permission,
  type PermissionOverride,
} from '@/lib/permissions';
