import type { Metadata } from 'next';
import SectionPostGopparUplift from '../../_design/sections/post-goppar-uplift';

export const metadata: Metadata = {
  title: 'Proving GOPPAR uplift',
  description:
    'Why a randomised holdout baseline is the only honest way to claim a revenue uplift, and how we measure ours.',
};

export default function GopparUpliftPostPage() {
  return <SectionPostGopparUplift />;
}
