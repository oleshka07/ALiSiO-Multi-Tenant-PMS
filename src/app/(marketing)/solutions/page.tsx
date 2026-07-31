import type { Metadata } from 'next';
import SectionSolutions from '../_design/sections/solutions';

export const metadata: Metadata = {
  title: 'Solutions by property type',
  description:
    'Glampings and camps, boutique hotels, resorts and wellness, groups and management companies — the same system, configured for how each of them actually runs.',
};

export default function SolutionsPage() {
  return <SectionSolutions />;
}
