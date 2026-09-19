/**
 * The driver for a till that has no provider yet.
 *
 * It refuses, by name, on every action. That is the whole point: a hotel
 * whose fiscal module is switched on but whose register is not connected
 * must see a failed operation in the journal, not a receipt that quietly
 * went nowhere. Silence here would be the worst of the three outcomes —
 * money taken, no receipt, nothing on the screen.
 *
 * It is also the default in `prro_settings.driver`, so a property that has
 * never been configured behaves this way rather than picking a provider on
 * its own.
 */
import type { PrroDevice, PrroReceipt, PrroReceiptResult, PrroShift, PrroZReport } from '../domain/prro-device.ts';

/** Один текст на всі три дії: причина в них спільна. */
export const NO_DRIVER_MESSAGE =
  'No fiscal register is connected for this property — choose a driver in Settings → Фіскалізація України';

export function noneDevice(): PrroDevice {
  const refuse = (): never => { throw new Error(NO_DRIVER_MESSAGE); };
  return {
    async openShift(): Promise<PrroShift> { return refuse(); },
    async registerReceipt(_receipt: PrroReceipt): Promise<PrroReceiptResult> { return refuse(); },
    async closeShift(): Promise<PrroZReport> { return refuse(); },
  };
}
