'use client';

/**
 * Source icon for booking channels (Booking.com, Airbnb, Direct, etc.)
 * Displays a colored circle with a letter/icon inside.
 * Accepts optional dynamic color/letter props from booking_sources API.
 */

// Fallback defaults for sources not yet in database
const FALLBACK_ICONS: Record<string, { letter: string; bg: string }> = {
  booking_com: { letter: 'B', bg: '#003580' },
  airbnb:      { letter: 'A', bg: '#FF5A5F' },
  direct:      { letter: 'D', bg: '#22c55e' },
  phone:       { letter: '📞', bg: '#3b82f6' },
  whatsapp:    { letter: 'W', bg: '#25D366' },
  other_ota:   { letter: 'O', bg: '#f59e0b' },
};

interface SourceIconProps {
  source: string;
  size?: number;
  /** Override color from booking_sources API */
  iconColor?: string;
  /** Override letter from booking_sources API */
  iconLetter?: string;
}

export default function SourceIcon({ source, size = 32, iconColor, iconLetter }: SourceIconProps) {
  const fallback = FALLBACK_ICONS[source];
  const bg = iconColor || fallback?.bg || '#6c7086';
  const letter = iconLetter || fallback?.letter || source.charAt(0).toUpperCase() || '?';

  return (
    <div
      className="source-icon"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        flexShrink: 0,
        lineHeight: 1,
      }}
      title={source}
    >
      {letter}
    </div>
  );
}
