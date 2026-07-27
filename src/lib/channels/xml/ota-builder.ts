/**
 * OTA XML Builder — OpenTravel Alliance v2003B format
 * 
 * Builds XML messages for Booking.com API:
 * - OTA_HotelInvNotif (inventory/availability)
 * - OTA_HotelRateAmountNotif (rates)
 * - OTA_HotelResNotif acknowledgement
 * 
 * Uses manual string building (no XML library needed — templates are well-defined).
 */

import type {
  ARIInventoryUpdate,
  ARIRateUpdate,
  ARIRestrictionUpdate,
} from '../types';

// ─── XML Escaping ────────────────────────────────────────────

function escapeXml(unsafe: string | number): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(date: string): string {
  // Ensure YYYY-MM-DD format
  return date.substring(0, 10);
}

// ─── OTA_HotelInvNotif — Inventory / Availability ────────────

/**
 * Build OTA_HotelInvNotif XML for pushing inventory (room count) to Booking.com.
 * 
 * @param hotelCode - Booking.com property ID
 * @param updates - Array of inventory updates
 */
export function buildHotelInvNotif(
  hotelCode: string,
  updates: ARIInventoryUpdate[],
): string {
  const inventoryItems = updates.map(u => `
    <AvailStatusMessage>
      <StatusApplicationControl
        Start="${escapeXml(formatDate(u.dateFrom))}"
        End="${escapeXml(formatDate(u.dateTo))}"
        InvTypeCode="${escapeXml(u.roomTypeId)}"
      />
      <LengthsOfStay/>
      <RestrictionStatus Status="Open"/>
      <HotelAvailability AvailCount="${u.availableCount}"/>
    </AvailStatusMessage>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelAvailNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="3.000">
  <AvailStatusMessages HotelCode="${escapeXml(hotelCode)}">
    ${inventoryItems}
  </AvailStatusMessages>
</OTA_HotelAvailNotifRQ>`;
}

// ─── OTA_HotelRateAmountNotif — Rates ────────────────────────

/**
 * Build OTA_HotelRateAmountNotif XML for pushing rates to Booking.com.
 * Standard pricing model: one price for max occupancy.
 * 
 * @param hotelCode - Booking.com property ID
 * @param rates - Array of rate updates
 */
export function buildHotelRateAmountNotif(
  hotelCode: string,
  rates: ARIRateUpdate[],
): string {
  const rateItems = rates.map(r => `
    <RateAmountMessage>
      <StatusApplicationControl
        Start="${escapeXml(formatDate(r.dateFrom))}"
        End="${escapeXml(formatDate(r.dateTo))}"
        InvTypeCode="${escapeXml(r.roomTypeId)}"
        RatePlanCode="${escapeXml(r.ratePlanId)}"
      />
      <Rates>
        <Rate>
          <BaseByGuestAmts>
            <BaseByGuestAmt AmountAfterTax="${r.basePrice.toFixed(2)}" CurrencyCode="${escapeXml(r.currency)}"/>
          </BaseByGuestAmts>
        </Rate>
      </Rates>
    </RateAmountMessage>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelRateAmountNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="3.000">
  <RateAmountMessages HotelCode="${escapeXml(hotelCode)}">
    ${rateItems}
  </RateAmountMessages>
</OTA_HotelRateAmountNotifRQ>`;
}

// ─── Restrictions (min/max stay, closed) ─────────────────────

/**
 * Build OTA_HotelInvNotif XML for pushing restrictions (min_stay, closed, CTA, CTD).
 * Restrictions are sent via the same AvailNotif endpoint.
 */
export function buildRestrictions(
  hotelCode: string,
  restrictions: ARIRestrictionUpdate[],
): string {
  const items = restrictions.map(r => {
    const losNodes: string[] = [];
    if (r.minStay > 1) {
      losNodes.push(`<LengthOfStay Time="${r.minStay}" MinMaxMessageType="SetMinLOS"/>`);
    }
    if (r.maxStay && r.maxStay > 0) {
      losNodes.push(`<LengthOfStay Time="${r.maxStay}" MinMaxMessageType="SetMaxLOS"/>`);
    }

    const statusAttrs: string[] = [];
    if (r.closed) statusAttrs.push('Status="Close"');
    else statusAttrs.push('Status="Open"');
    if (r.closedToArrival) statusAttrs.push('Restriction="Arrival"');
    if (r.closedToDeparture) statusAttrs.push('Restriction="Departure"');

    return `
    <AvailStatusMessage>
      <StatusApplicationControl
        Start="${escapeXml(formatDate(r.dateFrom))}"
        End="${escapeXml(formatDate(r.dateTo))}"
        InvTypeCode="${escapeXml(r.roomTypeId)}"
        RatePlanCode="${escapeXml(r.ratePlanId)}"
      />
      ${losNodes.length > 0 ? `<LengthsOfStay>${losNodes.join('')}</LengthsOfStay>` : '<LengthsOfStay/>'}
      <RestrictionStatus ${statusAttrs.join(' ')}/>
    </AvailStatusMessage>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelAvailNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="3.000">
  <AvailStatusMessages HotelCode="${escapeXml(hotelCode)}">
    ${items}
  </AvailStatusMessages>
</OTA_HotelAvailNotifRQ>`;
}

// ─── Reservation Acknowledgement ─────────────────────────────

/**
 * Build OTA_HotelResNotif POST body for acknowledging reservations.
 * 
 * @param reservationIds - Array of Booking.com reservation IDs to acknowledge
 */
export function buildResNotifAcknowledge(
  reservationIds: string[],
): string {
  const items = reservationIds.map(id =>
    `<HotelReservation ResStatus="Commit">
      <UniqueID Type="14" ID="${escapeXml(id)}"/>
    </HotelReservation>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelResNotifRS xmlns="http://www.opentravel.org/OTA/2003/05" Version="3.000">
  <HotelReservations>
    ${items}
  </HotelReservations>
</OTA_HotelResNotifRS>`;
}

// ─── OTA_HotelDescriptiveInfo — Read-back ────────────────────

/**
 * Build OTA_HotelDescriptiveInfo request to read back current state from Booking.com.
 */
export function buildHotelDescriptiveInfoRequest(hotelCode: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelDescriptiveInfoRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="3.000">
  <HotelDescriptiveInfos>
    <HotelDescriptiveInfo HotelCode="${escapeXml(hotelCode)}">
      <HotelInfo SendData="true"/>
      <FacilityInfo SendData="true"/>
      <AreaInfo SendData="false"/>
      <ContactInfo SendData="false"/>
    </HotelDescriptiveInfo>
  </HotelDescriptiveInfos>
</OTA_HotelDescriptiveInfoRQ>`;
}

// ─── Reservation Summary Request ─────────────────────────────

/**
 * Build reservation summary request for recovery after outage.
 */
export function buildReservationSummaryRequest(hotelCode: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <hotel_id>${escapeXml(hotelCode)}</hotel_id>
</request>`;
}
