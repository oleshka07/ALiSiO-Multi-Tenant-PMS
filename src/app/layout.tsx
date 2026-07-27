import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ALiSiO Multi-Tenant PMS',
  description: 'Cloud-Native SaaS Property Management System for Hotels & Rentals',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body>
        <main className="min-h-screen bg-slate-900 text-slate-100">{children}</main>
      </body>
    </html>
  );
}
