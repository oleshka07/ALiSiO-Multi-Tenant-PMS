import type { Metadata, Viewport } from 'next';
import './kiosk.css';

/**
 * Оболонка екрана в холі: без шапки адмінки, без меню, без теми оператора.
 *
 * Це не «сторінка PMS без хедера» — це інший продукт на тому самому сервері.
 * Усе, що робить адмінку адмінкою (навігація, перемикач обʼєкта, профіль),
 * тут не просто зайве: воно — двері, яких у холі бути не має.
 *
 * `userScalable: false` і фіксований масштаб: гість не мусить випадково
 * розтягнути екран двома пальцями так, що кнопка «Check-in» поїде за край, а
 * повернути її нема кому.
 */

export const metadata: Metadata = {
  title: 'Check-in',
  // Термінал не індексується: це внутрішній екран готелю, а не сторінка.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b1120',
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="kiosk-root">{children}</div>;
}
