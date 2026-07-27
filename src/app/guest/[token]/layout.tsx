import type { Metadata } from 'next';

const TITLE = '✅ YOUR PERSONAL PAGE for your reservation';
const DESCRIPTION = '➡️ Check-in information, services, and tourist itineraries and helpful tips';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="guest-page-root">
      {children}
    </div>
  );
}
