export interface ReservationSyncedEvent {
  reservationCode: string;
  action: 'created' | 'updated';
  channel: 'hostex' | 'booking_com';
}

export interface ARISyncedEvent {
  connectionId: string;
  syncType: 'inventory' | 'rates' | 'restrictions' | 'full';
  unitTypeId?: string;
  success: boolean;
}

