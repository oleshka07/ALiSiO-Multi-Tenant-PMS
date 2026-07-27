export interface ReservationCreatedEvent {
  reservationId: string;
  guestId: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  source: string;
}

export interface ReservationStatusChangedEvent {
  reservationId: string;
  status: string;
  previousStatus: string;
}

export interface ReservationDeletedEvent {
  reservationId: string;
}
