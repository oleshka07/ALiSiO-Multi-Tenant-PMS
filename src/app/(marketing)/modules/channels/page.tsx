import type { Metadata } from 'next';
import SectionModuleChannels from '../../_design/sections/module-channels';

export const metadata: Metadata = {
  title: 'Channel manager',
  description:
    'Two-way ARI with Booking.com, Airbnb, Expedia and iCal. Rates and availability move in seconds, and parity gaps are closed before they cost you.',
};

export default function ChannelsModulePage() {
  return <SectionModuleChannels />;
}
