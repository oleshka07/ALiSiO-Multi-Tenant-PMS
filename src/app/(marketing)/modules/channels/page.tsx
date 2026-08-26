import type { Metadata } from 'next';
import SectionModuleChannels from '../../_design/sections/module-channels';

export const metadata: Metadata = {
  title: 'Channel manager',
  description:
    'One calendar across Booking.com, Airbnb, Expedia and any iCal channel: availability stays in sync and double bookings are closed before they cost you.',
};

export default function ChannelsModulePage() {
  return <SectionModuleChannels />;
}
