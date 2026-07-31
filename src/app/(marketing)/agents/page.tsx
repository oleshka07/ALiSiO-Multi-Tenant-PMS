import type { Metadata } from 'next';
import SectionAgents from '../_design/sections/agents';

export const metadata: Metadata = {
  title: 'The AI crew',
  description:
    'Thirteen specialised agents with autonomy levels L0 to L5. Every decision, its reason and its value are written to the Ledger — you choose how much each one is allowed to do.',
};

export default function AgentsPage() {
  return <SectionAgents />;
}
