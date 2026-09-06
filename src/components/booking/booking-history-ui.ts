/**
 * Спільне для двох карток (настільної й мобільної) в історії змін броні:
 * ролі, іконки, кольори дій і формат часу. Одна таблиця дій — інакше нова
 * дія з каналу мала б іконку на одному екрані й «📌» на іншому.
 */

/** Кому видно історію. Дзеркало `HISTORY_ROLES` у GET /api/audit/bookings. */
export const HISTORY_ROLES = new Set<string>(['owner', 'director', 'manager']);

export const HISTORY_ICONS: Record<string, string> = {
  created: '✨', deleted: '🗑️', status_change: '🔄', payment_status_change: '💰',
  price_change: '💲', unit_change: '🏠', dates_change: '📅',
  registration_change: '📋', notes_change: '📝', internal_notes_change: '📝',
  guests_change: '👥',
  payment: '💳', note: '📝',
  channel_created: '📡', channel_modified: '📡', channel_cancelled: '📡',
};

export const HISTORY_COLORS: Record<string, string> = {
  created: '#4ADE80',
  deleted: '#F26B6B',
  status_change: '#5B7CFF',
  payment_status_change: '#F5B847',
  price_change: '#F5B847',
  unit_change: '#A78BFA',
  dates_change: '#A78BFA',
  registration_change: '#5B7CFF',
  guests_change: 'var(--accent-info)',
  notes_change: 'var(--text-tertiary)',
  internal_notes_change: 'var(--text-tertiary)',
  channel_created: '#4ADE80',
  channel_modified: '#A78BFA',
  channel_cancelled: '#F26B6B',
};

/** «03.09.2026, 13:03» — дата повністю: історія читається й через рік. */
export function formatHistoryTime(createdAt: unknown): string {
  const raw = String(createdAt ?? '');
  const date = new Date(/Z$|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ', ' + date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
