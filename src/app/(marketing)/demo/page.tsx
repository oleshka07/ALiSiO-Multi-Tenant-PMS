import type { Metadata } from 'next';
import SectionDemo from '../_design/sections/demo';

export const metadata: Metadata = {
  title: 'Book a demo',
  description:
    'Tell us your unit count, channel mix and what hurts most — you get a real number in EUR and CZK, not a pricing tier.',
};

export default function DemoPage() {
  return <SectionDemo />;
}
