import type { Metadata } from 'next';

// Generic on purpose: this legacy page served ONE customer's branding to
// whoever reached it. Per-site titles live with the sites/widget config.
export const metadata: Metadata = {
  title: 'Бронювання',
  description: 'Онлайн-бронювання',
};

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
