import type { Metadata } from 'next';
import SectionIntegrations from '../_design/sections/integrations';

export const metadata: Metadata = {
  title: 'Integrations',
  description:
    'Channels, payments, accounting, messaging and an open API — plus an MCP endpoint, so your own agents can talk to the property directly.',
};

export default function IntegrationsPage() {
  return <SectionIntegrations />;
}
