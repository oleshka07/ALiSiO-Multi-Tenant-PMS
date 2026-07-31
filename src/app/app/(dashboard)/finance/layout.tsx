import FinanceGate from './_components/FinanceGate';
import FinanceTabs from './_components/FinanceTabs';

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <FinanceGate>
      <FinanceTabs />
      {children}
    </FinanceGate>
  );
}
