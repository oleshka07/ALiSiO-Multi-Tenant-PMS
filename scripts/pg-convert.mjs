/**
 * One SQLite value, as the Postgres column wants it.
 *
 * Its own file so pg-convert.check.mjs can prove it without opening a
 * connection: the conversion is where an import loses data quietly, and the
 * connection is not.
 *
 * SQLite has no real types — a column declared TEXT will hold the integer 1
 * and a column declared DATETIME will hold the empty string. Postgres has
 * types and enforces them, so every value has to be read as what it means
 * rather than as what it is.
 */

export function convert(value, pgType) {
  if (value === null || value === undefined) return null;

  switch (pgType) {
    case 'boolean':
      return value === 1 || value === '1' || value === true || value === 'true';

    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'date': {
      const s = String(value).trim();
      // SQLite keeps '' in a date column quite happily; Postgres rejects it.
      // It means "not set", so it becomes NULL rather than an error that stops
      // the import at row 40 000.
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
        // 'YYYY-MM-DD HH:MM:SS' with no zone. Everything here was written by
        // CURRENT_TIMESTAMP or an ISO string, both UTC, so the zone is stated
        // rather than left to whatever the server's locale happens to be —
        // which would shift every timestamp by the server's offset.
        return /[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
      }
      return s;
    }

    case 'jsonb': {
      const s = String(value).trim();
      if (!s) return null;
      try { JSON.parse(s); return s; }
      catch { return JSON.stringify(s); }   // a bare string is still valid JSON
    }

    case 'bigint':
    case 'integer':
    case 'numeric':
    case 'double precision':
      return value === '' ? null : value;

    case 'bytea':
      return Buffer.isBuffer(value) ? value : Buffer.from(String(value));

    default:
      return value;
  }
}
