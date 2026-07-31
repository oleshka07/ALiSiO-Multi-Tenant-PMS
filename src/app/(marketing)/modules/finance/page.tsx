import type { Metadata } from 'next';
import SectionModuleFinance from '../../_design/sections/module-finance';

export const metadata: Metadata = {
  title: 'Finance, P&L and GOPPAR',
  description:
    'Profit per unit-night, live. Cash, card, acquiring and capex in one ledger, with bank statements reconciled against reservations automatically.',
};

export default function FinanceModulePage() {
  return <SectionModuleFinance />;
}
