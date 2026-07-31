import type { Metadata } from 'next';
import SectionModuleHousekeeping from '../../_design/sections/module-housekeeping';

export const metadata: Metadata = {
  title: 'Housekeeping & tasks',
  description:
    'Pocket cards for the people on the floor, routes re-sequenced around early arrivals, and photo proof attached to the room that needed it.',
};

export default function HousekeepingModulePage() {
  return <SectionModuleHousekeeping />;
}
