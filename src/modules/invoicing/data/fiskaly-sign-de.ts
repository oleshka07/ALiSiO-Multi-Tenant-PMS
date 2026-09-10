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
import { getSql } from '../../../core/db/async.ts';
import { currentOrganizationId } from '../../../core/auth/tenant-context.ts';
import { reportError, reportOk } from '../../../core/app-connections.ts';
import { ALL_PROPERTIES, propertyScopeFilter } from '../../../core/property-scope.ts';

// Чинна адреса middleware (Блок «Застосунки» 3.8, 09.09.2026); стара
// `kassensichv.fiskaly.com` — застаріла. Середовища TEST/LIVE у fiskaly
// розрізняються КЛЮЧЕМ, не адресою.
const BASE = process.env.FISKALY_BASE_URL || 'https://kassensichv-middleware.fiskaly.com/api/v2';

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

/**
 * Стан звʼязку з fiskaly — у `app_connections` (Блок «Застосунки», 3.4).
 *
 * Єдине місце в цьому модулі, яке про нього звітує: успіх після повного
 * підпису, відмова з ТЕКСТОМ вендора. Підключення TSE належить ОБʼЄКТУ, а
 * конфіг знає лише `tssId` — обʼєкт знаходиться за ним у
 * `fin_fiscal_settings` тієї самої організації. Не знайшли обʼєкт або
 * організацію — звіту немає, але підпис від цього не змінюється: стан звʼязку
 * ніколи не ламає операцію, яку описує (`reportOk`/`reportError` не кидають).
 */
async function reported<T>(config: Pick<FiskalyConfig, 'tssId'>, work: () => Promise<T>, knownPropertyId?: string): Promise<T> {
  const organizationId = currentOrganizationId();
  let propertyId: string | null = knownPropertyId ?? null;
  if (organizationId && !propertyId) {
    try {
      // Обʼєкт тут — ВІДПОВІДЬ, а не умова: шукаємо, чия це TSS, по всьому
      // рахунку (INC-029, написано словом).
      const anyProperty = propertyScopeFilter(ALL_PROPERTIES, '');
      const row = await getSql().row<{ property_id: string }>(
        `SELECT property_id FROM fin_fiscal_settings WHERE tss_id = ? AND organization_id = ? AND ${anyProperty.sql}`,
        [config.tssId, organizationId, ...anyProperty.params]);
      propertyId = row?.property_id ?? null;
    } catch { /* без обʼєкта — без звіту, підпис іде далі */ }
  }
  try {
    const out = await work();
    if (organizationId) await reportOk('fiskaly', organizationId, propertyId);
    return out;
  } catch (e) {
    if (organizationId) await reportError('fiskaly', organizationId, e, propertyId);
    throw e;
  }
}

export function fiskalyDevice(config: FiskalyConfig): FiscalDevice {
  return {
    signReceipt: (receipt) => reported(config, () => signReceipt(config, receipt)),
  };
}

async function signReceipt(config: FiskalyConfig, receipt: FiscalReceipt): Promise<FiscalSignature> {
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
}

// ─── Підключення TSE (Блок «Застосунки» 3.8) ───────────────────────────────

/** Що повертає підключення: ідентифікатори — у fin_fiscal_settings, секрети — під seal(). */
export interface FiskalyTss {
  tssId: string;
  clientId: string;
  serialNumber: string;
  adminPin: string;
  adminPuk: string;
}

/**
 * Створити TSS і касового клієнта для ОБʼЄКТА — кроки 2–3 quickstart
 * (workspace.fiskaly.com/countries/germany/quickstart):
 *
 *   PUT  /tss/{uuid}                  → state CREATED, у відповіді admin_puk
 *   PATCH /tss/{id}   {UNINITIALIZED} → персоналізація
 *   PATCH /tss/{id}/admin {admin_puk, new_admin_pin}
 *   POST /tss/{id}/admin/auth {admin_pin}
 *   PATCH /tss/{id}   {INITIALIZED}
 *   PUT  /tss/{id}/client/{uuid} {serial_number}
 *
 * Нічого тут не пишеться в базу: викликач (маршрут застосунку) кладе
 * ідентифікатори у `fin_fiscal_settings`, а PIN/PUK — під `seal()`. Кожна
 * TSS у fiskaly коштує грошей, тому ідемпотентність — на викликачеві: обʼєкт
 * із заповненим `tss_id` сюди не доходить. Результат — під `reported()`: успіх
 * і відмова з текстом вендора лягають у `app_connections` на цей обʼєкт.
 *
 * Поля відповідей (`admin_puk`, `serial_number`) — з документації, не з
 * живої відповіді (інваріант 28): перший живий прохід має подивитись на тіло
 * очима, і саме тому кожен крок кидає з текстом вендора, а не мовчить.
 */
export async function fiskalyConnect(
  creds: Pick<FiskalyConfig, 'apiKey' | 'apiSecret'>,
  target: { propertyId: string; serialNumber: string },
): Promise<FiskalyTss> {
  const tssId = crypto.randomUUID();
  return reported({ tssId }, async () => {
    const auth = await call('/auth', {
      method: 'POST',
      body: JSON.stringify({ api_key: creds.apiKey, api_secret: creds.apiSecret }),
    });
    const token = auth.access_token;

    const created = await call(`/tss/${tssId}`, { method: 'PUT', token, body: JSON.stringify({}) });
    const adminPuk = String(created.admin_puk ?? '');
    if (!adminPuk) throw new Error('fiskaly PUT /tss → відповідь без admin_puk — TSS створено, але персоналізувати нема чим');

    await call(`/tss/${tssId}`, { method: 'PATCH', token, body: JSON.stringify({ state: 'UNINITIALIZED' }) });

    // Шість цифр — мінімум fiskaly; випадкові, ніде не друкуються.
    const adminPin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    await call(`/tss/${tssId}/admin`, { method: 'PATCH', token, body: JSON.stringify({ admin_puk: adminPuk, new_admin_pin: adminPin }) });
    await call(`/tss/${tssId}/admin/auth`, { method: 'POST', token, body: JSON.stringify({ admin_pin: adminPin }) });
    await call(`/tss/${tssId}`, { method: 'PATCH', token, body: JSON.stringify({ state: 'INITIALIZED' }) });

    const clientId = crypto.randomUUID();
    await call(`/tss/${tssId}/client/${clientId}`, { method: 'PUT', token, body: JSON.stringify({ serial_number: target.serialNumber }) });

    return { tssId, clientId, serialNumber: target.serialNumber, adminPin, adminPuk };
  }, target.propertyId);
}
