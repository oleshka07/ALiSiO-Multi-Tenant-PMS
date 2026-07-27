/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Vrbo (PowerBO) Email Parser
 * 
 * Detects Vrbo notification emails and extracts:
 * - Guest name
 * - Check-in / check-out dates
 * - Reservation ID (e.g. HA-XXXXXX)
 * - Number of guests
 * - Total price
 */

export interface VrboData {
  isVrbo: boolean;
  guestName: string | null;
  confirmationId: string | null;    // HA-XXXXXX
  checkIn: string | null;           // ISO date YYYY-MM-DD
  checkOut: string | null;          // ISO date YYYY-MM-DD
  totalGuests: number | null;
  totalPrice: number | null;
  currency: string | null;
  guestPhone: string | null;
  guestMessage: string | null;
  isNewReservation: boolean;
  propertyName: string | null;
}

const EMPTY: VrboData = {
  isVrbo: false,
  guestName: null, confirmationId: null,
  checkIn: null, checkOut: null,
  totalGuests: null, totalPrice: null, currency: null,
  guestPhone: null, guestMessage: null,
  isNewReservation: false, propertyName: null
};

export function parseVrboEmail(textBody: string, subject: string): VrboData {
  const isVrbo = subject.toLowerCase().includes('vrbo') || 
                 subject.toLowerCase().includes('homeaway') ||
                 textBody.includes('Vrbo');

  if (!isVrbo) return EMPTY;

  const result: VrboData = { ...EMPTY, isVrbo: true };

  // Detect New Reservation
  if (subject.includes('Instant Booking') || subject.includes('Reservation from') || subject.includes('Your booking is confirmed')) {
    result.isNewReservation = true;
  }

  // Extract Reservation ID (HA-XXXXXX)
  const idMatch = textBody.match(/Reservation ID:\s*([A-Z0-9-]+)/i);
  if (idMatch) result.confirmationId = idMatch[1].trim();

  // Extract Guest Name
  const nameMatch = textBody.match(/Traveler Name:\s*([^\n\r]+)/i);
  if (nameMatch) result.guestName = nameMatch[1].trim();

  // Extract Phone
  const phoneMatch = textBody.match(/Traveler Phone:\s*([^\n\r]+)/i);
  if (phoneMatch) result.guestPhone = phoneMatch[1].trim();

  // Extract Dates: "Dates: Jul 24 - Jul 26, 2026"
  const datesMatch = textBody.match(/Dates:\s*([A-Za-z]{3}\s+\d{1,2})\s*-\s*([A-Za-z]{3}\s+\d{1,2}),\s*(\d{4})/i);
  if (datesMatch) {
    const year = datesMatch[3];
    result.checkIn = parseVrboDate(datesMatch[1], year);
    result.checkOut = parseVrboDate(datesMatch[2], year);
  }

  // Extract Guests: "Guests: 14 adults"
  const guestsMatch = textBody.match(/Guests:\s*(\d+)\s*adults/i);
  if (guestsMatch) result.totalGuests = parseInt(guestsMatch[1]);

  // Extract Price: "Total traveler payment € 409.50"
  const priceMatch = textBody.match(/Total traveler payment\s*([$€£])\s*([\d,.]+)/i) || 
                     textBody.match(/Total payout\s*([$€£])\s*([\d,.]+)/i);
  if (priceMatch) {
    result.currency = priceMatch[1] === '€' ? 'EUR' : (priceMatch[1] === '$' ? 'USD' : 'CZK');
    result.totalPrice = parseFloat(priceMatch[2].replace(',', ''));
  }

  // Extract Message
  const msgMatch = textBody.match(/Traveler Message\s*([\s\S]*?)(?:\n\s*---|\n\s*©|$)/i);
  if (msgMatch) result.guestMessage = msgMatch[1].trim();

  // Property ID/Name
  const propMatch = textBody.match(/Property:\s*#(\d+)/i);
  if (propMatch) result.propertyName = `Vrbo #${propMatch[1]}`;

  return result;
}

function parseVrboDate(dateStr: string, year: string): string | null {
  const [monthStr, day] = dateStr.trim().split(/\s+/);
  const monthMap: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  const month = monthMap[monthStr];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}
