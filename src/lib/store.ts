export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
}

export interface Property {
  id: string;
  tenantId: string;
  name: string;
  type: string; // 'hotel' | 'glamping' | 'villa' | 'apartment'
  address: string;
  city: string;
  country: string;
  currency: string;
  createdAt: string;
}

export interface RoomType {
  id: string;
  tenantId: string;
  propertyId: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
  basePrice: number;
  description: string;
}

export interface Room {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  roomNumber: string;
  floor: string;
  status: string; // 'available' | 'occupied' | 'dirty' | 'maintenance'
}

export interface Booking {
  id: string;
  tenantId: string;
  propertyId: string;
  roomId: string;
  guestName: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  totalPrice: number;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  guestsCount: number;
  createdAt: string;
}

// Helper to format date strings YYYY-MM-DD
function getOffsetDateStr(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split('T')[0];
}

// In-Memory Multi-Tenant Store with Demo Seed Data
class PMSStore {
  private tenants: Tenant[] = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Grand Hotel Kyiv',
      slug: 'grand-hotel-kyiv',
      plan: 'enterprise',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Carpathian Glamping Resort',
      slug: 'carpathian-glamping',
      plan: 'pro',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  ];

  private properties: Property[] = [
    {
      id: 'prop-101',
      tenantId: '00000000-0000-0000-0000-000000000001',
      name: 'Grand Hotel Kyiv Central',
      type: 'hotel',
      address: 'вул. Хрещатик, 15',
      city: 'Київ',
      country: 'Україна',
      currency: 'UAH',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'prop-102',
      tenantId: '00000000-0000-0000-0000-000000000002',
      name: 'Carpathian Eco Domes',
      type: 'glamping',
      address: 'урочище Вишня',
      city: 'Яремче',
      country: 'Україна',
      currency: 'UAH',
      createdAt: new Date().toISOString(),
    },
  ];

  private roomTypes: RoomType[] = [
    {
      id: 'rt-201',
      tenantId: '00000000-0000-0000-0000-000000000001',
      propertyId: 'prop-101',
      name: 'Deluxe Suite',
      baseOccupancy: 2,
      maxOccupancy: 4,
      basePrice: 4500,
      description: 'Люкс номер з видом на Хрещатик',
    },
    {
      id: 'rt-202',
      tenantId: '00000000-0000-0000-0000-000000000002',
      propertyId: 'prop-102',
      name: 'Panoramic Glamping Dome',
      baseOccupancy: 2,
      maxOccupancy: 3,
      basePrice: 3200,
      description: 'Сферичний купол з панорамним вікном на гори',
    },
  ];

  private rooms: Room[] = [
    {
      id: 'room-301',
      tenantId: '00000000-0000-0000-0000-000000000001',
      propertyId: 'prop-101',
      roomTypeId: 'rt-201',
      roomNumber: '101',
      floor: '1',
      status: 'available',
    },
    {
      id: 'room-302',
      tenantId: '00000000-0000-0000-0000-000000000002',
      propertyId: 'prop-102',
      roomTypeId: 'rt-202',
      roomNumber: 'Dome #1 (Hoverla View)',
      floor: '1',
      status: 'available',
    },
    {
      id: 'room-303',
      tenantId: '00000000-0000-0000-0000-000000000002',
      propertyId: 'prop-102',
      roomTypeId: 'rt-202',
      roomNumber: 'Dome #2 (Forest View)',
      floor: '1',
      status: 'occupied',
    },
  ];

  private bookings: Booking[] = [
    {
      id: 'book-401',
      tenantId: '00000000-0000-0000-0000-000000000001',
      propertyId: 'prop-101',
      roomId: 'room-301',
      guestName: 'Олександр Коваленко',
      checkIn: getOffsetDateStr(0),
      checkOut: getOffsetDateStr(3),
      totalPrice: 13500,
      status: 'checked_in',
      guestsCount: 2,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'book-402',
      tenantId: '00000000-0000-0000-0000-000000000002',
      propertyId: 'prop-102',
      roomId: 'room-302',
      guestName: 'Ірина Мельник',
      checkIn: getOffsetDateStr(1),
      checkOut: getOffsetDateStr(4),
      totalPrice: 9600,
      status: 'confirmed',
      guestsCount: 2,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'book-403',
      tenantId: '00000000-0000-0000-0000-000000000002',
      propertyId: 'prop-102',
      roomId: 'room-303',
      guestName: 'Андрій Шевченко',
      checkIn: getOffsetDateStr(-1),
      checkOut: getOffsetDateStr(2),
      totalPrice: 9600,
      status: 'checked_in',
      guestsCount: 3,
      createdAt: new Date().toISOString(),
    },
  ];

  // Tenant operations
  getTenants(): Tenant[] {
    return this.tenants;
  }

  createTenant(name: string, slug: string, plan = 'pro'): Tenant {
    const newTenant: Tenant = {
      id: `tenant-${Date.now()}`,
      name,
      slug,
      plan,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.tenants.push(newTenant);
    return newTenant;
  }

  // Tenant-scoped Property operations
  getProperties(tenantId: string): Property[] {
    return this.properties.filter((p) => p.tenantId === tenantId);
  }

  getPropertyById(tenantId: string, propertyId: string): Property | undefined {
    return this.properties.find((p) => p.tenantId === tenantId && p.id === propertyId);
  }

  createProperty(
    tenantId: string,
    data: Omit<Property, 'id' | 'tenantId' | 'createdAt'>,
  ): Property {
    const newProperty: Property = {
      id: `prop-${Date.now()}`,
      tenantId,
      ...data,
      createdAt: new Date().toISOString(),
    };
    this.properties.push(newProperty);
    return newProperty;
  }

  // Tenant-scoped Room Types
  getRoomTypes(tenantId: string, propertyId?: string): RoomType[] {
    return this.roomTypes.filter(
      (rt) => rt.tenantId === tenantId && (!propertyId || rt.propertyId === propertyId),
    );
  }

  createRoomType(tenantId: string, data: Omit<RoomType, 'id' | 'tenantId'>): RoomType {
    const newRoomType: RoomType = {
      id: `rt-${Date.now()}`,
      tenantId,
      ...data,
    };
    this.roomTypes.push(newRoomType);
    return newRoomType;
  }

  // Tenant-scoped Rooms
  getRooms(tenantId: string, propertyId?: string): Room[] {
    return this.rooms.filter(
      (r) => r.tenantId === tenantId && (!propertyId || r.propertyId === propertyId),
    );
  }

  createRoom(tenantId: string, data: Omit<Room, 'id' | 'tenantId'>): Room {
    const newRoom: Room = {
      id: `room-${Date.now()}`,
      tenantId,
      ...data,
    };
    this.rooms.push(newRoom);
    return newRoom;
  }

  // Tenant-scoped Bookings
  getBookings(tenantId: string, propertyId?: string): Booking[] {
    return this.bookings.filter(
      (b) => b.tenantId === tenantId && (!propertyId || b.propertyId === propertyId),
    );
  }

  createBooking(tenantId: string, data: Omit<Booking, 'id' | 'tenantId' | 'createdAt'>): Booking {
    const newBooking: Booking = {
      id: `book-${Date.now()}`,
      tenantId,
      ...data,
      createdAt: new Date().toISOString(),
    };
    this.bookings.push(newBooking);
    return newBooking;
  }
}

export const store = new PMSStore();
