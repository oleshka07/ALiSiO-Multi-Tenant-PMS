import type { Metadata } from 'next';
import SectionModuleCalendar from '../../_design/sections/module-calendar';

export const metadata: Metadata = {
  title: 'Calendar & bookings',
  description:
    'A drag-and-drop booking tape with groups, blocks and split stays. Move a reservation and the price, the folio and the channel follow it.',
};

export default function CalendarModulePage() {
  return <SectionModuleCalendar />;
}
