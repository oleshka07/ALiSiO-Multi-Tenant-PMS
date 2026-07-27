'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/lib/MobileMenuContext';
import {
  ArrowLeft,
  Building2,
  Plus,
  Tag,
  BedDouble,
  DoorOpen,
  MapPin,
  Coins,
  X,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

interface Property {
  id: string;
  name: string;
  type: string;
  city: string;
  country: string;
  currency: string;
}

interface RoomType {
  id: string;
  name: string;
  basePrice: number;
  baseOccupancy: number;
  maxOccupancy: number;
}

interface Room {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  status: string;
}

export default function PropertyDetailsPage() {
  const params = useParams();
  const propertyId = params.id as string;
  const onMenuClick = useMobileMenu();

  const [property, setProperty] = useState<Property | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

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
    setLoading(true);
    try {
      const resProps = await fetch('/api/properties');
      if (resProps.ok) {
        const dataProps = await resProps.json();
        const currentProp = (dataProps.properties || []).find((p: Property) => p.id === propertyId);
        setProperty(currentProp || null);
      }

      const resTypes = await fetch(`/api/room-types?propertyId=${propertyId}`);
      if (resTypes.ok) {
        const dataType = await resTypes.json();
        const types = dataType.roomTypes || [];
        setRoomTypes(types);
        if (types.length > 0) {
          setSelectedRoomTypeId(types[0].id);
        }
      }

      const resRooms = await fetch(`/api/rooms?propertyId=${propertyId}`);
      if (resRooms.ok) {
        const dataRooms = await resRooms.json();
        setRooms(dataRooms.rooms || []);
      }
    } catch (err) {
      console.error('Failed to load property details', err);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName) return;

    try {
      const res = await fetch('/api/room-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          name: categoryName,
          basePrice: Number.parseFloat(basePrice) || 0,
        }),
      });

      if (res.ok) {
        setCategoryName('');
        setShowCategoryModal(false);
        loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber || !selectedRoomTypeId) return;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          roomTypeId: selectedRoomTypeId,
          roomNumber,
        }),
      });

      if (res.ok) {
        setRoomNumber('');
        setShowRoomModal(false);
        loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
      <Header title={property ? property.name : "Управління Номерами"} onMenuClick={onMenuClick} />
      <div className="app-content">
        {/* Back Link & Header Card */}
        <div style={{ marginBottom: 20 }}>
          <Link
            href="/properties"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent-primary)',
              textDecoration: 'none',
              marginBottom: 12,
            }}
          >
            <ArrowLeft size={14} /> Повернутися до всіх об'єктів
          </Link>

          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="badge badge-primary" style={{ textTransform: 'uppercase', fontSize: 10 }}>
                    {property?.type || 'HOTEL'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={12} /> {property?.city}, {property?.country}
                  </span>
                </div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  {property?.name || "Завантаження об'єкту..."}
                </h1>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowCategoryModal(true)}
                  style={{ gap: 6 }}
                >
                  <Tag size={14} /> + Додати Категорію
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowRoomModal(true)}
                  style={{ gap: 6 }}
                >
                  <Plus size={14} /> + Додати Кімнату / Намет
                </button>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <Loader2 size={24} className="animate-spin" style={{ marginRight: 8 }} /> Завантаження даних...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Categories Section */}
            <section className="card" style={{ padding: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                <Tag size={18} style={{ color: 'var(--accent-warning)' }} /> Категорії та Типи Номерів ({roomTypes.length})
              </h3>

              {roomTypes.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                  Категорії ще не створені. Натисніть "+ Додати Категорію" вище.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {roomTypes.map((rt) => (
                    <div
                      key={rt.id}
                      style={{
                        padding: 16,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{rt.name}</h4>
                        <span className="badge badge-success" style={{ fontSize: 11, fontWeight: 700 }}>
                          ₴ {rt.basePrice} / ніч
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Місткість: {rt.baseOccupancy || 2} - {rt.maxOccupancy || 4} осіб
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Rooms / Units Section */}
            <section className="card" style={{ padding: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                <DoorOpen size={18} style={{ color: 'var(--accent-info)' }} /> Номери / Намети ({rooms.length})
              </h3>

              {rooms.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                  Номерний фонд порожній. Натисніть "+ Додати Кімнату / Намет".
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                  {rooms.map((r) => {
                    const category = roomTypes.find((rt) => rt.id === r.roomTypeId);
                    return (
                      <div
                        key={r.id}
                        style={{
                          padding: 16,
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-primary)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{r.roomNumber}</span>
                          <span className="badge badge-success" style={{ fontSize: 10, textTransform: 'uppercase' }}>
                            {r.status || 'Вільний'}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {category?.name || 'Кімната'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Modal Category */}
      {showCategoryModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag size={18} style={{ color: 'var(--accent-warning)' }} /> Нова Категорія Номеру / Намету
              </h3>
              <button
                onClick={() => setShowCategoryModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Назва Категорії</label>
                <input
                  className="form-input"
                  required
                  placeholder="напр. Panoramic Dome / Deluxe Suite"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label">Базова Ціна за ніч ({property?.currency || 'UAH'})</label>
                <input
                  type="number"
                  className="form-input"
                  required
                  placeholder="2500"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowCategoryModal(false)}
                >
                  Скасувати
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Зберегти Категорію
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Room */}
      {showRoomModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <DoorOpen size={18} style={{ color: 'var(--accent-info)' }} /> Додати Номер або Намет
              </h3>
              <button
                onClick={() => setShowRoomModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Категорія / Тип</label>
                <select
                  className="form-select"
                  value={selectedRoomTypeId}
                  onChange={(e) => setSelectedRoomTypeId(e.target.value)}
                >
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name} (₴{rt.basePrice})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Номер / Назва Кімнати</label>
                <input
                  className="form-input"
                  required
                  placeholder="напр. Dome #3 / Room 204"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowRoomModal(false)}
                >
                  Скасувати
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Додати Номер
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
