/**
 * What a hall costs, and when two events collide.
 *
 * The pilot's price sheet rents halls by TIME BLOCK — bis 2 h, bis 4 h,
 * bis 8 h, über 8 h — not by night. That one fact is why event bookings are
 * their own thing and not reservations wearing a costume: a reservation
 * counts nights, an event counts hours, and every part of the stay pipeline
 * (Meldeschein, Kurtaxe, occupancy, housekeeping) would have to learn an
 * exception for a "stay" with zero nights. We tried that road with nothing —
 * see the apartments' breakfast — and the exception always leaks.
 *
 * Prices are SUGGESTIONS. The owner said it in one line: «Preise sind
 * variabel (Nutzungsdauer, Personenzahl, Leistungsumfang) — müssen manuell
 * einpflegbar sein». The block price prefills the room line; reception edits
 * it. What the tier resolver owes them is the right STARTING number, not the
 * final word.
 */

/** Prices per block, gross. null = this hall is not offered for that block. */
export interface BlockPrices {
  h2?: number | null;
  h4?: number | null;
  h8?: number | null;
  h8plus?: number | null;
}

/**
 * The price the sheet suggests for a duration.
 *
 * The tier is chosen by the duration, then walks UP through longer blocks the
 * hall actually offers: the pilot's Saal has no 2-hour price, so a 90-minute
 * booking of it starts from the 4-hour figure — the shortest block that
 * covers it. Returns null when the hall prices nothing at or above the
 * duration, which the caller shows as "домовляйтесь руками", not as 0: a
 * zero on a folio line is a real price a guest may hold you to.
 */
export function suggestedBlockPrice(prices: BlockPrices, minutes: number): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const ladder: Array<[number, number | null | undefined]> = [
    [120, prices.h2],
    [240, prices.h4],
    [480, prices.h8],
    [Infinity, prices.h8plus],
  ];
  for (const [cap, price] of ladder) {
    if (minutes <= cap && price != null) return Number(price);
  }
  return null;
}

/**
 * Do two time ranges on the same day collide?
 *
 * Half-open [from, to): an event ending 12:00 and one starting 12:00 share a
 * doorway, not the hall. Times are 'HH:MM' strings — lexicographic comparison
 * is correct for zero-padded 24h times, and keeping them as strings means no
 * timezone can shift somebody's Saal into the previous evening.
 */
export function timesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/** 'HH:MM' → minutes since midnight; NaN when malformed. */
export function minutesBetween(from: string, to: string): number {
  const parse = (t: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  return parse(to) - parse(from);
}
