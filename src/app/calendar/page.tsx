'use client';

import Navbar from '@/components/Navbar';
import type { Booking, Property, Room, Tenant } from '@/lib/store';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

// Helper to generate 14 upcoming days
function generateDays(count = 14) {
  const days: { dateStr: string; label: string; dayName: string }[] = [];
  const today = new Date();

  for (let i = -1; i < count - 1; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dateStr = d.toISOString().split('T')[0];
    const label = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dayName = dayNames[d.getDay()];

    days.push({ dateStr, label, dayName });
  }

  return days;
}

export default function CalendarPage() {
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

  const getStatusBadge = (bStatus: Booking['status']) => {
    switch (bStatus) {
      case 'checked_in':
        return 'bg-emerald-600/90 text-white border-emerald-400';
      case 'confirmed':
        return 'bg-indigo-600/90 text-white border-indigo-400';
      case 'checked_out':
        return 'bg-slate-600/90 text-slate-200 border-slate-400';
      case 'cancelled':
        return 'bg-rose-600/90 text-white border-rose-400';
      default:
        return 'bg-indigo-600/90 text-white';
    }
  };

  const getStatusLabel = (bStatus: Booking['status']) => {
    switch (bStatus) {
      case 'checked_in':
        return 'Заселено';
      case 'confirmed':
        return 'Заброньовано';
      case 'checked_out':
        return 'Виселено';
      case 'cancelled':
        return 'Скасовано';
      default:
        return bStatus;
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-12">
      <Navbar
        tenants={tenants}
        activeTenantId={activeTenantId}
        onTenantChange={setActiveTenantId}
      />

      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 text-xs font-semibold rounded border border-indigo-500/30">
                Stage 2
              </span>
              <h1 className="text-2xl font-extrabold text-white">
                📅 Шахматка Бронювань (Interactive Calendar Grid)
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Візуальна сітка дат та кімнат для швидкого бронювання та відстеження статусів гостей.
            </p>
          </div>

          <div className="flex gap-3">
            {properties.length > 1 && (
              <select
                value={selectedPropertyId}
                onChange={(e) => setSelectedPropertyId(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-lg px-3 py-2"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    🏨 {p.name}
                  </option>
                ))}
              </select>
            )}

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
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition"
            >
              + Нове Бронювання
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-xs">
          <span className="text-slate-400 font-medium">Легенда статусів:</span>
          <span className="flex items-center gap-1.5 text-indigo-300">
            <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full" /> Заброньовано
          </span>
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" /> Заселено (В готелі)
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 bg-slate-500 rounded-full" /> Виселено
          </span>
          <span className="flex items-center gap-1.5 text-rose-300">
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" /> Скасовано
          </span>
        </div>

        {/* Interactive Calendar Grid Table */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl overflow-x-auto shadow-2xl">
          <div className="min-w-[1000px]">
            {/* Header Dates Row */}
            <div className="grid grid-cols-[180px_repeat(14,_minmax(65px,_1fr))] border-b border-slate-700 bg-slate-900/80 text-xs font-bold text-slate-300 sticky top-0">
              <div className="p-3 border-r border-slate-700 text-slate-400">Кімната / Намет</div>
              {days.map((d) => (
                <div key={d.dateStr} className="p-2 border-r border-slate-700/50 text-center">
                  <div className="text-[10px] text-indigo-400 uppercase">{d.dayName}</div>
                  <div className="text-xs font-mono">{d.label}</div>
                </div>
              ))}
            </div>

            {/* Room Rows */}
            {rooms.map((room) => (
              <div
                key={room.id}
                className="grid grid-cols-[180px_repeat(14,_minmax(65px,_1fr))] border-b border-slate-700/50 hover:bg-slate-800/40 transition text-xs"
              >
                {/* Room Info Cell */}
                <div className="p-3 border-r border-slate-700 bg-slate-900/40 font-semibold text-white flex items-center justify-between">
                  <span>{room.roomNumber}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                    {room.status}
                  </span>
                </div>

                {/* Day Cells */}
                {days.map((day) => {
                  // Find if room is booked on this day
                  const activeBooking = bookings.find(
                    (b) =>
                      b.roomId === room.id && day.dateStr >= b.checkIn && day.dateStr < b.checkOut,
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
                        className={`p-1 border-r border-slate-700/40 flex items-center justify-center text-left text-[11px] font-medium transition cursor-pointer ${getStatusBadge(activeBooking.status)}`}
                      >
                        {isStartDay && (
                          <span className="truncate px-1 font-semibold">
                            👤 {activeBooking.guestName}
                          </span>
                        )}
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      key={day.dateStr}
                      onClick={() => handleCellClick(room.id, day.dateStr)}
                      className="p-2 border-r border-slate-700/30 hover:bg-indigo-500/20 text-slate-600 hover:text-indigo-300 flex items-center justify-center transition cursor-pointer text-[10px]"
                    >
                      +
                    </button>
                  );
                })}
              </div>
            ))}

            {rooms.length === 0 && (
              <div className="p-12 text-center text-slate-400 text-sm">
                У цьому об'єкті ще немає створених кімнат або наметів.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Booking Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-white">
                {guestName ? 'Деталі Бронювання' : 'Нове Бронювання'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-3">
              <div>
                <label htmlFor="modalRoom" className="block text-xs text-slate-300 mb-1">
                  Кімната / Намет *
                </label>
                <select
                  id="modalRoom"
                  value={modalRoomId}
                  onChange={(e) => setModalRoomId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.roomNumber}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="modalGuest" className="block text-xs text-slate-300 mb-1">
                  ПІБ Гостя *
                </label>
                <input
                  id="modalGuest"
                  type="text"
                  required
                  placeholder="напр. Тарас Шевченко"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="checkIn" className="block text-xs text-slate-300 mb-1">
                    Дата Заїзду *
                  </label>
                  <input
                    id="checkIn"
                    type="date"
                    required
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label htmlFor="checkOut" className="block text-xs text-slate-300 mb-1">
                    Дата Виїзду *
                  </label>
                  <input
                    id="checkOut"
                    type="date"
                    required
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="price" className="block text-xs text-slate-300 mb-1">
                    Сума (грн)
                  </label>
                  <input
                    id="price"
                    type="number"
                    value={totalPrice}
                    onChange={(e) => setTotalPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label htmlFor="bookingStatus" className="block text-xs text-slate-300 mb-1">
                    Статус
                  </label>
                  <select
                    id="bookingStatus"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Booking['status'])}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="confirmed">{getStatusLabel('confirmed')}</option>
                    <option value="checked_in">{getStatusLabel('checked_in')}</option>
                    <option value="checked_out">{getStatusLabel('checked_out')}</option>
                    <option value="cancelled">{getStatusLabel('cancelled')}</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-2 bg-slate-700 text-xs rounded-lg text-slate-300"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs rounded-lg text-white font-medium shadow"
                >
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
