import type { Metadata } from 'next';
import SectionProduct from '../_design/sections/product';

export const metadata: Metadata = {
  title: 'The platform',
  description:
    'Fourteen modules on one event spine: calendar, channel manager, finance, guest portal, CRM, compliance and housekeeping — with an AI crew on top of each.',
};

export default function ProductPage() {
  return <SectionProduct />;
}
