import type { Metadata } from 'next';
import SectionAbout from '../_design/sections/about';

export const metadata: Metadata = {
  title: 'About ROZUM',
  description:
    'The team building Alisio PMS for independent hotels, glampings and apartments in Central Europe.',
};

export default function AboutPage() {
  return <SectionAbout />;
}
