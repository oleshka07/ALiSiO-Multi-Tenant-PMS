/**
 * fiskaly SIGN DE — the first real TSE behind the FiscalDevice seam.
 *
 * The cloud TSE speaks a small dance: authenticate (api key + secret → a
 * short-lived bearer token), open a transaction (state ACTIVE), close it
 * (state FINISHED) with the receipt's amounts — and the CLOSE response
 * carries everything §6 wants: transaction number, signature with its
 * counter, both timestamps, and the qr_code_data the beleg prints.
 *
 * Credentials come from channel_credentials (channel 'fiskaly': api key in
 * client_id, api secret in client_secret) — the same mechanism as Teya and
 * Hostex, and NOT the hotel file: these are secrets. Which TSS and which
 * registered client a PROPERTY uses are identifiers, not secrets, and live
 * in fin_fiscal_settings.
 *
 * Errors are thrown, not swallowed: the caller (folio-payments.repo) is the
 * one who knows that a failed signature must not block a checkout but must
 * mark the payment and journal the outage.
 */
import {
  type FiscalDevice, type FiscalReceipt, type FiscalSignature,
  dsfinvkVatField, dsfinvkPaymentType, fiscalAmount,
} from '../domain/fiscal/fiscal-device';

const BASE = process.env.FISKALY_BASE_URL || 'https://kassensichv.fiskaly.com/api/v2';

export interface FiskalyConfig {
  apiKey: string;
  apiSecret: string;
  tssId: string;
  clientId: string;
}

async function call(path: string, init: RequestInit & { token?: string }): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fiskaly ${init.method} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export function fiskalyDevice(config: FiskalyConfig): FiscalDevice {
  return {
    async signReceipt(receipt: FiscalReceipt): Promise<FiscalSignature> {
      const auth = await call('/auth', {
        method: 'POST',
        body: JSON.stringify({ api_key: config.apiKey, api_secret: config.apiSecret }),
      });
      const token = auth.access_token;

      const txId = crypto.randomUUID();
      await call(`/tss/${config.tssId}/tx/${txId}?tx_revision=1`, {
        method: 'PUT', token,
        body: JSON.stringify({ state: 'ACTIVE', client_id: config.clientId }),
      });

      // The receipt schema: every VAT bucket the invoice carries, and one
      // payment line. Amounts are gross, dot-decimal strings.
      const amounts = receipt.vatAmounts.length
        ? receipt.vatAmounts.map((v) => ({
            vat_rate: dsfinvkVatField(v.rate),
            amount: fiscalAmount(v.amount),
          }))
        // No split known — the whole sum in the zero bucket would claim "no
        // VAT", which is a tax statement. Refuse instead: the caller must
        // hand us the invoice's split.
        : (() => { throw new Error('Receipt has no VAT split — sign the invoice, not a bare number'); })();

      const finished = await call(`/tss/${config.tssId}/tx/${txId}?tx_revision=2`, {
        method: 'PUT', token,
        body: JSON.stringify({
          state: 'FINISHED',
          client_id: config.clientId,
          schema: {
            standard_v1: {
              receipt: {
                receipt_type: 'RECEIPT',
                amounts_per_vat_rate: amounts,
                amounts_per_payment_type: [{
                  payment_type: dsfinvkPaymentType(receipt.method),
                  amount: fiscalAmount(receipt.amount),
                }],
              },
            },
          },
        }),
      });

      // The TSS serial is on the TSS resource, not the transaction.
      const tss = await call(`/tss/${config.tssId}`, { method: 'GET', token });

      return {
        tseSerial: String(tss.serial_number ?? config.tssId),
        txNumber: String(finished.number),
        signatureCounter: String(finished.signature?.counter ?? ''),
        signature: String(finished.signature?.value ?? ''),
        startTime: String(finished.time_start ?? ''),
        endTime: String(finished.time_end ?? ''),
        qrPayload: String(finished.qr_code_data ?? ''),
        clientId: config.clientId,
        processType: 'Kassenbeleg-V1',
        processData: String(finished.schema?.standard_v1 ? JSON.stringify(finished.schema.standard_v1) : ''),
      };
    },
  };
}
