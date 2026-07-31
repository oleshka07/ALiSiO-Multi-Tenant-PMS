import type { Metadata } from 'next';
import SectionPostAutonomyLevels from '../../_design/sections/post-autonomy-levels';

export const metadata: Metadata = {
  title: 'Autonomy levels L0–L5',
  description:
    'From observer to owning a KPI: a trust contract for software that acts, and what each level should be allowed to touch.',
};

export default function AutonomyLevelsPostPage() {
  return <SectionPostAutonomyLevels />;
}
