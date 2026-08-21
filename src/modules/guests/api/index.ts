// Guests module public API
import { NextResponse } from 'next/server';
import { withGuestReservation } from '../data/guest-scope';
import { getGuestPortal as _getGuestPortal } from './portal.handlers';
import { registerGuests as _registerGuests } from './register.handlers';
import { submitFeedback as _submitFeedback } from './feedback.handlers';
import { orderServices as _orderServices } from './services.handlers';
import { handleCartEvent as _handleCartEvent } from './cart.handlers';

export { listGuests, createGuest } from './guests.handlers';
export { getGuest, updateGuest, deleteGuest } from './guest.handlers';

/**
 * The guest portal's guard: resolve the link's token, then run as that hotel.
 *
 * Every handler below already looks the reservation up by token itself. That
 * lookup is scoped like everything else, so with no organization set it matched
 * nothing and the entire portal answered 404 — its own booking, invisible to
 * the guest holding the link. This resolves the tenant first, from the one row
 * the token names, and the handlers then work unchanged.
 *
 * A token that names nothing gives 404, and so does a token whose reservation
 * has no organization. Same answer either way: a different one would tell a
 * stranger which tokens exist.
 */
type GuestCtx = { params: Promise<{ token: string }> };
function withGuest<R>(handler: (request: any, context: GuestCtx) => Promise<R>) {
  return async (request: any, context: GuestCtx) => {
    const { token } = await context.params;
    const answer = await withGuestReservation(token, () => handler(request, context));
    return answer ?? NextResponse.json({ error: 'Not found' }, { status: 404 });
  };
}

export const getGuestPortal   = withGuest(_getGuestPortal);
export const registerGuests   = withGuest(_registerGuests);
export const submitFeedback   = withGuest(_submitFeedback);
export const orderServices    = withGuest(_orderServices);
export const handleCartEvent  = withGuest(_handleCartEvent);
export { getRegistry, updateRegistryEntry, exportRegistry } from './registry.handlers';
export { getMeldeschein } from './meldeschein.handlers';
export { listGuestPageSections, updateGuestPageSections, getGuestPagePreview } from './guest-page-sections.handlers';


// Domain types
export type { GuestWithStats, CreateGuestInput, RegisteredGuest } from '../domain/types';

// Unified dedup helper — call from any handler that creates/finds a guest
// (manual booking, group booking, channel sync, Excel import, email parser).
// Strategy: email → phone → first+last name (case-insensitive), all scoped
// to organization_id. Soft-merges new fields without overwriting existing ones.
export { findOrCreateGuest } from '../data/guest-dedup.repo';
export type { GuestDedupArgs, GuestDedupResult } from '../data/guest-dedup.repo';
