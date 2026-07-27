export interface PaymentCreatedEvent {
  paymentId: string;
  reservationId: string;
  amount: number;
  method: string;
}

export interface PaymentDeletedEvent {
  paymentId: string;
  reservationId: string;
}

export interface ExpenseCreatedEvent {
  expenseId: string;
  categoryId: string;
  businessUnitId: string | null;
  amount: number;
  month: string;
}
