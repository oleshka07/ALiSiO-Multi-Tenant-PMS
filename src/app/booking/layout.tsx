import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ALiSiO Glamping — Бронювання',
  description: 'Забронюйте глемпінг-будиночок в ALiSiO Resort, Лугачовіце',
};

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
