import type { Metadata } from 'next';
import SectionModuleCompliance from '../../_design/sections/module-compliance';

export const metadata: Metadata = {
  title: 'Compliance & trust',
  description:
    'Foreign police filings, city tax, DAC7 and GDPR handled on schedule — with an audit trail you can hand to an inspector.',
};

export default function ComplianceModulePage() {
  return <SectionModuleCompliance />;
}
