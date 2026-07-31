import type { Metadata } from 'next';
import SectionModuleGuestPortal from '../../_design/sections/module-guest-portal';

export const metadata: Metadata = {
  title: 'Guest Portal',
  description:
    'Online check-in from the guest’s phone: documents, digital signature, payment before arrival and upsells sold while they are still looking forward to the trip.',
};

export default function GuestPortalModulePage() {
  return <SectionModuleGuestPortal />;
}
