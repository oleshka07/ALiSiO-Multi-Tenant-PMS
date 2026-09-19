/**
 * A register that answers, and answers the same way every time.
 *
 * It exists so the desk can press "test" on a property that has no provider
 * and see the whole path — settings, shift, receipt, journal — end to end,
 * and so a scene can prove the till's behaviour without a network.
 *
 * Deterministic on purpose: the numbers are derived from the shift counter
 * and the receipt count, not from a clock or a random source. A driver whose
 * answers differ between runs cannot be asserted about, and "it worked when
 * I ran it" is what this product keeps paying for.
 *
 * What it is NOT: a mock of a real provider's shape. Nobody has been chosen
 * yet (docs/research/prro-providers.md), and a mock built from documentation
 * we have not seen answer is exactly how three field mismatches got into the
 * channel client (AGENTS invariant 28). When a provider is picked, its
 * driver is written against LIVE responses and this one stays as it is.
 */
import type {
  PrroDevice, PrroReceipt, PrroReceiptResult, PrroShift, PrroZReport,
} from '../domain/prro-device.ts';

export interface TestDeviceOptions {
  /** Мітка часу, яку віддає пристрій. Фіксована, щоб сцена могла її назвати. */
  now?: string;
  /** Префікс фіскальних номерів — щоб два стенди не збігались у логах. */
  prefix?: string;
}

export function testDevice(options: TestDeviceOptions = {}): PrroDevice {
  const now = options.now ?? '2026-09-19T08:00:00.000Z';
  const prefix = options.prefix ?? 'TEST';
  let shift: PrroShift | null = null;
  let receipts = 0;
  let total = 0;
  let shiftNo = 0;

  const requireShift = (): PrroShift => {
    // Зміна відкривається сама на першому чеку — так поводиться будь-яка
    // каса, і так поводитиметься справжня. Ставити це в обовʼязок
    // викликача означало б розсіяти порядок дій по хендлерах.
    if (!shift) {
      shiftNo += 1;
      shift = { shiftId: `${prefix}-SHIFT-${shiftNo}`, openedAt: now };
      receipts = 0;
      total = 0;
    }
    return shift;
  };

  return {
    async openShift(): Promise<PrroShift> {
      return requireShift();
    },
    async registerReceipt(receipt: PrroReceipt): Promise<PrroReceiptResult> {
      const open = requireShift();
      receipts += 1;
      total += receipt.total;
      return {
        fiscalNumber: `${prefix}-${open.shiftId.split('-').pop()}-${receipts}`,
        registeredAt: now,
        shiftId: open.shiftId,
        receiptUrl: null,
      };
    },
    async closeShift(): Promise<PrroZReport> {
      const open = requireShift();
      const report: PrroZReport = {
        fiscalNumber: `${prefix}-Z-${open.shiftId.split('-').pop()}`,
        shiftId: open.shiftId,
        closedAt: now,
        receiptsCount: receipts,
        total,
      };
      shift = null;
      return report;
    },
  };
}
