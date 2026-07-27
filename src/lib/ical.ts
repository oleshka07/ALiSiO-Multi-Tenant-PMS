/**
 * iCal parser & generator — zero external dependencies
 */

export interface ICalEvent {
  uid: string;
  dtstart: string;   // YYYY-MM-DD
  dtend: string;      // YYYY-MM-DD
  summary: string;
  dtstamp?: string;
}

/**
 * Parse an iCal (VCALENDAR) string into an array of events.
 */
export function parseICal(text: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  // Unfold long lines (RFC 5545: CRLF + space/tab = continuation)
  const unfolded = text.replace(/\r\n[\t ]/g, '');
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  let current: Partial<ICalEvent> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false;
      if (current.uid && current.dtstart && current.dtend && current.summary) {
        events.push(current as ICalEvent);
      }
      continue;
    }

    if (!inEvent) continue;

    // Parse properties
    if (trimmed.startsWith('UID:')) {
      current.uid = trimmed.substring(4);
    } else if (trimmed.startsWith('SUMMARY:')) {
      current.summary = trimmed.substring(8);
    } else if (trimmed.startsWith('DTSTAMP:')) {
      current.dtstamp = trimmed.substring(8);
    } else if (trimmed.includes('DTSTART')) {
      current.dtstart = parseDateValue(trimmed);
    } else if (trimmed.includes('DTEND')) {
      current.dtend = parseDateValue(trimmed);
    }
  }

  return events;
}

/**
 * Parse a DTSTART or DTEND line value to YYYY-MM-DD.
 * Handles:
 *   DTSTART;VALUE=DATE:20260523       → "2026-05-23"
 *   DTSTART:20260420T220000Z          → "2026-04-21" (UTC 22:00 = midnight Czech UTC+2)
 *   DTSTART;TZID=Europe/Prague:20260421T000000 → "2026-04-21"
 */
function parseDateValue(line: string): string {
  const colonIdx = line.lastIndexOf(':');
  if (colonIdx < 0) return '';
  const raw = line.substring(colonIdx + 1).trim();

  // Pure date (no time component): YYYYMMDD
  if (/^\d{8}$/.test(raw)) {
    const d = raw;
    return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
  }

  // Datetime with potential timezone: YYYYMMDDTHHMMSSZ
  if (raw.length >= 15 && raw.includes('T')) {
    // Parse as proper Date and convert to Czech local date
    let iso = raw;
    // Convert compact format to ISO 8601: 20260420T220000Z → 2026-04-20T22:00:00Z
    if (!iso.includes('-')) {
      iso = `${iso.substring(0, 4)}-${iso.substring(4, 6)}-${iso.substring(6, 8)}T${iso.substring(9, 11)}:${iso.substring(11, 13)}:${iso.substring(13, 15)}`;
      if (raw.endsWith('Z')) iso += 'Z';
    }
    // Get the date in Czech timezone (Europe/Prague = UTC+1/+2)
    try {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }); // sv-SE gives YYYY-MM-DD
      }
    } catch { /* fall through */ }
    // Fallback: extract just date part
    return `${raw.substring(0, 4)}-${raw.substring(4, 6)}-${raw.substring(6, 8)}`;
  }

  // Fallback for any other format
  const dateStr = raw.replace(/[TZ].*/g, '');
  if (dateStr.length >= 8) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
  return raw;
}

/**
 * Extract guest name from iCal SUMMARY.
 * "Reserved - Sandor" → "Sandor"
 * "Blocked" → null
 */
export function extractGuestName(summary: string): string | null {
  if (!summary) return null;
  const lower = summary.toLowerCase();
  if (lower === 'blocked' || lower === 'not available' || lower === 'unavailable') {
    return null;
  }
  // "Reserved - Name" or "Booked - Name"
  const match = summary.match(/(?:reserved|booked|reservation)\s*[-–—:]\s*(.+)/i);
  if (match) return match[1].trim();
  // Airbnb: "Airbnb (Not available)" or just text
  if (lower.includes('not available') || lower.includes('unavailable')) return null;
  return summary.trim();
}

/**
 * Generate an iCal VCALENDAR string from reservations.
 */
export function generateICal(
  events: { uid: string; dtstart: string; dtend: string; summary: string }[],
  calendarName: string
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//ALiSiO PMS//Channel Manager//EN`,
    `X-WR-CALNAME:${calendarName}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const e of events) {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;VALUE=DATE:${e.dtstart.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${e.dtend.replace(/-/g, '')}`);
    lines.push(`SUMMARY:${e.summary}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
