/**
 * What the guest page is made of — named, ordered, and switchable.
 *
 * Until now the page was one 1800-line component and its "configuration" was
 * whichever fields happened to be empty: a hotel that wanted no Explore tab
 * had to leave useful_info blank and hope. One hotel's page was every hotel's
 * page — the glamping's stories row, the glamping's restaurant card — and the
 * only way to differ was to not fill things in.
 *
 * This registry names each section once. A property can switch a section off,
 * reorder it, or leave it alone; what it cannot do is invent one — the
 * registry is the authority on what exists, and a row in the database for a
 * key not listed here is a leftover, not a feature. Adding a section for a
 * future hotel is one entry here plus one component on the page — which is
 * the property this whole file exists to hold.
 *
 * The database stores only DIFFERENCES from this registry (guest_page_sections,
 * migration 0022). No rows means exactly the page every hotel had before the
 * registry existed — enabling this mechanism must not change anyone's page.
 */

export type GuestPageSectionKey =
  | 'hero'           // name, dates, countdown, phase banner — the page's spine
  | 'quick_actions'  // the stories row: directions, entry, wifi, parking…
  | 'stay_status'    // today's checklist: confirmed, registration, entry
  | 'registration'   // the guest registration flow (Meldeschein where German law applies)
  | 'payments'       // what is paid, what remains, the pay button
  | 'services'       // the Services tab: ordering, cart
  | 'unit_info'      // "your room": photos, amenities, description
  | 'good_to_know'   // check-in/out times, wifi, pets, support phone
  | 'restaurant'     // the restaurant card and sheet
  | 'explore'        // the Explore tab: surroundings, map
  | 'faq'
  | 'rules'
  | 'feedback';      // the post-checkout feedback prompt

export interface GuestPageSectionDef {
  key: GuestPageSectionKey;
  /** Whether the section shows when the hotel has said nothing. */
  defaultEnabled: boolean;
  /** Position when the hotel has not reordered. Tens, so a hotel can go between. */
  defaultOrder: number;
  /**
   * A section the page cannot function or stay lawful without. `structural`
   * cannot be switched off at all (the page has no meaning without its hero);
   * `jurisdiction` is forced on by the property's country — a German hotel
   * does not get to toggle the Meldeschein away, §§28–30 BMG do not have an
   * off switch in a settings screen.
   */
  required?: 'structural' | 'jurisdiction';
}

/** Countries whose registration duty pins the registration section on. */
const REGISTRATION_LAW = new Set(['DE', 'CZ', 'AT']);

export const GUEST_PAGE_SECTIONS: readonly GuestPageSectionDef[] = [
  { key: 'hero',          defaultEnabled: true,  defaultOrder: 10, required: 'structural' },
  { key: 'quick_actions', defaultEnabled: true,  defaultOrder: 20 },
  { key: 'stay_status',   defaultEnabled: true,  defaultOrder: 30 },
  { key: 'registration',  defaultEnabled: true,  defaultOrder: 40, required: 'jurisdiction' },
  { key: 'payments',      defaultEnabled: true,  defaultOrder: 50 },
  { key: 'services',      defaultEnabled: true,  defaultOrder: 60 },
  { key: 'unit_info',     defaultEnabled: true,  defaultOrder: 70 },
  { key: 'good_to_know',  defaultEnabled: true,  defaultOrder: 80 },
  { key: 'restaurant',    defaultEnabled: true,  defaultOrder: 90 },
  { key: 'explore',       defaultEnabled: true,  defaultOrder: 100 },
  { key: 'faq',           defaultEnabled: true,  defaultOrder: 110 },
  { key: 'rules',         defaultEnabled: true,  defaultOrder: 120 },
  { key: 'feedback',      defaultEnabled: true,  defaultOrder: 130 },
] as const;

export interface StoredSectionRow {
  section: string;
  enabled: unknown;   // 0/1 from SQLite, boolean-shaped 1/0 from the seam
  sort_order: unknown;
  config: string | null;
}

export interface ResolvedSection {
  key: GuestPageSectionKey;
  enabled: boolean;
  order: number;
  /** Why the switch is disabled in the settings screen, when it is. */
  locked: 'structural' | 'jurisdiction' | null;
  /** Free-form per-section knobs. Empty object when the hotel set none. */
  config: Record<string, unknown>;
}

/**
 * The registry with the hotel's differences applied.
 *
 * Every registry section appears exactly once, in the hotel's order. Rows for
 * unknown keys are dropped — the registry decides what exists. A required
 * section comes back enabled no matter what the row says: the row survives
 * (the hotel's other choices in it are kept) but the switch is overridden,
 * and `locked` tells the settings screen to say why instead of showing a
 * toggle that silently springs back.
 */
export function resolveSections(
  rows: readonly StoredSectionRow[],
  ctx: { propertyCountry?: string | null },
): ResolvedSection[] {
  const byKey = new Map<string, StoredSectionRow>();
  for (const row of rows) byKey.set(row.section, row);

  const country = (ctx.propertyCountry ?? '').toUpperCase();

  const out = GUEST_PAGE_SECTIONS.map((def) => {
    const row = byKey.get(def.key);
    const locked: ResolvedSection['locked'] =
      def.required === 'structural' ? 'structural'
      : def.required === 'jurisdiction' && REGISTRATION_LAW.has(country) ? 'jurisdiction'
      : null;

    let config: Record<string, unknown> = {};
    if (row?.config) {
      try { config = JSON.parse(row.config); } catch { config = {}; }
    }

    return {
      key: def.key,
      enabled: locked ? true : (row != null ? Boolean(Number(row.enabled)) : def.defaultEnabled),
      order: row != null && row.sort_order != null ? Number(row.sort_order) : def.defaultOrder,
      locked,
      config,
    };
  });

  // Stable by order, registry position breaking ties — so two sections a
  // hotel dragged to the same number do not swap between page loads.
  return out.sort((a, b) => a.order - b.order
    || GUEST_PAGE_SECTIONS.findIndex((d) => d.key === a.key)
     - GUEST_PAGE_SECTIONS.findIndex((d) => d.key === b.key));
}

export function isKnownSection(key: string): key is GuestPageSectionKey {
  return GUEST_PAGE_SECTIONS.some((d) => d.key === key);
}
