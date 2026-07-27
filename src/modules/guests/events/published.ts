// Events published by the guests module
// Consumed by: crm (guest_registered → lead sync), channels (registration notification)

export interface GuestRegisteredEvent {
  reservationId: string;
  guestCount: number;
}

export interface GuestUpdatedEvent {
  guestId: string;
}

export interface GuestFeedbackSubmittedEvent {
  reservationId: string;
}
