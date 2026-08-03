/**
 * Core DB — public re-export.
 * Real implementation lives in src/lib/db.ts until full migration.
 * Modules should import from '@core/db', not directly from src/lib/db.
 */
export { getDb, _resetDb, CZK_TO_EUR, generateGuestToken } from '../../lib/db.ts';
