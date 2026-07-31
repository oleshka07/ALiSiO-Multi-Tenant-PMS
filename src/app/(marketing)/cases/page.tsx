import type { Metadata } from 'next';
import SectionCases from '../_design/sections/cases';

export const metadata: Metadata = {
  title: 'Customer stories',
  description:
    'What properties running Alisio measured: hours returned, GOPPAR uplift and the compliance streak they stopped worrying about.',
};

export default function CasesPage() {
  return <SectionCases />;
}
