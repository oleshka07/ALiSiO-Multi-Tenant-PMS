'use client';

import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import type { Booking, Property, Room, Tenant } from '@/lib/store';
import { CalendarDays, Plus } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

// Helper to generate upcoming days
function generateDays(count = 14) {
  const days: { dateStr: string; label: string; dayName: string; isWeekend: boolean }[] = [];
  const today = new Date();

  for (let i = -1; i < count - 1; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dateStr = d.toISOString().split('T')[0];
    const label = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dayName = dayNames[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    days.push({ dateStr, label, dayName, isWeekend });
  }

  return days;
}

export default function CalendarPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string>(
    '00000000-0000-0000-0000-000000000001',
  );
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalRoomId, setModalRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [totalPrice, setTotalPrice] = useState('3200');
  const [status, setStatus] = useState<Booking['status']>('confirmed');

  const days = generateDays(14);

  const loadData = useCallback(async () => {
    try {
      // 1. Fetch Tenants
      const resTenants = await fetch('/api/tenants');
      const dataTenants = await resTenants.json();
      setTenants(dataTenants.tenants || []);

      // 2. Fetch Properties for Active Tenant
      const resProps = await fetch(`/api/properties?tenantId=${activeTenantId}`);
      const dataProps = await resProps.json();
      const propsList = dataProps.properties || [];
      setProperties(propsList);

      const propId = propsList.length > 0 ? propsList[0].id : '';
      setSelectedPropertyId(propId);

      if (propId) {
        // 3. Fetch Rooms for Property
        const resRooms = await fetch(`/api/rooms?tenantId=${activeTenantId}&propertyId=${propId}`);
        const dataRooms = await resRooms.json();
        setRooms(dataRooms.rooms || []);

        // 4. Fetch Bookings for Active Tenant
        const resBookings = await fetch(
          `/api/bookings?tenantId=${activeTenantId}&propertyId=${propId}`,
        );
        const dataBookings = await resBookings.json();
        setBookings(dataBookings.bookings || []);
      } else {
        setRooms([]);
        setBookings([]);
      }
    } catch (err) {
      console.error(err);
    }
  }, [activeTenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCellClick = (roomId: string, dateStr: string) => {
    setModalRoomId(roomId);
    setCheckIn(dateStr);

    const nextDay = new Date(dateStr);
    nextDay.setDate(nextDay.getDate() + 2);
    setCheckOut(nextDay.toISOString().split('T')[0]);

    setGuestName('');
    setShowModal(true);
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalRoomId || !guestName || !checkIn || !checkOut) return;

    await fetch(`/api/bookings?tenantId=${activeTenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: selectedPropertyId,
        roomId: modalRoomId,
        guestName,
        checkIn,
        checkOut,
        totalPrice: Number.parseFloat(totalPrice),
        status,
        guestsCount: 2,
      }),
    });

    setShowModal(false);
    loadData();
  };

  const getStatusClass = (bStatus: Booking['status']) => {
    switch (bStatus) {
      case 'checked_in':
        return 'status-checked-in';
      case 'confirmed':
        return 'status-confirmed';
      case 'checked_out':
        return 'status-checked-out';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-tentative';
    }
  };

  return (
    <div className="app-layout">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="app-main">
        <Header
          title="Шахматка Бронювань (Interactive Grid)"
          tenants={tenants}
          activeTenantId={activeTenantId}
          onTenantChange={setActiveTenantId}
          properties={properties}
          activePropertyId={selectedPropertyId}
          onPropertyChange={setSelectedPropertyId}
          onMenuClick={() => setMobileOpen(true)}
        />

        <main className="app-content space-y-4">
          {/* Top Control Bar */}
          <div className="card py-3 px-4 flex flex-col md:flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="text-indigo-400" size={20} />
              <h2 className="text-base font-bold text-white">Календар Зайнятості Номерів</h2>
              <span className="badge badge-primary font-mono text-[10px]">14 Днів</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (rooms.length > 0) {
                    setModalRoomId(rooms[0].id);
                    setCheckIn(days[1].dateStr);
                    setCheckOut(days[3].dateStr);
                    setShowModal(true);
                  }
                }}
                className="btn btn-primary btn-sm"
              >
                <Plus size={14} /> Створити Бронювання
              </button>
            </div>
          </div>

          {/* Interactive Calendar Container */}
          <div className="calendar-container">
            <div className="calendar-grid-wrapper">
              {/* Left Panel: Rooms */}
              <div className="calendar-left-panel">
                <div className="calendar-left-header">
                  <span className="text-xs font-bold text-slate-300">Номер / Купол</span>
                </div>
                {rooms.map((room) => (
                  <div key={room.id} className="calendar-unit-row">
                    <div className="calendar-unit-icon">🏕️</div>
                    <div className="min-w-0">
                      <div className="calendar-unit-name">{room.roomNumber}</div>
                      <div className="calendar-unit-type">{room.status}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Scrollable Right Panel: Grid */}
              <div className="calendar-scroll-area">
                {/* Header Dates */}
                <div className="calendar-dates-header">
                  {days.map((d) => (
                    <div
                      key={d.dateStr}
                      className={`calendar-date-cell ${d.isWeekend ? 'weekend' : ''}`}
                    >
                      <span className="calendar-date-day">{d.dayName}</span>
                      <span className="calendar-date-num">{d.label.split('.')[0]}</span>
                      <span className="calendar-date-month">{d.label.split('.')[1]}</span>
                    </div>
                  ))}
                </div>

                {/* Grid Rows */}
                <div className="calendar-grid-body">
                  {rooms.map((room) => (
                    <div key={room.id} className="calendar-grid-row">
                      {days.map((day) => {
                        const activeBooking = bookings.find(
                          (b) =>
                            b.roomId === room.id &&
                            day.dateStr >= b.checkIn &&
                            day.dateStr < b.checkOut,
                        );

                        if (activeBooking) {
                          const isStartDay = day.dateStr === activeBooking.checkIn;

                          return (
                            <button
                              type="button"
                              key={day.dateStr}
                              onClick={() => {
                                setModalRoomId(room.id);
                                setGuestName(activeBooking.guestName);
                                setCheckIn(activeBooking.checkIn);
                                setCheckOut(activeBooking.checkOut);
                                setTotalPrice(activeBooking.totalPrice.toString());
                                setStatus(activeBooking.status);
                                setShowModal(true);
                              }}
                              className={`booking-bar ${getStatusClass(activeBooking.status)}`}
                              style={{ width: '100%', border: 'none', textAlign: 'left' }}
                            >
                              {isStartDay && (
                                <div className="truncate">
                                  <span className="booking-bar-name">
                                    {activeBooking.guestName}
                                  </span>
                                  <span className="booking-bar-info">
                                    ({activeBooking.totalPrice} ₴)
                                  </span>
                                </div>
                              )}
                            </button>
                          );
                        }

                        return (
                          <button
                            type="button"
                            key={day.dateStr}
                            onClick={() => handleCellClick(room.id, day.dateStr)}
                            className={`calendar-day-cell ${day.isWeekend ? 'weekend' : ''}`}
                            style={{ border: 'none', background: 'transparent' }}
                            aria-label={`Select date ${day.dateStr}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modal New/Edit Booking */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Деталі Бронювання</h3>
              <button type="button" onClick={() => setShowModal(false)} className="modal-close">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBooking}>
              <div className="modal-body space-y-4">
                <div className="form-group">
                  <label htmlFor="modalRoom" className="form-label">
                    Обрана Кімната / Купол
                  </label>
                  <select
                    id="modalRoom"
                    value={modalRoomId}
                    onChange={(e) => setModalRoomId(e.target.value)}
                    className="form-select"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.roomNumber} ({r.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="guestName" className="form-label">
                    Ім'я Гостя *
                  </label>
                  <input
                    id="guestName"
                    type="text"
                    required
                    placeholder="напр. Олександр Коваленко"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="form-group">
                    <label htmlFor="checkIn" className="form-label">
                      Заїзд
                    </label>
                    <input
                      id="checkIn"
                      type="date"
                      value={checkIn}
                      onChange={(e) => setCheckIn(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="checkOut" className="form-label">
                      Виїзд
                    </label>
                    <input
                      id="checkOut"
                      type="date"
                      value={checkOut}
                      onChange={(e) => setCheckOut(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="form-group">
                    <label htmlFor="totalPrice" className="form-label">
                      Сума (UAH)
                    </label>
                    <input
                      id="totalPrice"
                      type="number"
                      value={totalPrice}
                      onChange={(e) => setTotalPrice(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="status" className="form-label">
                      Статус
                    </label>
                    <select
                      id="status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as Booking['status'])}
                      className="form-select"
                    >
                      <option value="confirmed">Заброньовано</option>
                      <option value="checked_in">Заселено</option>
                      <option value="checked_out">Виселено</option>
                      <option value="cancelled">Скасовано</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-secondary"
                >
                  Скасувати
                </button>
                <button type="submit" className="btn btn-primary">
                  Зберегти Бронювання
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
