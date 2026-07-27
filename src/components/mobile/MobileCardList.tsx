'use client';

import { Loader2 } from 'lucide-react';

/**
 * MobileCardList — wraps a desktop table view + mobile card view.
 *
 * Shows `desktopContent` on desktop (wrapped in .desktop-only)
 * Shows `cards` rendered via `renderCard` on mobile (wrapped in .mobile-only)
 *
 * Usage:
 *   <MobileCardList
 *     items={bookings}
 *     loading={loading}
 *     emptyMessage="Нічого не знайдено"
 *     renderCard={(booking) => <BookingCard booking={booking} />}
 *     desktopContent={<table>...</table>}
 *   />
 */

interface MobileCardListProps<T> {
  items: T[];
  loading: boolean;
  emptyMessage?: string;
  renderCard: (item: T, index: number) => React.ReactNode;
  desktopContent: React.ReactNode;
  keyExtractor?: (item: T) => string;
}

export default function MobileCardList<T>({
  items,
  loading,
  emptyMessage = 'Нічого не знайдено',
  renderCard,
  desktopContent,
}: MobileCardListProps<T>) {
  return (
    <>
      {/* Desktop view */}
      <div className="desktop-only">
        {desktopContent}
      </div>

      {/* Mobile card list */}
      <div className="mobile-only">
        {loading && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
            <Loader2 size={20} className="animate-pulse" style={{ display: 'inline-block' }} /> Завантаження...
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
            {emptyMessage}
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className="card-list">
            {items.map((item, i) => renderCard(item, i))}
          </div>
        )}
      </div>
    </>
  );
}
