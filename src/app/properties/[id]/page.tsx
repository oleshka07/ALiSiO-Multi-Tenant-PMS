'use client';

import Navbar from '@/components/Navbar';
import type { Property, Room, RoomType, Tenant } from '@/lib/store';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

export default function PropertyDetailsPage() {
  const params = useParams();
  const propertyId = params.id as string;

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string>(
    '00000000-0000-0000-0000-000000000001',
  );
  const [property, setProperty] = useState<Property | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Modals state
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);

  // New Category Form
  const [categoryName, setCategoryName] = useState('');
  const [basePrice, setBasePrice] = useState('2500');

  // New Room Form
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('');
  const [roomNumber, setRoomNumber] = useState('');

  const loadData = useCallback(async () => {
    try {
      const resTenants = await fetch('/api/tenants');
      const dataTenants = await resTenants.json();
      setTenants(dataTenants.tenants || []);

      const resProps = await fetch(`/api/properties?tenantId=${activeTenantId}`);
      const dataProps = await resProps.json();
      const currentProp = (dataProps.properties || []).find((p: Property) => p.id === propertyId);
      setProperty(currentProp || null);

      const resTypes = await fetch(
        `/api/room-types?tenantId=${activeTenantId}&propertyId=${propertyId}`,
      );
      const dataType = await resTypes.json();
      setRoomTypes(dataType.roomTypes || []);
      if (dataType.roomTypes?.length > 0) {
        setSelectedRoomTypeId(dataType.roomTypes[0].id);
      }

      const resRooms = await fetch(
        `/api/rooms?tenantId=${activeTenantId}&propertyId=${propertyId}`,
      );
      const dataRooms = await resRooms.json();
      setRooms(dataRooms.rooms || []);
    } catch (err) {
      console.error(err);
    }
  }, [activeTenantId, propertyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName) return;

    await fetch(`/api/room-types?tenantId=${activeTenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        name: categoryName,
        basePrice: Number.parseFloat(basePrice),
      }),
    });

    setCategoryName('');
    setShowCategoryModal(false);
    loadData();
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber || !selectedRoomTypeId) return;

    await fetch(`/api/rooms?tenantId=${activeTenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        roomTypeId: selectedRoomTypeId,
        roomNumber,
      }),
    });

    setRoomNumber('');
    setShowRoomModal(false);
    loadData();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-12">
      <Navbar
        tenants={tenants}
        activeTenantId={activeTenantId}
        onTenantChange={setActiveTenantId}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Link href="/" className="text-xs text-indigo-400 hover:underline">
            ← Повернутися до всіх готелів
          </Link>
          <div className="flex justify-between items-center mt-2">
            <div>
              <h1 className="text-3xl font-extrabold text-white">
                {property?.name || "Завантаження об'єкту..."}
              </h1>
              <p className="text-slate-400 text-xs mt-1">
                {property?.type?.toUpperCase()} • {property?.city}, {property?.country}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowCategoryModal(true)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 font-medium text-xs rounded-lg border border-slate-700 transition"
              >
                + Додати Категорію
              </button>
              <button
                type="button"
                onClick={() => setShowRoomModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-lg shadow transition"
              >
                + Додати Кімнату / Намет
              </button>
            </div>
          </div>
        </div>

        {/* Categories Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🏷️ Категорії та Типи Номерів ({roomTypes.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {roomTypes.map((rt) => (
              <div
                key={rt.id}
                className="p-5 bg-slate-800/60 border border-slate-700/50 rounded-xl space-y-2"
              >
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-white">{rt.name}</h3>
                  <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    ₴ {rt.basePrice} / ніч
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Місткість: {rt.baseOccupancy} - {rt.maxOccupancy} осіб
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Units / Rooms Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🚪 Номери / Намети ({rooms.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {rooms.map((r) => {
              const category = roomTypes.find((rt) => rt.id === r.roomTypeId);
              return (
                <div
                  key={r.id}
                  className="p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-lg text-white">{r.roomNumber}</span>
                    <span className="px-2 py-0.5 text-[10px] uppercase font-semibold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {r.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{category?.name || 'Кімната'}</p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Modal Category */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-white">Нова Категорія Номеру / Намету</h3>
            <form onSubmit={handleCreateCategory} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Назва (напр. Panoramic Dome / Deluxe)"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                required
                placeholder="Ціна за ніч (грн)"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(false)}
                  className="px-3 py-1.5 bg-slate-700 text-xs rounded text-slate-300"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-indigo-600 text-xs rounded text-white font-medium"
                >
                  Зберегти Категорію
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Room */}
      {showRoomModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-white">Додати Номер або Намет</h3>
            <form onSubmit={handleCreateRoom} className="space-y-3">
              <select
                value={selectedRoomTypeId}
                onChange={(e) => setSelectedRoomTypeId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="Номер / Назва (напр. Dome #3 / Room 204)"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowRoomModal(false)}
                  className="px-3 py-1.5 bg-slate-700 text-xs rounded text-slate-300"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-indigo-600 text-xs rounded text-white font-medium"
                >
                  Додати Номер
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
