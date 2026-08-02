import BookingIframePage from '@/modules/widget/ui/BookingIframePage';

/**
 * The iframe embed a hotel pastes into its own site: /booking?site=slug
 *
 * A second, older widget implementation, separate from BookingV2 at
 * /w/[siteSlug] — 2 100 lines with its own stylesheet, its own copy of the
 * types and its own booking flow. Both are shipped to customers today. Which
 * one survives is a decision for later; keeping both inside the widget module
 * is what makes that decision a local one.
 */
export default BookingIframePage;
