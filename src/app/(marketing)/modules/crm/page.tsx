import type { Metadata } from 'next';
import SectionModuleCrm from '../../_design/sections/module-crm';

export const metadata: Metadata = {
  title: 'CRM & AI inbox',
  description:
    'One thread per guest across Telegram, e-mail and the OTAs, answered in twelve languages from your own knowledge base.',
};

export default function CrmModulePage() {
  return <SectionModuleCrm />;
}
