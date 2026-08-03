/**
 * OTA XML Parser — parses Booking.com API XML responses
 * 
 * Parses reservation data from OTA_HotelResNotif responses into
 * structured OTAReservation objects compatible with PMS database.
 * 
 * Uses regex-based parsing (OTA XML structure is predictable).
 */

import type { OTAReservation } from '../types';

// ─── Helper: extract XML tag content ─────────────────────────

function getTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function getAttribute(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function getAllBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const regex = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

// ─── Parse Reservation Response ──────────────────────────────

/**
 * Parse OTA_HotelResNotif response XML into OTAReservation objects.
 */
export function parseResNotifResponse(xml: string): OTAReservation[] {
  const reservations: OTAReservation[] = [];
  const hotelResBlocks = getAllBlocks(xml, 'HotelReservation');

  for (const block of hotelResBlocks) {
    try {
      const reservation = parseHotelReservation(block);
      if (reservation) {
        reservations.push(reservation);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[OTA Parser] Failed to parse reservation block:', msg);
    }
  }

  return reservations;
}

/**
 * Parse a single HotelReservation XML block.
 */
function parseHotelReservation(xml: string): OTAReservation | null {
  // Reservation ID
  const reservationId = getAttribute(xml, 'UniqueID', 'ID')
    || getAttribute(xml, 'HotelReservation', 'ResID_Value');
  
  if (!reservationId) return null;

  // Status
  const resStatus = getAttribute(xml, 'HotelReservation', 'ResStatus') || 'Commit';
  let status: 'new' | 'modified' | 'cancelled' = 'new';
  if (resStatus === 'Cancel') status = 'cancelled';
  else if (resStatus === 'Modify') status = 'modified';

  // Timestamps
  const createDateTime = getAttribute(xml, 'HotelReservation', 'CreateDateTime') || new Date().toISOString();
  const lastModifyDateTime = getAttribute(xml, 'HotelReservation', 'LastModifyDateTime') || null;

  // Guest details (Primary)
  const guestBlock = getAllBlocks(xml, 'ResGuest')[0] || xml;
  const personName = getAllBlocks(guestBlock, 'PersonName')[0] || '';
  const firstName = getTagContent(personName, 'GivenName') || 'Guest';
  const lastName = getTagContent(personName, 'Surname') || '';
  
  // Email & Phone
  const email = getTagContent(xml, 'Email') || '';
  const phone = getAttribute(xml, 'Telephone', 'PhoneNumber') || null;

  // Genius status
  const isGeniusGuest = xml.includes('Genius') || xml.includes('genius');

  // Guest Names (all)
  const guestNames: Array<{ firstName: string; lastName: string }> = [];
  const pnBlocks = getAllBlocks(xml, 'PersonName');
  for (const pn of pnBlocks) {
    const gn = getTagContent(pn, 'GivenName');
    const sn = getTagContent(pn, 'Surname');
    if (gn || sn) {
      guestNames.push({ firstName: gn || '', lastName: sn || '' });
    }
  }
  if (guestNames.length === 0) {
    guestNames.push({ firstName, lastName });
  }

  // Guest count
  const guestCountBlocks = getAllBlocks(xml, 'GuestCount');
  let adults = 1, children = 0;
  const childAges: number[] = [];
  for (const gc of guestCountBlocks) {
    const aqc = getAttribute(gc, 'GuestCount', 'AgeQualifyingCode');
    const count = parseInt(getAttribute(gc, 'GuestCount', 'Count') || '0');
    const age = parseInt(getAttribute(gc, 'GuestCount', 'Age') || '0');
    if (aqc === '10') adults = count;   // Adult
    if (aqc === '8') {
      children = count;  // Child
      if (age > 0) childAges.push(age);
    }
  }

  // Room
  const roomTypeCode = getAttribute(xml, 'RoomType', 'RoomTypeCode')
    || getAttribute(xml, 'RoomStay', 'RoomTypeCode')
    || '';
  const roomName = getAttribute(xml, 'RoomType', 'RoomDescription') || roomTypeCode;

  // Rate Plan
  const ratePlanCode = getAttribute(xml, 'RatePlan', 'RatePlanCode')
    || getAttribute(xml, 'RoomRate', 'RatePlanCode')
    || '';
  const rateName = getAttribute(xml, 'RatePlan', 'RatePlanName') || ratePlanCode;
  const mealPlan = getAttribute(xml, 'MealsIncluded', 'MealPlanCodes') || null;
  const cancellationPolicy = getTagContent(xml, 'CancelPenalty') || null;

  // Dates
  const checkIn = getAttribute(xml, 'TimeSpan', 'Start')
    || getAttribute(xml, 'DateRange', 'Start')
    || '';
  const checkOut = getAttribute(xml, 'TimeSpan', 'End')
    || getAttribute(xml, 'DateRange', 'End')
    || '';

  // Prices per night
  const pricePerNight: Array<{ date: string; price: number; currency: string }> = [];
  const rateBlocks = getAllBlocks(xml, 'Rate');
  for (const rb of rateBlocks) {
    const effectiveDate = getAttribute(rb, 'Rate', 'EffectiveDate');
    const bgaBlocks = getAllBlocks(rb, 'BaseByGuestAmt');
    for (const bga of bgaBlocks) {
      const amount = parseFloat(getAttribute(bga, 'BaseByGuestAmt', 'AmountAfterTax') || '0');
      const curr = getAttribute(bga, 'BaseByGuestAmt', 'CurrencyCode') || 'CZK';
      if (effectiveDate && amount > 0) {
        pricePerNight.push({ date: effectiveDate, price: amount, currency: curr });
      }
    }
  }

  // Total price
  const totalStr = getAttribute(xml, 'Total', 'AmountAfterTax')
    || getAttribute(xml, 'TotalAmount', 'Amount')
    || '0';
  const totalPrice = parseFloat(totalStr);
  const currency = getAttribute(xml, 'Total', 'CurrencyCode')
    || (pricePerNight.length > 0 ? pricePerNight[0].currency : 'CZK');

  // Taxes
  const taxes: Array<{ name: string; amount: number; currency: string }> = [];
  const taxBlocks = getAllBlocks(xml, 'Tax');
  for (const tb of taxBlocks) {
    const taxAmount = parseFloat(getAttribute(tb, 'Tax', 'Amount') || '0');
    const taxCurr = getAttribute(tb, 'Tax', 'CurrencyCode') || currency;
    const taxName = getAttribute(tb, 'TaxDescription', 'Name') || 'Tax';
    if (taxAmount > 0) {
      taxes.push({ name: taxName, amount: taxAmount, currency: taxCurr });
    }
  }

  // Promotions
  const promotions: string[] = [];
  const promoBlocks = getAllBlocks(xml, 'Promotion');
  for (const pb of promoBlocks) {
    const promoName = getAttribute(pb, 'Promotion', 'PromotionName');
    if (promoName) promotions.push(promoName);
  }

  // Add-ons
  const addOns: Array<{ name: string; price: number; currency: string }> = [];
  const addonBlocks = getAllBlocks(xml, 'Service');
  for (const ab of addonBlocks) {
    const svcName = getAttribute(ab, 'Service', 'ServiceDescription') || 'Service';
    const svcPrice = parseFloat(getAttribute(ab, 'Service', 'Amount') || '0');
    if (svcName && svcPrice > 0) {
      addOns.push({ name: svcName, price: svcPrice, currency });
    }
  }

  // Smoking preference
  const smokingPref = getAttribute(xml, 'RoomType', 'IsNonSmoking');
  const smokingPreference: 'smoking' | 'non-smoking' | 'no_preference' =
    smokingPref === 'true' ? 'non-smoking' :
    smokingPref === 'false' ? 'smoking' : 'no_preference';

  // Special requests
  const specialRequests = getTagContent(xml, 'SpecialRequest') 
    || getTagContent(xml, 'Comment')
    || null;

  // Rate-rewriting
  const rateRewriting = getTagContent(xml, 'RateRewriting') || null;

  // Credit card (PCI)
  const ccBlock = getAllBlocks(xml, 'PaymentCard')[0] || null;
  let creditCard = null;
  if (ccBlock) {
    creditCard = {
      cardType: getAttribute(ccBlock, 'PaymentCard', 'CardType') || '',
      cardNumber: getAttribute(ccBlock, 'PaymentCard', 'CardNumber') || '',
      expiryDate: getAttribute(ccBlock, 'PaymentCard', 'ExpireDate') || '',
      cardHolderName: getTagContent(ccBlock, 'CardHolderName') || '',
      cvc: getAttribute(ccBlock, 'PaymentCard', 'SeriesCode') || null,
    };
  }

  return {
    externalReservationId: reservationId,
    status,
    createdAt: createDateTime,
    modifiedAt: lastModifyDateTime,
    bookerFirstName: firstName,
    bookerLastName: lastName,
    bookerEmail: email,
    bookerPhone: phone,
    isGeniusGuest,
    guestNames,
    totalGuests: adults + children,
    adults,
    children,
    childAges,
    roomName,
    roomTypeCode,
    rateName,
    ratePlanCode,
    mealPlan,
    cancellationPolicy,
    promotions,
    rateRewriting,
    addOns,
    checkIn: formatDateStr(checkIn),
    checkOut: formatDateStr(checkOut),
    pricePerNight,
    taxes,
    totalPrice,
    currency,
    smokingPreference,
    specialRequests,
    creditCard,
  };
}

/**
 * Parse error responses from Booking.com XML APIs.
 */
export function parseErrorResponse(xml: string): {
  hasError: boolean;
  errorCode: string | null;
  errorMessage: string | null;
} {
  const errorCode = getAttribute(xml, 'Error', 'Code');
  const errorMessage = getAttribute(xml, 'Error', 'ShortText')
    || getTagContent(xml, 'Error');

  return {
    hasError: !!(errorCode || errorMessage),
    errorCode,
    errorMessage,
  };
}

/**
 * Check if an XML response indicates success.
 */
export function isSuccessResponse(xml: string): boolean {
  const error = parseErrorResponse(xml);
  if (error.hasError) return false;
  // Check for success indicators
  return xml.includes('Success') || !xml.includes('<Error');
}

// ─── Helpers ─────────────────────────────────────────────────

function formatDateStr(dateStr: string): string {
  if (!dateStr) return '';
  // Handle ISO dates and OTA date formats
  const match = dateStr.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return dateStr.substring(0, 10);
}
