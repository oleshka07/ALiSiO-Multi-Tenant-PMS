import { getPnl2 } from '@finance/reports.pnl2';
import { withFinanceRead } from '@finance/_guard';
export const GET = await withFinanceRead(getPnl2);
