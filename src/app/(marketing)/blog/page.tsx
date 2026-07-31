import type { Metadata } from 'next';
import SectionBlog from '../_design/sections/blog';

export const metadata: Metadata = {
  title: 'Journal',
  description:
    'Notes on hotel operations, agentic software and the economics of a unit-night, from the team building Alisio.',
};

export default function BlogPage() {
  return <SectionBlog />;
}
