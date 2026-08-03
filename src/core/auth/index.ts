/**
 * Core Auth — the front door.
 *
 * Sessions, password hashing and the permission model. This used to re-export
 * from src/lib; the implementation lives here now, and '@core/auth' is what
 * server code imports.
 *
 * A CLIENT component must import '@core/auth/permissions' instead: this file
 * also exports the session helpers, which open the database, and pulling that
 * into the browser bundle fails the build on `Can't resolve 'fs'`. The
 * permission model itself is pure data and pure functions — safe anywhere.
 */
export {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionUser,
  getSessionIdFromCookies,
  type SessionUser,
} from './auth';

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
} from './permissions';
