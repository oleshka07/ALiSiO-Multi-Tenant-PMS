'use client';

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import {
  Plus, Edit3, Trash2, X, Save, Loader2, ArrowLeft,
  RefreshCw, Copy, Check, ExternalLink, Clock, AlertCircle,
  CheckCircle, Building2, Home,
} from 'lucide-react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Канал-менеджер: обмін календарями з OTA.
 *
 * Тут була ще вкладка «API Інтеграції» — форма з'єднання з Connectivity API
 * Booking.com, ключі машинного акаунта, маппінг типів кімнат, лічильник черги
 * ARI. Жоден готель її не вмикав, а екран обіцяв те, чого система не робила.
 * Вкладку і код за нею прибрано; лишився iCal, який працює.
 */

interface ICalChannel {
  id: string;
  channel_type: 'building' | 'unit';
  building_id: string | null;
  unit_id: string | null;
  source_code: string;
  ical_url: string | null;
  export_token: string;
  sync_interval_minutes: number;
  is_active: number;
  last_synced_at: string | null;
  target_name: string;
  target_code: string;
  source_name: string;
  source_color: string;
  source_icon: string;
  last_log: {
    status: string;
    events_found: number;
    events_created: number;
    events_updated: number;
    error_message: string | null;
    synced_at: string;
  } | null;
}

interface BookingSource {
  id: string;
  name: string;
  code: string;
  color: string;
  icon_letter: string;
}

interface Building {
  id: string;
  name: string;
  code: string;
}

interface Unit {
  id: string;
  name: string;
  code: string;
  category_type: string;
}

// ─── Modal ──────────────────────────────────────────────────

function Modal({ open, onClose, title, children, footer, width }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: width || 520 }}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function ChannelManagerPage() {
  const tUi = useT();
  const onMenuClick = useMobileMenu();

  const [channels, setChannels] = useState<ICalChannel[]>([]);
  const [sources, setSources] = useState<BookingSource[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [mappableUnits, setMappableUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showICalModal, setShowICalModal] = useState(false);
  const [editChannel, setEditChannel] = useState<ICalChannel | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [copiedToken, setCopiedToken] = useState('');

  const [icalForm, setICalForm] = useState({
    channel_type: 'unit' as 'building' | 'unit',
    building_id: '',
    unit_id: '',
    source_code: 'vrbo',
    ical_url: '',
    sync_interval_minutes: 15,
  });

  // ── Data fetching ──

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [chRes, srcRes, bldRes, unitRes] = await Promise.all([
        fetch('/api/ical-sync/channels'),
        fetch('/api/booking-sources'),
        fetch('/api/buildings'),
        fetch('/api/units'),
      ]);
      const ch = await chRes.json();
      const src = await srcRes.json();
      const bld = await bldRes.json();
      const units = await unitRes.json();

      if (Array.isArray(ch)) setChannels(ch);
      if (Array.isArray(src)) setSources(src);
      if (Array.isArray(bld)) setBuildings(bld);
      // Every unit, not one category's.
      //
      // This filtered on `category_type === 'glamping'`, which is one
      // customer's word. A hostel, a pension or a city hotel would open this
      // screen and find the unit list EMPTY — no error, nothing in the log,
      // just no way to map a room onto a channel. Which units may be mapped is
      // the operator's decision, not a guess from a category name.
      if (Array.isArray(units)) setMappableUnits(units);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Helpers ──

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'щойно';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} хв тому`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} год тому`;
    return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ── iCal handlers ──

  const openNewICal = () => {
    setEditChannel(null);
    setICalForm({ channel_type: 'unit', building_id: '', unit_id: '', source_code: 'vrbo', ical_url: '', sync_interval_minutes: 15 });
    setShowICalModal(true);
  };

  const openEditICal = (ch: ICalChannel) => {
    setEditChannel(ch);
    setICalForm({
      channel_type: ch.channel_type, building_id: ch.building_id || '',
      unit_id: ch.unit_id || '', source_code: ch.source_code,
      ical_url: ch.ical_url || '', sync_interval_minutes: ch.sync_interval_minutes,
    });
    setShowICalModal(true);
  };

  const handleSaveICal = async () => {
    setSaving(true);
    try {
      const url = editChannel ? `/api/ical-sync/channels/${editChannel.id}` : '/api/ical-sync/channels';
      const method = editChannel ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(icalForm) });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${tUi(data.error)}`); }
      else { showToast(editChannel ? '✅ Канал оновлено' : '✅ Канал створено'); setShowICalModal(false); fetchData(); }
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleDeleteICal = async (ch: ICalChannel) => {
    if (!confirm(`Видалити канал "${ch.target_name}"?`)) return;
    try {
      const res = await fetch(`/api/ical-sync/channels/${ch.id}`, { method: 'DELETE' });
      if (res.ok) { showToast(tUi('✅ Канал видалено')); fetchData(); }
    } catch (e) { console.error(e); }
  };

  const handleSyncICal = async (channelId: string) => {
    setSyncing(channelId);
    try {
      const res = await fetch('/api/ical-sync/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_id: channelId }) });
      const data = await res.json();
      if (data.results?.[0]?.status === 'success') {
        const r = data.results[0];
        showToast(`✅ Синхронізовано: ${r.events_found} подій, ${r.events_created} нових`);
      } else { showToast(`❌ ${data.results?.[0]?.error || 'Помилка'}`); }
      fetchData();
    } catch (e) { console.error(e); }
    setSyncing(null);
  };

  const handleSyncAllICal = async () => {
    setSyncingAll(true);
    try {
      const res = await fetch('/api/ical-sync/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      showToast(`✅ Синхронізовано ${data.synced} канал(ів)`);
      fetchData();
    } catch (e) { console.error(e); }
    setSyncingAll(false);
  };

  const copyExportUrl = (token: string) => {
    const url = `${window.location.origin}/api/ical-export/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(''), 2000);
  };

  // ─── Render ─────────────────────────────────────────────────

  return (
    <>
      <Header title={tUi('Канал-менеджер')} onMenuClick={onMenuClick} />
      <div className="app-content">
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: toast.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
            color: '#fff', padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.3s ease', maxWidth: 400,
          }}>
            {toast}
          </div>
        )}

        <div className="page-header">
          <div>
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> {tUi('Налаштування')}
            </Link>
            <h2 className="page-title">{tUi('Канал-менеджер')}</h2>
            <div className="page-subtitle">{tUi('iCal синхронізація з OTA')}</div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {tUi('Завантаження...')}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-secondary" onClick={handleSyncAllICal} disabled={syncingAll || channels.length === 0}>
                <RefreshCw size={16} className={syncingAll ? 'animate-pulse' : ''} />
                {syncingAll ? tUi('Синхронізація...') : tUi('Синхронізувати все')}
              </button>
              <button className="btn btn-primary" onClick={openNewICal}>
                <Plus size={16} /> {tUi('Додати канал')}
              </button>
            </div>

            {channels.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                  {tUi('Немає налаштованих iCal каналів')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
                  {tUi('Додайте iCal канал для синхронізації з VRBO, Airbnb або іншим OTA')}
                </div>
                <button className="btn btn-primary" onClick={openNewICal}>
                  <Plus size={16} /> {tUi('Додати перший канал')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {channels.map((ch) => (
                  <div key={ch.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 'var(--radius-md)',
                        background: ch.source_color ? `${ch.source_color}18` : 'var(--bg-tertiary)',
                        color: ch.source_color || 'var(--text-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, fontWeight: 700, flexShrink: 0,
                      }}>
                        {ch.channel_type === 'building' ? <Building2 size={22} /> : <Home size={22} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{ch.target_name || ch.target_code}</span>
                          <span className="badge" style={{ background: (ch.source_color || '#6c7086') + '22', color: ch.source_color || '#6c7086', fontWeight: 700, fontSize: 11 }}>
                            {ch.source_icon} {ch.source_name || ch.source_code}
                          </span>
                          {!ch.is_active && <span className="badge badge-danger" style={{ fontSize: 10 }}>{tUi('Вимкнено')}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {tUi('Інтервал:')} {ch.sync_interval_minutes} {tUi('хв')}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {ch.last_log?.status === 'success'
                              ? <><CheckCircle size={12} style={{ color: 'var(--accent-success)' }} /> {formatTime(ch.last_synced_at)}</>
                              : ch.last_log?.status === 'error'
                              ? <><AlertCircle size={12} style={{ color: 'var(--accent-danger)' }} /> {tUi('Помилка')}</>
                              : <>{tUi('Ще не синхронізовано')}</>
                            }
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {ch.ical_url && (
                          <button className="btn btn-sm btn-secondary" onClick={() => handleSyncICal(ch.id)} disabled={syncing === ch.id} title={tUi('Синхронізувати')}>
                            <RefreshCw size={14} className={syncing === ch.id ? 'animate-pulse' : ''} />
                          </button>
                        )}
                        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => openEditICal(ch)} title={tUi('Редагувати')}><Edit3 size={14} /></button>
                        <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }} onClick={() => handleDeleteICal(ch)} title={tUi('Видалити')}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {ch.ical_url && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, minWidth: 56 }}>{tUi('⬇ Імпорт')}</span>
                          <code style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ch.ical_url}
                          </code>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, minWidth: 56 }}>{tUi('⬆ Експорт')}</span>
                        <code style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          /api/ical-export/{ch.export_token}
                        </code>
                        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => copyExportUrl(ch.export_token)} title={tUi('Копіювати URL')} style={{ color: copiedToken === ch.export_token ? 'var(--accent-success)' : 'var(--text-tertiary)' }}>
                          {copiedToken === ch.export_token ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <a href={`/api/ical-export/${ch.export_token}`} target="_blank" className="btn btn-sm btn-ghost btn-icon" title={tUi('Відкрити iCal')} style={{ color: 'var(--text-tertiary)' }}>
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                    {ch.last_log?.status === 'error' && ch.last_log.error_message && (
                      <div style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.08)', borderTop: '1px solid var(--border-primary)', fontSize: 12, color: 'var(--accent-danger)' }}>
                        ⚠ {ch.last_log.error_message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* iCal Create/Edit Modal */}
        <Modal
          open={showICalModal}
          onClose={() => setShowICalModal(false)}
          title={editChannel ? tUi('Редагувати канал') : tUi('Новий iCal канал')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setShowICalModal(false)}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={handleSaveICal} disabled={saving}>
              <Save size={16} /> {saving ? tUi('Збереження...') : tUi('Зберегти')}
            </button>
          </>}
        >
          {!editChannel && (<>
            <div className="form-group">
              <label className="form-label">{tUi('Тип каналу *')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn ${icalForm.channel_type === 'building' ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1 }} onClick={() => setICalForm(p => ({ ...p, channel_type: 'building', unit_id: '' }))}>
                  <Building2 size={16} /> {tUi('Будівля')}
                </button>
                <button className={`btn ${icalForm.channel_type === 'unit' ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1 }} onClick={() => setICalForm(p => ({ ...p, channel_type: 'unit', building_id: '' }))}>
                  <Home size={16} /> {tUi('Будинок')}
                </button>
              </div>
            </div>
            {icalForm.channel_type === 'building' && (
              <div className="form-group">
                <label className="form-label">{tUi('Будівля *')}</label>
                <select className="form-select" value={icalForm.building_id} onChange={e => setICalForm(p => ({ ...p, building_id: e.target.value }))}>
                  <option value="">{tUi('Оберіть...')}</option>
                  {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            {icalForm.channel_type === 'unit' && (
              <div className="form-group">
                <label className="form-label">{tUi('Одиниця розміщення *')}</label>
                <select className="form-select" value={icalForm.unit_id} onChange={e => setICalForm(p => ({ ...p, unit_id: e.target.value }))}>
                  <option value="">{tUi('Оберіть...')}</option>
                  {mappableUnits.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select>
              </div>
            )}
          </>)}
          <div className="form-group">
            <label className="form-label">{tUi('Джерело (OTA) *')}</label>
            <select className="form-select" value={icalForm.source_code} onChange={e => setICalForm(p => ({ ...p, source_code: e.target.value }))}>
              {sources.filter(s => !['direct', 'phone', 'whatsapp'].includes(s.code)).map(s => (
                <option key={s.code} value={s.code}>{s.icon_letter} {s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('📥 iCal URL (імпорт)')}</label>
            <input className="form-input" placeholder="https://www.vrbo.com/icalendar/...ics" value={icalForm.ical_url} onChange={e => setICalForm(p => ({ ...p, ical_url: e.target.value }))} />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {tUi('Посилання з OTA платформи для імпорту бронювань.')}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('⏱ Інтервал синхронізації')}</label>
            <select className="form-select" value={icalForm.sync_interval_minutes} onChange={e => setICalForm(p => ({ ...p, sync_interval_minutes: Number(e.target.value) }))}>
              <option value={5}>{tUi('5 хв')}</option>
              <option value={15}>{tUi('15 хв (рекомендовано)')}</option>
              <option value={30}>{tUi('30 хв')}</option>
              <option value={60}>{tUi('1 година')}</option>
            </select>
          </div>
        </Modal>
      </div>
    </>
  );
}
