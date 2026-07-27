/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Booking.com Email Parser
 * 
 * Detects Booking.com notification emails and extracts:
 * - Guest message (actual content, stripped of boilerplate)
 * - Guest name
 * - Check-in / check-out dates
 * - Property/unit type (glamping, resort, camping)
 * - Booking confirmation number
 * - Number of guests
 */

export interface BookingComData {
  isBookingCom: boolean;
  guestMessage: string | null;      // The actual guest message
  guestName: string | null;         // Full name from booking
  firstName: string | null;
  lastName: string | null;
  confirmationId: string | null;    // Booking.com reservation number
  checkIn: string | null;           // ISO date YYYY-MM-DD
  checkOut: string | null;          // ISO date YYYY-MM-DD
  propertyName: string | null;      // Raw property name from email
  categoryType: string | null;      // 'glamping' | 'resort' | 'camping'
  totalGuests: number | null;
  totalRooms: number | null;
  totalPrice: number | null;        // Numeric price
  currency: string | null;          // CZK, EUR, etc.
  resId: string | null;             // res_id from URL
  language: string | null;          // Detected from booking email
  isNewReservation: boolean;        // Specifically a 'New Booking' notification
}

const EMPTY: BookingComData = {
  isBookingCom: false,
  guestMessage: null, guestName: null, firstName: null, lastName: null,
  confirmationId: null, checkIn: null, checkOut: null,
  propertyName: null, categoryType: null,
  totalGuests: null, totalRooms: null, totalPrice: null, currency: null,
  resId: null, language: null,
  isNewReservation: false,
};

/**
 * Check if an email is from Booking.com and extract structured data if so.
 */
export function parseBookingComEmail(textBody: string, fromAddress: string, subject: string): BookingComData {
  // Quick check: is this from Booking.com?
  const isBooking = fromAddress.toLowerCase().includes('booking.com') ||
    textBody.includes('Booking.com') ||
    textBody.includes('admin.booking.com') ||
    subject?.toLowerCase().includes('booking.com');

  if (!isBooking) return EMPTY;

  const result: BookingComData = { ...EMPTY, isBookingCom: true };

  // --- Detect if this is a NEW RESERVATION ---
  const subjectLower = (subject || '').toLowerCase();
  const isNew = subjectLower.includes('нове бронювання') || 
                subjectLower.includes('new reservation') || 
                subjectLower.includes('nova rezervace') || 
                subjectLower.includes('neue reservierung') ||
                textBody.includes('Ви отримали нове бронювання') ||
                textBody.includes('You have received a new reservation');
  
  result.isNewReservation = isNew;

  // --- Extract confirmation/reservation ID ---
  // From "Номер підтвердження: 6137899120" or "Confirmation number: 6137899120"
  const confMatch = textBody.match(/(?:Номер підтвердження|Confirmation number|Číslo potvrzení|Bestätigungsnummer|Номер подтверждения)[:\s]*(\d{5,15})/i);
  if (confMatch) result.confirmationId = confMatch[1];

  // From URL: res_id=6137899120
  const resIdMatch = textBody.match(/res_id=(\d{5,15})/);
  if (resIdMatch) result.resId = resIdMatch[1];
  
  // Fallback: product_id=
  if (!result.confirmationId) {
    const prodMatch = textBody.match(/product_id=(\d{5,15})/);
    if (prodMatch) result.confirmationId = prodMatch[1];
  }

  // Use resId as confirmationId if not found
  if (!result.confirmationId && result.resId) {
    result.confirmationId = result.resId;
  }

  // --- Extract guest name ---
  // Pattern: "Ім'я гостя:\n Mariia Bohdanets" or "Guest name:\n John Smith"
  const namePatterns = [
    /(?:Ім['']я гостя|Guest name|Jméno hosta|Name des Gastes|Имя гостя)[:\s]*\n?\s*([A-ZА-ЯІЇЄҐÁČĎÉĚÍŇÓŘŠŤÚŮÝŽÄÖÜẞ][a-zа-яіїєґáčďéěíňóřšťúůýžäöüß]+(?:\s+[A-ZА-ЯІЇЄҐÁČĎÉĚÍŇÓŘŠŤÚŮÝŽÄÖÜẞ][a-zа-яіїєґáčďéěíňóřšťúůýžäöüß]+)+)/,
  ];
  for (const pat of namePatterns) {
    const match = textBody.match(pat);
    if (match) {
      result.guestName = match[1].trim();
      break;
    }
  }

  // Also try: "від гостя\n\n  [Name]:" pattern (message notification)
  if (!result.guestName) {
    const msgNameMatch = textBody.match(/(?:від гостя|from guest|message from)\s*\n+\s*([A-ZА-ЯІЇЄҐÁČĎÉĚÍŇÓŘŠŤÚŮÝŽÄÖÜẞ][a-zа-яіїєґáčďéěíňóřšťúůýžäöüß]+(?:\s+[A-ZА-ЯІЇЄҐÁČĎÉĚÍŇÓŘŠŤÚŮÝŽÄÖÜẞ][a-zа-яіїєґáčďéěíňóřšťúůýžäöüß]+)+)/i);
    if (msgNameMatch) result.guestName = msgNameMatch[1].trim();
  }

  // Parse first/last name
  if (result.guestName) {
    const parts = result.guestName.split(/\s+/);
    result.firstName = parts[0];
    result.lastName = parts.slice(1).join(' ') || null;
  }

  // --- Extract guest message ---
  // The actual message is between the name + ":" and the next section (like "Відповісти" or booking details)
  const msgPatterns = [
    // Pattern: "Name:\n\n message text\n\n Відповісти"
    /(?:від гостя|from guest|message from)\s*\n+\s*[A-Za-zА-Яа-яІіЇїЄєҐґ\s]+:\s*\n+\s*([\s\S]*?)(?:\n\s*(?:Відповісти|Reply|Antworten|Ответить)\s*\n)/i,
    // Pattern: "Name:\n\n message\n\n --->"
    /(?:від гостя|from guest)\s*\n+\s*[A-Za-zА-Яа-яІіЇїЄєҐґ\s]+:\s*\n+\s*([\s\S]*?)(?:\n\s*--+>)/i,
  ];
  
  for (const pat of msgPatterns) {
    const match = textBody.match(pat);
    if (match) {
      result.guestMessage = match[1].trim();
      break;
    }
  }

  // Fallback: try to get the part between "Номер підтвердження" and "Відповісти" sections
  if (!result.guestMessage) {
    // Try the content between "new message from guest" block and URL block
    const blockMatch = textBody.match(/(?:повідомлення від гостя|new message from|message from guest)\s*\n+\s*[\w\s]+:\s*\n+\s*([\s\S]*?)(?:\n\s*(?:Відповісти|Reply|-->|https:\/\/admin\.booking))/i);
    if (blockMatch) result.guestMessage = blockMatch[1].trim();
  }

  // --- Extract check-in date ---
  // "Заїзд:\n пт, 10 квіт. 2026" or "Check-in:\n Fri, 10 Apr 2026"
  const checkInPatterns = [
    /(?:Заїзд|Check-in|Příjezd|Anreise|Заезд)[:\s]*\n?\s*(?:[а-яa-z]+,?\s*)?(\d{1,2})\s+([а-яіїєґa-zěščřžýáíéůúöäü]+)\.?\s+(\d{4})/i,
  ];
  for (const pat of checkInPatterns) {
    const match = textBody.match(pat);
    if (match) {
      result.checkIn = parseBookingDate(match[1], match[2], match[3]);
      break;
    }
  }

  // --- Extract check-out date ---
  const checkOutPatterns = [
    /(?:Виїзд|Check-out|Odjezd|Abreise|Выезд)[:\s]*\n?\s*(?:[а-яa-z]+,?\s*)?(\d{1,2})\s+([а-яіїєґa-zěščřžýáíéůúöäü]+)\.?\s+(\d{4})/i,
  ];
  for (const pat of checkOutPatterns) {
    const match = textBody.match(pat);
    if (match) {
      result.checkOut = parseBookingDate(match[1], match[2], match[3]);
      break;
    }
  }

  // --- Extract property/unit name ---
  const propPatterns = [
    /(?:Назва помешкання|Property name|Název ubytování|Unterkunftsname|Название объекта)[:\s]*\n?\s*(.+?)(?:\n|$)/i,
  ];
  for (const pat of propPatterns) {
    const match = textBody.match(pat);
    if (match) {
      result.propertyName = match[1].trim();
      break;
    }
  }

  // --- STRICT PROPERTY FILTER ---
  if (result.propertyName || textBody) {
    const nameLower = (result.propertyName || '').toLowerCase();
    const bodyLower = textBody.toLowerCase();
    
    // Only process Carlsbad Wellness and Camping Resort (ignore QA Glamping)
    if (nameLower.includes('qa glamping') || nameLower.includes('quiet anomaly')) {
      console.log(`[Parser] Ignoring QA Glamping booking: ${result.propertyName}`);
      return EMPTY; 
    }
    
    // Detect category type from property name or body
    if (bodyLower.includes('wellness hostel') || nameLower.includes('hostel')) {
      result.categoryType = 'resort';
      // Specific building D flag could be added here if needed, but 'resort' is the main type
    } else if (nameLower.includes('resort') || nameLower.includes('hotel') || nameLower.includes('apartment') || bodyLower.includes('building f')) {
      result.categoryType = 'resort';
    } else if (nameLower.includes('glamping') || nameLower.includes('stealth') || nameLower.includes('mirror')) {
      result.categoryType = 'glamping';
    } else if (nameLower.includes('camping') || nameLower.includes('pitch') || nameLower.includes('tent')) {
      result.categoryType = 'camping';
    } else {
      // Default for Carlsbad Wellness & Camping Resort emails that aren't camping is usually resort/hostel
      result.categoryType = 'resort';
    }
  }

  // --- Extract total price and currency ---
  // Examples: "Ціна: 1 200 CZK", "Price: € 50.00", "Вартість: 3 450,50 CZK"
  const priceMatch = textBody.match(/(?:Ціна|Price|Cena|Preis|Вартість)[:\s]*\n?\s*(?:[A-Z$€£]{1,3})?\s*([\d\s,.]+)\s*([A-Z$€£]{1,3}|CZK|Kč|€|EUR|USD|GBP)?/i);
  if (priceMatch) {
    const rawPrice = priceMatch[1].replace(/\s/g, '').replace(',', '.');
    result.totalPrice = parseFloat(rawPrice);
    result.currency = priceMatch[2] || 'CZK';
    if (result.currency === 'Kč') result.currency = 'CZK';
  }

  // --- Extract total guests ---
  const guestsMatch = textBody.match(/(?:Усього гостей|Total guests|Celkem hostů|Gesamzahl der Gäste|Всего гостей)[:\s]*\n?\s*(\d+)/i);
  if (guestsMatch) result.totalGuests = parseInt(guestsMatch[1]);

  // --- Extract total rooms ---
  const roomsMatch = textBody.match(/(?:Усього номерів|Total rooms|Celkem pokojů|Zimmer gesamt|Всего номеров)[:\s]*\n?\s*(\d+)/i);
  if (roomsMatch) result.totalRooms = parseInt(roomsMatch[1]);

  // --- Extract booking number (from "Номер бронювання: 6137899120") ---
  if (!result.confirmationId) {
    const bookNumMatch = textBody.match(/(?:Номер бронювання|Reservation number|Číslo rezervace|Reservierungsnummer|Номер бронирования)[:\s]*\n?\s*(\d{5,15})/i);
    if (bookNumMatch) result.confirmationId = bookNumMatch[1];
  }

  // --- Detect language from email content ---
  if (textBody.includes('Заїзд') || textBody.includes('від гостя')) result.language = 'uk';
  else if (textBody.includes('Příjezd') || textBody.includes('od hosta')) result.language = 'cs';
  else if (textBody.includes('Anreise') || textBody.includes('vom Gast')) result.language = 'de';
  else if (textBody.includes('Заезд') || textBody.includes('от гостя')) result.language = 'ru';
  else if (textBody.includes('Check-in') || textBody.includes('from guest')) result.language = 'en';

  return result;
}

/**
 * Parse a date like "10 квіт. 2026" → "2026-04-10"
 */
function parseBookingDate(day: string, monthStr: string, year: string): string | null {
  const monthLower = monthStr.toLowerCase().replace('.', '');
  
  const monthMap: Record<string, number> = {
    // Ukrainian
    'січ': 1, 'лют': 2, 'берез': 3, 'квіт': 4, 'трав': 5, 'черв': 6,
    'лип': 7, 'серп': 8, 'верес': 9, 'жовт': 10, 'листоп': 11, 'груд': 12,
    'січня': 1, 'лютого': 2, 'березня': 3, 'квітня': 4, 'травня': 5, 'червня': 6,
    'липня': 7, 'серпня': 8, 'вересня': 9, 'жовтня': 10, 'листопада': 11, 'грудня': 12,
    // English
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    // Czech
    'led': 1, 'úno': 2, 'bře': 3, 'dub': 4, 'kvě': 5, 'čer': 6,
    'čvc': 7, 'srp': 8, 'zář': 9, 'říj': 10, 'lis': 11, 'pro': 12,
    'ledna': 1, 'února': 2, 'března': 3, 'dubna': 4, 'května': 5, 'června': 6,
    'července': 7, 'srpna': 8, 'září': 9, 'října': 10, 'listopadu': 11, 'prosince': 12,
    // German
    'jän': 1, 'mär': 3, 'mai': 5, 'okt': 10, 'dez': 12,
    'januar': 1, 'februar': 2, 'märz': 3, 'juni': 6,
    'juli': 7, 'oktober': 10, 'dezember': 12,
    // Russian
    'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'мая': 5, 'июн': 6,
    'июл': 7, 'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12,
  };

  // Try exact match first, then prefix match
  let month = monthMap[monthLower];
  if (!month) {
    for (const [key, val] of Object.entries(monthMap)) {
      if (monthLower.startsWith(key) || key.startsWith(monthLower)) {
        month = val;
        break;
      }
    }
  }

  if (!month) return null;
  
  const d = parseInt(day);
  const y = parseInt(year);
  return `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Clean Booking.com email body to extract just the guest message.
 * Removes all the boilerplate, tracking pixels, footer, etc.
 */
export function cleanBookingComBody(textBody: string, parsed: BookingComData): string {
  if (parsed.guestMessage) {
    return parsed.guestMessage;
  }
  
  // Fallback: remove common Booking.com boilerplate
  let cleaned = textBody;
  
  // Remove everything before "від гостя" header
  const headerIdx = cleaned.search(/(?:від гостя|from guest|message from)/i);
  if (headerIdx > 0) cleaned = cleaned.substring(headerIdx);
  
  // Remove everything after "Відповісти" or booking details section
  const footerIdx = cleaned.search(/(?:Дані бронювання|Booking details|Відповісти|Reply|admin\.booking\.com|© Copyright|email_opened_tracking)/i);
  if (footerIdx > 0) cleaned = cleaned.substring(0, footerIdx);
  
  // Remove the "від гостя" header itself
  cleaned = cleaned.replace(/(?:від гостя|from guest|message from)\s*\n*/i, '');
  
  // Remove name line (e.g. "Mariia Bohdanets:")
  cleaned = cleaned.replace(/^[A-ZА-ЯІЇЄҐa-zа-яіїєґ\s]+:\s*\n*/m, '');
  
  // Remove tracking and URL artifacts
  cleaned = cleaned.replace(/\[email_opened_tracking.*?\]/g, '');
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  cleaned = cleaned.replace(/--+>/g, '');
  
  // Trim and clean up whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  
  return cleaned || textBody.substring(0, 200);
}
