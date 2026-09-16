import { getFolioPayments } from '@invoicing';
// Запис іде дверима фінансів: платіж лягає і в книгу гостя, і в касу, і в
// слово броні одним викликом (Д83). Читання лишається у фоліо — воно про
// книгу гостя й нічого не пише.
import { addFolioPayment } from '@finance';
export const GET = getFolioPayments;
export const POST = addFolioPayment;
