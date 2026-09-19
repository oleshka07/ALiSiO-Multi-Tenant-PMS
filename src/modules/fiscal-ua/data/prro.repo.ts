/**
 * The register a property talks to, and the journal of every word said.
 *
 * ── Дві таблиці, і чому саме дві ────────────────────────────────────────
 *
 * `prro_settings` — реквізити каси одного обʼєкта: який драйвер, чия каса,
 * під яким фіскальним номером вона зареєстрована. Один рядок на обʼєкт:
 * каса стоїть у будинку, а не в організації (той самий закон, що З11 для
 * TSE — і та сама причина, INC-029).
 *
 * `prro_operations` — КОЖНЕ звертання до каси: відкриття зміни, чек,
 * Z-звіт; вдале і невдале. Це водночас реєстр чеків і журнал збоїв, і це
 * навмисно одна таблиця, а не дві: збій — це операція зі станом `failed`,
 * і розділивши їх, ми отримали б два списки, які треба зводити, щоб
 * відповісти на єдине питання, яке в рецепції справді є, — «що з касою».
 *
 * Окремої таблиці ЗМІН немає, і це теж навмисно. Обсяг першого релізу
 * (чи входить у нього Z-звіт узагалі) — відкритий чекпоінт власника
 * (docs/research/prro-providers.md §2), а таблиця під нерозвʼязане питання
 * — це форма, вгадана наперед. Поточна зміна виводиться: останнє
 * `shift_open` без `shift_close` після нього.
 *
 * ── Чого тут НЕМАЄ ──────────────────────────────────────────────────────
 *
 * Жодного запиту до `fin_folio_items` чи `fin_folio_payments`. Це таблиці
 * модуля фактурування, і рядки приходять сюди від їхнього власника
 * параметром. Модуль юрисдикції, який ліз би в таблиці ядра, — це рівно той
 * пробій межі, заради якого модуль і відокремлений.
 */
import { getSql } from '@core/db/async';
// `@core/http/refusal`, не `errors`: цей файл читають сцени під ГОЛИМ node,
// а `errors.ts` тягне `next/server` (П3).
import { refuse } from '@core/http/refusal';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyOrSharedFilter, type PropertyScope } from '@core/property-scope';
import type { PrroDevice, PrroDriver, PrroReceiptResult } from '../domain/prro-device.ts';
import { isPrroDriver } from '../domain/prro-device.ts';
import { buildPrroReceipt, PrroReceiptRefusal } from '../domain/prro-receipt.ts';
import type { FolioItemRow, FolioPaymentRow } from '../domain/prro-receipt.ts';
import { noneDevice } from './none-device.ts';
import { testDevice } from './test-device.ts';

export interface PrroSettings {
  property_id: string;
  driver: PrroDriver;
  /** Хто працює на касі — імʼя, яке друкується на чеку. */
  cashier_name: string | null;
  /** Фіскальний номер реєстратора, виданий при реєстрації каси. */
  register_fiscal_number: string | null;
  /** Локальний номер точки продажу в обліку готелю. */
  point_local_number: string | null;
  /** Податковий номер, під яким готель звітує. */
  tax_number: string | null;
}

export type PrroOperationKind = 'shift_open' | 'receipt' | 'shift_close';
export type PrroOperationStatus = 'registered' | 'failed';

export interface PrroOperation {
  id: string;
  property_id: string;
  kind: PrroOperationKind;
  status: PrroOperationStatus;
  payment_id: string | null;
  shift_id: string | null;
  fiscal_number: string | null;
  total: number | null;
  error: string | null;
  created_at: string;
}

const DEFAULT_DRIVER: PrroDriver = 'none';

/** Реквізити каси обʼєкта. Рядка немає — драйвер `none`, і це не помилка. */
export async function prroSettings(propertyId: string): Promise<PrroSettings> {
  const organizationId = await requireOrganizationId();
  const row = await getSql().row<PrroSettings>(
    `SELECT property_id, driver, cashier_name, register_fiscal_number,
            point_local_number, tax_number
       FROM prro_settings WHERE property_id = ? AND organization_id = ?`,
    [propertyId, organizationId]);
  if (row) return { ...row, driver: isPrroDriver(row.driver) ? row.driver : DEFAULT_DRIVER };
  return {
    property_id: propertyId, driver: DEFAULT_DRIVER, cashier_name: null,
    register_fiscal_number: null, point_local_number: null, tax_number: null,
  };
}

export async function savePrroSettings(input: {
  propertyId: string;
  driver: string;
  cashierName?: string | null;
  registerFiscalNumber?: string | null;
  pointLocalNumber?: string | null;
  taxNumber?: string | null;
}): Promise<void> {
  const organizationId = await requireOrganizationId();
  if (!isPrroDriver(input.driver)) {
    refuse('Unknown fiscal driver — choose one the product actually has', 409);
  }
  const sql = getSql();
  // Обʼєкт мусить бути СВІЙ, і питаємо ми це до запису: чужий ідентифікатор
  // — 404, а не «запишемо, політика розбереться» (інваріанти 5 і 13).
  const place = await sql.row<{ id: string }>(
    'SELECT id FROM properties WHERE id = ? AND organization_id = ?',
    [input.propertyId, organizationId]);
  if (!place) refuse('Property not found', 404);

  // `organization_id` названо явно — у SQLite DEFAULT від контексту немає
  // (інваріант 12).
  await sql.run(
    `INSERT INTO prro_settings
       (id, organization_id, property_id, driver, cashier_name,
        register_fiscal_number, point_local_number, tax_number, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(property_id) DO UPDATE SET
       driver = excluded.driver,
       cashier_name = excluded.cashier_name,
       register_fiscal_number = excluded.register_fiscal_number,
       point_local_number = excluded.point_local_number,
       tax_number = excluded.tax_number,
       updated_at = excluded.updated_at`,
    [crypto.randomUUID(), organizationId, input.propertyId, input.driver,
     input.cashierName ?? null, input.registerFiscalNumber ?? null,
     input.pointLocalNumber ?? null, input.taxNumber ?? null]);
}

/** Пристрій, яким говорить каса цього обʼєкта. */
export async function prroDeviceFor(propertyId: string): Promise<PrroDevice> {
  const settings = await prroSettings(propertyId);
  return settings.driver === 'test' ? testDevice() : noneDevice();
}

/** Журнал: що каса відповідала, у зворотному порядку часу. */
export async function prroJournal(scope: PropertyScope, limit = 100): Promise<PrroOperation[]> {
  const organizationId = await requireOrganizationId();
  // Каса стоїть у будинку (INC-029): рецепція обʼєкта А не має дивитись на
  // збої обʼєкта Б і навпаки.
  const axis = propertyOrSharedFilter(scope, '');
  return await getSql().rows<PrroOperation>(
    `SELECT id, property_id, kind, status, payment_id, shift_id, fiscal_number,
            total, error, created_at
       FROM prro_operations
      WHERE organization_id = ? AND ${axis.sql}
      ORDER BY created_at DESC, id DESC
      LIMIT ${Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 500) : 100}`,
    [organizationId, ...axis.params]);
}

async function noteOperation(input: {
  organizationId: string;
  propertyId: string;
  kind: PrroOperationKind;
  status: PrroOperationStatus;
  paymentId?: string | null;
  shiftId?: string | null;
  fiscalNumber?: string | null;
  total?: number | null;
  error?: string | null;
}): Promise<void> {
  await getSql().run(
    `INSERT INTO prro_operations
       (id, organization_id, property_id, kind, status, payment_id, shift_id,
        fiscal_number, total, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), input.organizationId, input.propertyId, input.kind,
     input.status, input.paymentId ?? null, input.shiftId ?? null,
     input.fiscalNumber ?? null, input.total ?? null,
     input.error ? String(input.error).slice(0, 500) : null]);
}

export interface TillReceiptOutcome {
  status: PrroOperationStatus;
  fiscalNumber: string | null;
  error: string | null;
}

/**
 * Зареєструвати чек за оплатою на рецепції.
 *
 * НІКОЛИ не кидає. Це не недогляд і не м'якість: виїзд гостя не зупиняється
 * через касу, яка мовчить, — рівно так поводиться німецький шлях (сцена
 * `folio-payments.check.ts`, блок B). Невдача лишає по собі рядок журналу
 * зі станом `failed` і текстом, і його видно на екрані. Мовчазна втрата
 * чека гірша за гучну відмову.
 *
 * Повертає підсумок, щоб викликач міг сказати рецепції, що сталось, не
 * перечитуючи журнал.
 */
export async function registerTillReceipt(input: {
  propertyId: string;
  paymentId: string;
  items: readonly FolioItemRow[];
  payments: readonly FolioPaymentRow[];
  currency: string;
}, device?: PrroDevice): Promise<TillReceiptOutcome> {
  const organizationId = await requireOrganizationId();
  let shiftId: string | null = null;
  let total: number | null = null;
  try {
    const receipt = buildPrroReceipt({
      items: input.items, payments: input.payments, currency: input.currency,
    });
    total = receipt.total;
    const dev = device ?? await prroDeviceFor(input.propertyId);
    const result: PrroReceiptResult = await dev.registerReceipt(receipt);
    shiftId = result.shiftId;
    await noteOperation({
      organizationId, propertyId: input.propertyId, kind: 'receipt', status: 'registered',
      paymentId: input.paymentId, shiftId: result.shiftId,
      fiscalNumber: result.fiscalNumber, total: receipt.total,
    });
    return { status: 'registered', fiscalNumber: result.fiscalNumber, error: null };
  } catch (e) {
    // Рід тут не розбирається навмисно: і відмова збірки (`PrroReceiptRefusal`
    // — часткова оплата, переказ у касі), і падіння драйвера означають для
    // рецепції одне й те саме — чека немає, і про це треба сказати. Текст
    // іде в ЖУРНАЛ, не в HTTP-відповідь (інваріант 6).
    const message = e instanceof PrroReceiptRefusal || e instanceof Error
      ? e.message : 'Fiscal register unavailable';
    try {
      await noteOperation({
        organizationId, propertyId: input.propertyId, kind: 'receipt', status: 'failed',
        paymentId: input.paymentId, shiftId, total, error: message,
      });
    } catch (journalError) {
      // Журнал не пишеться — лишається лог контейнера. Кидати звідси означало б
      // зупинити виїзд саме тоді, коли все й так погано.
      console.error('[prro] journal write failed:', journalError);
    }
    return { status: 'failed', fiscalNumber: null, error: message };
  }
}

/** Одна проба каси з екрана налаштувань: відкрити зміну і закрити її. */
export async function testPrroDevice(propertyId: string, device?: PrroDevice): Promise<TillReceiptOutcome> {
  const organizationId = await requireOrganizationId();
  const place = await getSql().row<{ id: string }>(
    'SELECT id FROM properties WHERE id = ? AND organization_id = ?', [propertyId, organizationId]);
  if (!place) refuse('Property not found', 404);
  try {
    const dev = device ?? await prroDeviceFor(propertyId);
    const shift = await dev.openShift();
    await noteOperation({
      organizationId, propertyId, kind: 'shift_open', status: 'registered', shiftId: shift.shiftId,
    });
    const report = await dev.closeShift();
    await noteOperation({
      organizationId, propertyId, kind: 'shift_close', status: 'registered',
      shiftId: report.shiftId, fiscalNumber: report.fiscalNumber, total: report.total,
    });
    return { status: 'registered', fiscalNumber: report.fiscalNumber, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Fiscal register unavailable';
    await noteOperation({
      organizationId, propertyId, kind: 'shift_open', status: 'failed', error: message,
    }).catch((journalError) => console.error('[prro] journal write failed:', journalError));
    return { status: 'failed', fiscalNumber: null, error: message };
  }
}
