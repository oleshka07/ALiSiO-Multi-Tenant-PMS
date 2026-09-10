/**
 * @invoicing — фоліо, рахунки, каса, ПДВ, фіскалізація.
 *
 * ── Чому це окремий модуль ──────────────────────────────────────────────
 *
 * Фактура в кожного готеля своя. Не «трохи різна»: інший бланк, інші
 * реквізити, інші ставки ПДВ, інші строки оплати, інша юрисдикція, інша
 * серія нумерації, інший обовʼязок фіскалізувати. Поки все це жило всередині
 * `@finance` разом із обліком, «змінити вигляд фактури» означало правити
 * модуль на 16 000 рядків, більшість якого — журнал господарських операцій,
 * до фактури не дотичний.
 *
 * Розділити виявилось дешево, і це головне, що показав розбір: із 77 файлів
 * `@finance` **лише ОДИН** торкався обох половин — `invoices.handlers`, який
 * брав дату оплати з `fin_operations`. Той рядок був ще й неправильний
 * (журнал обліку знає бронь, а не фактуру, тож дві фактури на одну бронь
 * отримували ту саму оплату); правильне джерело — `fin_folio_payments`, у
 * якого є `invoice_id`. Шов не будували — його знайшли.
 *
 * ── Межа ────────────────────────────────────────────────────────────────
 *
 * ТУТ: фоліо (`fin_folios`, `fin_folio_items`, `fin_folio_payments`),
 * рахунки (`invoices`, `fin_invoice_lines`, `fin_invoice_tax_totals`),
 * нумерація (`invoice_series`, `invoice_counters`, `invoice_periods`),
 * податок (`fin_tax_rates`), каса (`fin_cash_closings`), фіскалізація
 * (`fin_fiscal_settings`, `fin_fiscal_outages`), правила каналів
 * (`channel_rate_rules` — вони кажуть, з чого складається сума каналу, тобто
 * які рядки лягають у фоліо).
 *
 * НЕ ТУТ: журнал господарських операцій і все, що на ньому стоїть —
 * `fin_operations`, рахунки обліку, контрагенти, бюджети, капекс,
 * нарахування, звіти P&L. Це `@finance`, і воно вимикається окремо.
 *
 * ── Варта ───────────────────────────────────────────────────────────────
 *
 * `withModule('invoicing', …)`, а НЕ фінансовий PIN, який стояв тут раніше.
 *
 * PIN (`finance_security`, `_finance-unlock`) писався, щоб сховати від
 * персоналу прибуток і витрати. Фактура — не прибуток, і привʼязувати її до
 * замка бухгалтерії означало прив'язати фактурування до модуля обліку, який
 * має вимикатись окремо. Тому тут звичайні права: `manage_documents` —
 * виписати документ, `manage_finance_settings` — змінити ставку, серію,
 * бланк або сторнувати.
 *
 * Роль `receptionist` має `manage_documents` — рішення власника від
 * 2026-08-28. Тобто рецепція виписує й редагує фактури сама: гість
 * виїжджає о сьомій ранку, і чекати на бухгалтера він не буде. Ставки,
 * серії, бланк і **сторно** лишились за `manage_finance_settings`: виданий
 * документ не редагується, він скасовується зустрічним, і це не рішення
 * зміни.
 */
import { withModule } from '@core/auth/session';

// ─── Фоліо: рахунок проживання, поки гість ще тут ────────────────────────
import {
  listFolios as _listFolios, createFolio as _createFolio,
  getFolioCharges as _getFolioCharges, addFolioCharges as _addFolioCharges,
  issueFolioInvoice as _issueFolioInvoice, stornoInvoice as _stornoInvoice,
  moveFolioCharges as _moveFolioCharges,
  getFolioPayments as _getFolioPayments, addFolioPayment as _addFolioPayment,
} from './folio.handlers';

export const listFolios        = withModule('invoicing', 'manage_documents', _listFolios);
export const createFolio       = withModule('invoicing', 'manage_documents', _createFolio);
export const getFolioCharges   = withModule('invoicing', 'manage_documents', _getFolioCharges);
export const addFolioCharges   = withModule('invoicing', 'manage_documents', _addFolioCharges);
export const issueFolioInvoice = withModule('invoicing', 'manage_documents', _issueFolioInvoice);
export const moveFolioCharges  = withModule('invoicing', 'manage_documents', _moveFolioCharges);
export const getFolioPayments  = withModule('invoicing', 'manage_documents', _getFolioPayments);
export const addFolioPayment   = withModule('invoicing', 'manage_documents', _addFolioPayment);
// Сторно — виправлення виписаного документа. Права рецепції на це немає:
// виданий рахунок не редагується, він скасовується зустрічним, і це рішення
// того, хто відповідає за звітність.
export const stornoInvoice     = withModule('invoicing', 'manage_finance_settings', _stornoInvoice);

// ─── Рахунки ─────────────────────────────────────────────────────────────
import {
  listInvoices as _listInvoices, getInvoiceHtml as _getInvoiceHtml,
  getInvoiceByReservation as _getInvoiceByReservation,
  reissueInvoiceHandler as _reissueInvoiceHandler,
} from './invoices.handlers';

export const listInvoices            = withModule('invoicing', 'manage_documents', _listInvoices);
export const getInvoiceHtml          = withModule('invoicing', 'manage_documents', _getInvoiceHtml);
export const getInvoiceByReservation = withModule('invoicing', 'manage_documents', _getInvoiceByReservation);
export const reissueInvoiceHandler   = withModule('invoicing', 'manage_finance_settings', _reissueInvoiceHandler);

/**
 * Виписати рахунок за бронь — БЕЗ варти, і це навмисно.
 *
 * Кличеться з життєвого циклу броні (`@bookings`, оплата), а не з запиту
 * людини: там особа вже встановлена вартою маршруту, а орендар — на
 * зʼєднанні. Обгорнути це вартою означало б вимагати сесію там, де діє
 * вебхук каналу.
 */
export { generateInvoiceForReservation } from './invoices.handlers';

// ─── Налаштування фактурування: ставки ПДВ і серії нумерації ─────────────
import {
  listTaxRates as _listTaxRates, createTaxRate as _createTaxRate,
  closeTaxRate as _closeTaxRate, deleteTaxRate as _deleteTaxRate,
  listInvoiceSeries as _listInvoiceSeries, createInvoiceSeries as _createInvoiceSeries,
  updateInvoiceSeries as _updateInvoiceSeries, deleteInvoiceSeries as _deleteInvoiceSeries,
} from './invoicing-config.handlers';

// Читати ставки має право кожен, хто виписує документ: без них він не
// порахує суму. Змінювати — лише той, хто відповідає за звітність.
export const listTaxRates         = withModule('invoicing', 'manage_documents', _listTaxRates);
export const listInvoiceSeries    = withModule('invoicing', 'manage_documents', _listInvoiceSeries);
export const createTaxRate        = withModule('invoicing', 'manage_finance_settings', _createTaxRate);
export const closeTaxRate         = withModule('invoicing', 'manage_finance_settings', _closeTaxRate);
export const deleteTaxRate        = withModule('invoicing', 'manage_finance_settings', _deleteTaxRate);
export const createInvoiceSeries  = withModule('invoicing', 'manage_finance_settings', _createInvoiceSeries);
export const updateInvoiceSeries  = withModule('invoicing', 'manage_finance_settings', _updateInvoiceSeries);
export const deleteInvoiceSeries  = withModule('invoicing', 'manage_finance_settings', _deleteInvoiceSeries);

// ─── Каса: закриття дня ──────────────────────────────────────────────────
import {
  listCashClosings as _listCashClosings, createCashClosing as _createCashClosing,
  exportTillJournal as _exportTillJournal,
} from './cash-closings.handlers';

// `manage_documents`: закриття дня — вечірній ритуал рецепції, не церемонія
// власника.
export const listCashClosings  = withModule('invoicing', 'manage_documents', _listCashClosings);
export const createCashClosing = withModule('invoicing', 'manage_documents', _createCashClosing);
export const exportTillJournal = withModule('invoicing', 'manage_documents', _exportTillJournal);

// ─── Правила каналів: з чого складається сума, яку прислав канал ─────────
import {
  listChannelRules as _listChannelRules, saveChannelRule as _saveChannelRule,
  deleteChannelRule as _deleteChannelRule, postStayChargesToFolio as _postStayChargesToFolio,
} from './channel-rules.handlers';

export const listChannelRules       = withModule('invoicing', 'manage_documents', _listChannelRules);
export const saveChannelRule        = withModule('invoicing', 'manage_finance_settings', _saveChannelRule);
export const deleteChannelRule      = withModule('invoicing', 'manage_finance_settings', _deleteChannelRule);
export const postStayChargesToFolio = withModule('invoicing', 'manage_documents', _postStayChargesToFolio);

export { ruleFor, withMarkup } from '../domain/channel-rate-rule';
export type { ChannelRateRule } from '../domain/channel-rate-rule';

// ─── Те, що кличуть інші модулі ──────────────────────────────────────────

/** Загальний пошук питає модуль, а не таблицю. Див. core/search-types.ts. */
export { searchInvoices } from '../data/invoice-search';

// Те, що потрібно сусіднім модулям без HTTP (ставка ПДВ, фоліо), живе в
// `@invoicing/kernel`: тут кожен експорт уже обгорнутий вартою, а варта
// тягне `next/server` — і перевірка сусіда, що біжить під голим node,
// переставала запускатись.

// ─── Документ: побудувати, пронумерувати, віддати ────────────────────────
//
// Це і є те, заради чого модуль окремий: «як виглядає фактура цього готеля».
// Маршрути `/api/invoices/*` і `/api/accounting/*` збирають документ —
// HTML для екрана, PDF для друку, ISDOC для чеської бухгалтерії — і раніше
// лізли по ці функції у нутрощі модуля напряму. Одинадцять пробоїв межі, і
// кожен означав, що перейменувати щось усередині не можна не зламавши
// маршрут.
//
// Тепер це названий контракт. Він ширший за звичайний фасад навмисно:
// побудова документа НЕ є одним викликом, бо юрисдикції різні — чеський
// шлях іде через ISDOC, німецький через `invoice-pdf-de` з фіскальним
// підписом. Звести їх в одну функцію означало б сховати різницю, яка є
// суттю.

/** Рядки документа з бази — усе, що потрібно, щоб його намалювати. */
export { loadInvoiceDocument } from '../data/invoice-document.repo';

/** HTML для екрана й листа. */
export { renderInvoiceHtml } from '../domain/invoice-template';
export type { InvoiceData } from '../domain/invoice-template';

/** PDF: загальний і німецький (із фіскальним блоком). */
export { generateInvoicePdf } from '../domain/invoice-pdf';
export { generateGermanInvoicePdf } from '../domain/invoice-pdf-de';

/** ISDOC — чеський обмінний формат для бухгалтерії. */
export { generateIsdocXml } from '../domain/isdoc';

/**
 * Нумерація: серія, номер, замок періоду.
 *
 * `allocateInvoiceNumber` видає номер атомарно — два одночасні виїзди не
 * мають отримати один номер. `isPeriodLocked` тримає інваріант закритого
 * місяця: після блокування номери заморожені, виправлення лише через сторно.
 */
export {
  allocateInvoiceNumber, seriesForChannel, isPeriodLocked, lockPeriod, unlockPeriod,
} from '../domain/invoice-numbering';

/**
 * Єдині двері видалення фактури.
 *
 * `fin_invoice_lines` і `fin_invoice_tax_totals` не мають зовнішнього ключа на
 * `invoices`, тож голий `DELETE FROM invoices` лишає їхні рядки вказувати в
 * нікуди. Два маршрути так і робили; третій зробив би так само (Р10.14, Ц49).
 */
export { deleteInvoicesWhere } from '../data/invoice-delete.repo';

/**
 * Правила бланка — те, що готель налаштовує під себе.
 *
 * `showBuyerName` — чи друкувати покупця (фізична особа проти компанії),
 * `dueDateFor` — строк оплати. Обидва читають налаштування готелю, а не
 * константу: саме тому фактурування й окремий модуль.
 */
export { showBuyerName, dueDateFor } from '../domain/invoice-rules';

/** Перерахунок у валюту документа. */
export { convertToCzkAuto, foreignNote } from '../domain/fx';

/**
 * Налаштування бланка цього готеля: строк оплати, поріг імені покупця,
 * логотип, колір, підпис унизу, платіжний QR.
 *
 * Читається маршрутами, які збирають документ. `showBuyerName` і `dueDateFor`
 * приймають ці правила аргументом і лишаються чистими: їх можна перевіряти
 * без бази, а місце, звідки правила беруться, лишається одне.
 */
export { invoiceSettings, saveInvoiceSettings, INVOICE_DEFAULTS } from '../data/invoice-settings.repo';
export type { InvoiceSettings } from '../data/invoice-settings.repo';

// ─── Бланк готеля через HTTP ─────────────────────────────────────────────
import {
  getInvoiceSettings as _getInvoiceSettings, putInvoiceSettings as _putInvoiceSettings,
} from './settings.handlers';

// Читати — той, хто виписує документ: без строку оплати він його не збере.
// Змінювати — той, хто відповідає за звітність.
export const getInvoiceSettingsRoute = withModule('invoicing', 'manage_documents', _getInvoiceSettings);
export const putInvoiceSettingsRoute = withModule('invoicing', 'manage_finance_settings', _putInvoiceSettings);

// ─── Клієнт TSE — двері для екрана «Застосунки» ──────────────────────────
// Один рядок, дозволений рецензією 1 блоку «Застосунки» (10.09.2026): картка
// fiskaly перевіряє звʼязок і підключає TSE, і робить це через фасад, а не
// через `data/` (check-boundaries).
export { fiskalyDevice, fiskalyProbe, fiskalyConnect, FiskalyConnectError } from '../data/fiskaly-sign-de';
export type { FiskalyConfig, FiskalyTss, FiskalyConnectOptions } from '../data/fiskaly-sign-de';
