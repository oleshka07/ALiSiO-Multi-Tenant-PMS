/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useT } from '@core/i18n/client';
import { BRAND_PALETTES } from '@/core/brand-palettes';
import { useState, useEffect, useCallback } from 'react';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { Save, Check, Plus, Trash2, ChevronDown, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { ImageUploadField } from '@/components/ui/ImageUploadField';

// ─── Interfaces ──────────────────────────────────
interface ConfigItem {
  unit_type_id: string;
  unit_type_name: string;
  unit_type_code: string;
  category_type: string;
  category_name: string;
  category_icon: string;
  amenities: string;
  check_in_instructions: string;
  external_amenities: string | null;
  faq_items: string;
  rules: string;
  wifi_network: string;
  wifi_password: string;
  restaurant_name: string;
  restaurant_hours: string;
  restaurant_menu_url: string | null;
  useful_info: string;
  lock_code: string;
  maps_url: string;
  territory_map_url: string | null;
}

interface AmenityItem { icon: string; name: string; }
interface FaqItem { q: string; a: string; }
interface RuleItem { icon: string; text: string; }
interface UsefulItem { icon: string; title: string; desc: string; url?: string; photo_url?: string; }

function parseJSON<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ─── Upload helper ───────────────────────────────
async function uploadImage(file: File, folder: string): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);
  try {
    const res = await fetch('/api/file-upload', { method: 'POST', body: formData });
    if (res.ok) {
      const data = await res.json();
      return data.url;
    }
    return null;
  } catch { return null; }
}

// ─── Section Header ──────────────────────────────
function SectionHeader({ id, title, icon, openSections, toggle }: { id: string; title: string; icon: string; openSections: Set<string>; toggle: (id: string) => void }) {
  return (
    <button onClick={() => toggle(id)} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0',
      background: 'none', border: 'none', borderBottom: '1px solid var(--border-primary)',
      color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit',
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 700, flex: 1, textAlign: 'left' }}>{title}</span>
      {openSections.has(id) ? <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />}
    </button>
  );
}

/**
 * Підписи палітр — мовою оператора, через `t()`.
 *
 * Названо КОЛЬОРОМ, як і самі ключі (інваріант 20): адміністратор має обирати
 * «бірюза і тепло-сірий», а не назву чужого готелю. Реєстр ключів —
 * `@core/brand-palettes`; що кожен ключ звідти має тут рядок, стереже
 * `brand-palettes.check` — палітра без підпису показалася б оператору сирим
 * `teal_warm_grey`.
 */
const PALETTE_NAMES: Record<string, string> = {
  sand_brass: 'Пісок і латунь',
  teal_warm_grey: 'Бірюза і тепло-сірий',
  forest_stone: 'Лісова зелень і камінь',
  ink_amber: 'Графіт і бурштин',
};

// ═════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════
export default function GuestPageSettingsPage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<'sections' | 'property' | 'unit-types'>('sections');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['wifi', 'restaurant']));

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const toggleSection = (id: string) => {
    setOpenSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ═══ PROPERTY STATE ═══
  // Обʼєкт — з області в шапці (check-property-scope). Цей екран НІКОЛИ не
  // мав селектора: він мовчки брав перший обʼєкт і перший конфіг, тож у
  // готелю з двома гостьова сторінка другого не редагувалась узагалі.
  const { propertyId } = usePropertyScope();
  const [propConfig, setPropConfig] = useState<any>(null);
  // Property form fields
  const [pWifi, setPWifi] = useState('');
  const [pWifiPass, setPWifiPass] = useState('');
  const [pRestName, setPRestName] = useState('');
  const [pRestHours, setPRestHours] = useState('');
  const [pRestMenu, setPRestMenu] = useState('');
  const [pRules, setPRules] = useState<RuleItem[]>([]);
  const [pFaq, setPFaq] = useState<FaqItem[]>([]);
  const [pUseful, setPUseful] = useState<UsefulItem[]>([]);
  const [pMaps, setPMaps] = useState('');
  const [pTerritoryMap, setPTerritoryMap] = useState('');
  const [pPets, setPPets] = useState('welcome');
  const [pParking, setPParking] = useState('');
  const [pParkingPhoto, setPParkingPhoto] = useState('');
  const [pParkingMaps, setPParkingMaps] = useState('');
  const [pWeatherLat, setPWeatherLat] = useState('');
  const [pWeatherLon, setPWeatherLon] = useState('');
  const [pEmergency, setPEmergency] = useState('');
  const [pWhatsapp, setPWhatsapp] = useState('');
  const [pVideoGuide, setPVideoGuide] = useState('');

  // ═══ UNIT TYPE STATE ═══
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [selected, setSelected] = useState<string>('');
  // Unit type form fields
  const [amenities, setAmenities] = useState<AmenityItem[]>([]);
  const [instructions, setInstructions] = useState('');
  const [lockCode, setLockCode] = useState('');
  const [petsPolicy, setPetsPolicy] = useState('');
  const [entryPhotoUrl, setEntryPhotoUrl] = useState('');

  // ═══ SECTIONS STATE (реєстр сторінки) ═══
  const [pageSections, setPageSections] = useState<any[]>([]);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const toggleCard = (key: string) =>
    setOpenCards(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  // ─── Вигляд обʼєкта (0419) ───────────────────────────────────────────
  //
  // Кольори й лого належать ОБʼЄКТУ, тому пишуться туди ж, куди решта його
  // полів — `PATCH /api/properties/<id>`. Окремого маршруту «тема» немає
  // навмисно: другий писач у ту саму таблицю означав би два місця, де
  // перевіряють те саме значення.
  const [brandPalette, setBrandPalette] = useState('');
  const [brandLogo, setBrandLogo] = useState('');
  const [brandBusy, setBrandBusy] = useState(false);
  const [sectionsBusy, setSectionsBusy] = useState(false);

  // stale?: дві зміни propertyId поспіль = два запити в польоті, і
  // повільніший ПЕРШИЙ приходив останнім — превʼю показувало «немає броні»
  // для обʼєкта, якого вже не вибрано. Відповідь застосовується лише якщо
  // ефект, що її замовив, ще чинний.
  const fetchSections = useCallback(async (pid: string | null, stale?: () => boolean) => {
    if (!pid) return;
    try {
      const res = await fetch(`/api/settings/guest-page-sections?property_id=${pid}`);
      const data = await res.json();
      if (stale?.()) return;
      if (Array.isArray(data.sections)) setPageSections(data.sections);
    } catch { /* залишаємо попередній стан */ }
    try {
      const res = await fetch(`/api/settings/guest-page-preview?property_id=${pid}`);
      const data = await res.json();
      if (stale?.()) return;
      setPreviewToken(data.token ?? null);
    } catch { if (!stale?.()) setPreviewToken(null); }
  }, []);

  // Зміни зберігаються одразу — перемикач без кнопки «Зберегти», бо превʼю
  // поруч має показувати наслідок того самого кліку.
  const pushSections = async (changes: Array<{ section: string; enabled?: boolean; sort_order?: number }>) => {
    if (!propertyId) return;
    setSectionsBusy(true);
    try {
      const res = await fetch('/api/settings/guest-page-sections', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, sections: changes }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.sections)) {
        setPageSections(data.sections);
        setPreviewNonce((n) => n + 1);
      } else showToast(data.error || t('Помилка збереження'));
    } catch { showToast(t('Помилка мережі')); }
    setSectionsBusy(false);
  };

  const toggleSectionEnabled = (key: string, enabled: boolean) =>
    pushSections([{ section: key, enabled }]);

  // Переставлення: міняємось порядковими місцями з сусідом. Порядок пишемо
  // ОБОМ рядкам явно, кроком 10 — щоб між будь-якими двома лишалося місце.
  const moveSection = (key: string, dir: -1 | 1) => {
    const idx = pageSections.findIndex((sec) => sec.key === key);
    const other = idx + dir;
    if (idx < 0 || other < 0 || other >= pageSections.length) return;
    const reordered = [...pageSections];
    [reordered[idx], reordered[other]] = [reordered[other], reordered[idx]];
    pushSections(reordered.map((sec, i) => ({ section: sec.key, sort_order: (i + 1) * 10 })));
  };

  // ─── Вигляд: писач ──────────────────────────────
  //
  // Відповідь ЧИТАЄТЬСЯ (`res.ok` + тіло). Писач обʼєкта відмовляє названими
  // словами на невідому палітру і на адресу, яку браузер гостя заблокує, —
  // і екран, що показує «Збережено» на 400, сховав би саме ці дві відмови
  // (`check-unread-write-response`, П1).
  async function saveBrand() {
    if (!propertyId) return;
    setBrandBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_palette: brandPalette, brand_logo_url: brandLogo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(String(data?.error || t('Не вдалося зберегти вигляд')));
        return;
      }
      showToast(t('Вигляд збережено'));
      // Превʼю — це справжня сторінка в рамці, тож єдиний чесний спосіб
      // показати нові кольори це перезавантажити її.
      setPreviewNonce((n) => n + 1);
    } catch {
      showToast(t('Не вдалося зберегти вигляд'));
    } finally {
      setBrandBusy(false);
    }
  }

  // ─── Fetch ─────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Конфіг обʼєкта — саме ОБРАНОГО, не перший у списку.
      const pgcRes = await fetch('/api/property-guest-config');
      const pgcData = await pgcRes.json();
      const own = Array.isArray(pgcData) ? pgcData.find((c: any) => c.property_id === propertyId) : null;
      setPropConfig(own ?? null);
      loadPropertyConfig(own ?? {});

      // Вигляд обʼєкта — з самого обʼєкта, не з конфігу гостьової сторінки:
      // палітру носить і застосунок на наліпці, а він про цей конфіг не знає.
      const propRes = await fetch(`/api/properties/${propertyId}`);
      if (propRes.ok) {
        const prop = await propRes.json().catch(() => ({}));
        setBrandPalette(String(prop?.brand_palette ?? ''));
        setBrandLogo(String(prop?.brand_logo_url ?? ''));
      }

      // Fetch unit type configs
      const utRes = await fetch('/api/guest-page-config');
      const utData = await utRes.json();
      if (Array.isArray(utData)) {
        setConfigs(utData);
        if (!selected && utData.length > 0) {
          setSelected(utData[0].unit_type_id);
          loadUnitTypeConfig(utData[0]);
        }
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    let cancelled = false;
    fetchSections(propertyId, () => cancelled);
    return () => { cancelled = true; };
  }, [propertyId, fetchSections]);

  // ─── Load property config ─────────────────────
  const loadPropertyConfig = (cfg: any) => {
    setPWifi(cfg.wifi_network || '');
    setPWifiPass(cfg.wifi_password || '');
    setPRestName(cfg.restaurant_name || '');
    setPRestHours(cfg.restaurant_hours || '');
    setPRestMenu(cfg.restaurant_menu_url || '');
    setPRules(parseJSON<RuleItem[]>(cfg.rules, []));
    setPFaq(parseJSON<FaqItem[]>(cfg.faq_items, []));
    setPUseful(parseJSON<UsefulItem[]>(cfg.useful_info, []));
    setPMaps(cfg.maps_url || '');
    setPTerritoryMap(cfg.territory_map_url || '');
    setPPets(cfg.pets_policy || 'welcome');
    setPParking(cfg.parking_info || '');
    setPParkingPhoto(cfg.parking_photo_url || '');
    setPParkingMaps(cfg.parking_maps_url || '');
    setPWeatherLat(cfg.weather_lat?.toString() || '');
    setPWeatherLon(cfg.weather_lon?.toString() || '');
    setPEmergency(cfg.emergency_phone || '');
    setPWhatsapp(cfg.whatsapp_phone || '');
    setPVideoGuide(cfg.video_guide_url || '');
  };

  // ─── Load unit type config ────────────────────
  const loadUnitTypeConfig = (cfg: ConfigItem) => {
    setAmenities(parseJSON<AmenityItem[]>(cfg.amenities, []));
    setInstructions(cfg.check_in_instructions || '');
    setLockCode((cfg as any).lock_code || '');
    setPetsPolicy((cfg as any).pets_policy || '');
    setEntryPhotoUrl((cfg as any).entry_photo_url || '');
  };

  const handleSelectUnitType = (utId: string) => {
    setSelected(utId);
    const cfg = configs.find(c => c.unit_type_id === utId);
    if (cfg) loadUnitTypeConfig(cfg);
  };

  // ─── Save property config ─────────────────────
  const savePropertyConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/property-guest-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          wifi_network: pWifi, wifi_password: pWifiPass,
          restaurant_name: pRestName, restaurant_hours: pRestHours, restaurant_menu_url: pRestMenu || null,
          rules: pRules, faq_items: pFaq, useful_info: pUseful,
          maps_url: pMaps || null, territory_map_url: pTerritoryMap || null,
          pets_policy: pPets, parking_info: pParking, parking_photo_url: pParkingPhoto || null,
          parking_maps_url: pParkingMaps || null,
          weather_lat: pWeatherLat ? parseFloat(pWeatherLat) : null,
          weather_lon: pWeatherLon ? parseFloat(pWeatherLon) : null,
          emergency_phone: pEmergency || null, whatsapp_phone: pWhatsapp || null,
          video_guide_url: pVideoGuide || null,
        }),
      });
      if (res.ok) { showToast(t('Збережено!')); fetchAll(); setPreviewNonce(n => n + 1); } else showToast(t('Помилка збереження'));
    } catch { showToast(t('Помилка мережі')); }
    setSaving(false);
  };

  // ─── Save unit type config ────────────────────
  const saveUnitTypeConfig = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/guest-page-config/${selected}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amenities,
          check_in_instructions: instructions,
          lock_code: lockCode || null,
          pets_policy: petsPolicy || null,
          entry_photo_url: entryPhotoUrl || null,
        }),
      });
      if (res.ok) { showToast(t('Збережено!')); fetchAll(); } else showToast(t('Помилка збереження'));
    } catch { showToast(t('Помилка мережі')); }
    setSaving(false);
  };

  const SH = ({ id, title, icon }: { id: string; title: string; icon: string }) => (
    <SectionHeader id={id} title={title} icon={icon} openSections={openSections} toggle={toggleSection} />
  );

  const catColors: Record<string, string> = { glamping: '#a78bfa', resort: '#60a5fa', camping: '#34d399' };
  const selectedConfig = configs.find(c => c.unit_type_id === selected);

  // Поля кожної секції живуть у її картці. Це і є весь сенс екрана: перемикач
  // і зміст — в одному місці, превʼю праворуч показує наслідок. Вкладки
  // «Property» більше немає — її групи розʼїхались по секціях, які гість
  // реально бачить за цими даними.
  const sectionFields: Record<string, React.ReactNode> = {
    quick_actions: (<>
                <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 0', color: 'var(--text-secondary)' }}>{t('Wi-Fi')}</div>
                  <div style={{ padding: '16px 0' }}>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">{t('Мережа')}</label>
                        <input className="form-input" value={pWifi} onChange={e => setPWifi(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t('Пароль')}</label>
                        <input className="form-input" value={pWifiPass} onChange={e => setPWifiPass(e.target.value)} />
                      </div>
                    </div>
                  </div>

                <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 0', color: 'var(--text-secondary)' }}>{t('Навігація та карти')}</div>
                  <div style={{ padding: '16px 0' }}>
                    <div className="form-group">
                      <label className="form-label">{t('Google Maps URL (спільний)')}</label>
                      <input className="form-input" type="url" value={pMaps} placeholder="https://maps.app.goo.gl/..." onChange={e => setPMaps(e.target.value)} />
                    </div>
                    <ImageUploadField
                      label={t('Карта території')}
                      value={pTerritoryMap}
                      onChange={setPTerritoryMap}
                      folder="territory-maps"
                    />
                  </div>

                <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 0', color: 'var(--text-secondary)' }}>{t('Тварини та паркінг')}</div>
                  <div style={{ padding: '16px 0' }}>
                    <div className="form-group">
                      <label className="form-label">{t('Політика щодо тварин')}</label>
                      <select className="form-input" value={pPets} onChange={e => setPPets(e.target.value)}>
                        <option value="welcome">{t('🐕 Можна з тваринами')}</option>
                        <option value="with_fee">{t('💰 З доплатою')}</option>
                        <option value="not_allowed">{t('🚫 Не допускаються')}</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Інформація про паркінг')}</label>
                      <textarea className="form-input" rows={2} value={pParking} placeholder="Free parking at the entrance..." onChange={e => setPParking(e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    <ImageUploadField
                      label={t('Фото паркінгу')}
                      value={pParkingPhoto}
                      onChange={setPParkingPhoto}
                      folder="parking"
                    />
                    <div className="form-group">
                      <label className="form-label">{t('Маршрут до паркінгу (Google Maps URL)')}</label>
                      <input className="form-input" type="url" value={pParkingMaps} placeholder="https://maps.app.goo.gl/..." onChange={e => setPParkingMaps(e.target.value)} />
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{t('Якщо порожньо — кнопка навігації в секції паркінгу веде на спільний Google Maps URL')}</div>
                    </div>
                  </div>
    </>),
    restaurant: (<>
                  <div style={{ padding: '16px 0' }}>
                    <div className="form-group">
                      <label className="form-label">{t('Назва')}</label>
                      <input className="form-input" value={pRestName} onChange={e => setPRestName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Години роботи')}</label>
                      <textarea className="form-input" rows={3} value={pRestHours} onChange={e => setPRestHours(e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Посилання на меню (URL)')}</label>
                      <input className="form-input" type="url" value={pRestMenu} placeholder="https://..." onChange={e => setPRestMenu(e.target.value)} />
                    </div>
                  </div>
    </>),
    rules: (<>
                  <div style={{ padding: '16px 0' }}>
                    {pRules.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                        <input className="form-input" style={{ width: 50, textAlign: 'center', fontSize: 18, padding: '6px 4px' }}
                          value={r.icon} onChange={e => setPRules(prev => prev.map((p, idx) => idx === i ? { ...p, icon: e.target.value } : p))} />
                        <input className="form-input" style={{ flex: 1 }} value={r.text} placeholder={t('Правило')}
                          onChange={e => setPRules(prev => prev.map((p, idx) => idx === i ? { ...p, text: e.target.value } : p))} />
                        <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                          onClick={() => setPRules(prev => prev.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button>
                      </div>
                    ))}
                    <button className="btn btn-sm btn-ghost" onClick={() => setPRules(prev => [...prev, { icon: '📌', text: '' }])}>
                      <Plus size={14} /> {t('Додати правило')}
                    </button>
                  </div>
    </>),
    faq: (<>
                  <div style={{ padding: '16px 0' }}>
                    {pFaq.map((f, i) => (
                      <div key={i} style={{ marginBottom: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>{t('Питання')} {i + 1}</span>
                          <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                            onClick={() => setPFaq(prev => prev.filter((_, idx) => idx !== i))}><Trash2 size={12} /></button>
                        </div>
                        <input className="form-input" value={f.q} placeholder={t('Питання')} style={{ marginBottom: 8, fontWeight: 600 }}
                          onChange={e => setPFaq(prev => prev.map((p, idx) => idx === i ? { ...p, q: e.target.value } : p))} />
                        <textarea className="form-input" rows={2} value={f.a} placeholder={t('Відповідь')} style={{ resize: 'vertical' }}
                          onChange={e => setPFaq(prev => prev.map((p, idx) => idx === i ? { ...p, a: e.target.value } : p))} />
                      </div>
                    ))}
                    <button className="btn btn-sm btn-ghost" onClick={() => setPFaq(prev => [...prev, { q: '', a: '' }])}>
                      <Plus size={14} /> {t('Додати питання')}
                    </button>
                  </div>
    </>),
    explore: (<>
                  <div style={{ padding: '16px 0' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                      {t('Магазини, аптеки, маршрути — спільне для всіх гостей')}
                    </div>
                    {pUseful.map((u, i) => (
                      <div key={i} style={{ marginBottom: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>{t('Блок')} {i + 1}</span>
                          <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                            onClick={() => setPUseful(prev => prev.filter((_, idx) => idx !== i))}><Trash2 size={12} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input className="form-input" style={{ width: 50, textAlign: 'center', fontSize: 18, padding: '6px 4px' }}
                            value={u.icon} onChange={e => setPUseful(prev => prev.map((p, idx) => idx === i ? { ...p, icon: e.target.value } : p))} />
                          <input className="form-input" style={{ flex: 1 }} value={u.title} placeholder={t('Заголовок')}
                            onChange={e => setPUseful(prev => prev.map((p, idx) => idx === i ? { ...p, title: e.target.value } : p))} />
                        </div>
                        <textarea className="form-input" rows={2} value={u.desc} placeholder={t('Опис')} style={{ resize: 'vertical', marginBottom: 8 }}
                          onChange={e => setPUseful(prev => prev.map((p, idx) => idx === i ? { ...p, desc: e.target.value } : p))} />
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: 11 }}>{t('🔗 Посилання (URL) — з\'явиться кнопка "Navigate" на сторінці')}</label>
                          <input className="form-input" type="url" value={u.url || ''} placeholder="https://maps.google.com/..."
                            onChange={e => setPUseful(prev => prev.map((p, idx) => idx === i ? { ...p, url: e.target.value } : p))} />
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <ImageUploadField
                            label={t('📸 Фото місця (показується в каруселі)')}
                            value={(u as any).photo_url || ''}
                            onChange={url => setPUseful(prev => prev.map((p, idx) => idx === i ? { ...p, photo_url: url } : p))}
                            folder="explore"
                            aspectRatio="4/3"
                          />
                        </div>
                      </div>
                    ))}
                    <button className="btn btn-sm btn-ghost" onClick={() => setPUseful(prev => [...prev, { icon: '📌', title: '', desc: '', url: '', photo_url: '' }])}>
                      <Plus size={14} /> {t('Додати блок')}
                    </button>
                  </div>
    </>),
    good_to_know: (<>
                <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 0', color: 'var(--text-secondary)' }}>{t('Погода та контакти')}</div>
                  <div style={{ padding: '16px 0' }}>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">{t('Широта (lat)')}</label>
                        <input className="form-input" type="number" step="0.0001" value={pWeatherLat} placeholder="50.2311" onChange={e => setPWeatherLat(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t('Довгота (lon)')}</label>
                        <input className="form-input" type="number" step="0.0001" value={pWeatherLon} placeholder="12.8730" onChange={e => setPWeatherLon(e.target.value)} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Телефон підтримки / екстренний')}</label>
                      <input className="form-input" value={pEmergency} placeholder="+…" onChange={e => setPEmergency(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('WhatsApp гостьової сторінки')}</label>
                      <input className="form-input" value={pWhatsapp} placeholder="+420…" onChange={e => setPWhatsapp(e.target.value)} />
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                        {t('Порожньо — вкладки WhatsApp у гостя не буде.')}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Відео-гайд (URL)')}</label>
                      <input className="form-input" type="url" value={pVideoGuide} placeholder="https://youtube.com/..." onChange={e => setPVideoGuide(e.target.value)} />
                    </div>
                  </div>
    </>),
  };


  // ═════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════
  return (
    <>
      <div className="app-content">
        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: 'var(--accent-success)', color: '#fff',
            padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s ease',
          }}>
            <Check size={16} /> {toast}
          </div>
        )}

        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Link href="/app/settings" style={{ color: 'var(--text-tertiary)', display: 'flex' }}><ArrowLeft size={18} /></Link>
              <h2 className="page-title">{t('Налаштування гостьової сторінки')}</h2>
            </div>
            <div className="page-subtitle">{t('Спільні налаштування та контент для кожного типу проживання')}</div>
          </div>
          {activeTab === 'unit-types' && (
            <button className="btn btn-primary" onClick={saveUnitTypeConfig} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-pulse" /> : <Save size={16} />} {t('Зберегти')}
            </button>
          )}
        </div>

        <PropertyRequired>
        {/* ═══ TAB SWITCHER ═══ */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: 4 }}>
          {[
            { id: 'sections' as const, label: t('🧩 Секції сторінки'), desc: t('Що показувати, порядок і зміст') },
            { id: 'unit-types' as const, label: '🏠 Unit Types', desc: t('Amenities, код замка, інструкції') },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex: 1, padding: '10px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 13, fontFamily: 'inherit',
              transition: 'all 0.2s ease', textAlign: 'left',
            }}>
              <div>{tab.label}</div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{tab.desc}</div>
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <Loader2 size={20} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження…')}
          </div>
        ) : (
          <>
            {/* ═══════════════════════════════════════════ */}
            {/* ═══ SECTIONS TAB: що показувати і як ═══════ */}
            {/* ═══════════════════════════════════════════ */}
            {activeTab === 'sections' && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {/* ═══ Вигляд: кольори і лого обʼєкта (0419) ═══ */}
                <div className="card" style={{ padding: 20, flex: '1 1 100%' }}>
                  <div style={{ marginBottom: 4, fontWeight: 700, fontSize: 15 }}>
                    {t('Вигляд')}
                  </div>
                  <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {t('Кольори й лого бачить гість — і на цій сторінці, і в застосунку з наліпки на дверях. Превʼю праворуч показує справжню сторінку, тож після збереження вона перемалюється.')}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {BRAND_PALETTES.map((pal) => (
                      <button key={pal.key} type="button" disabled={brandBusy}
                        className={`btn btn-sm ${brandPalette === pal.key ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setBrandPalette(pal.key)}>
                        {t(PALETTE_NAMES[pal.key] ?? pal.key)}
                      </button>
                    ))}
                  </div>

                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {t('Адреса лого')}
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="input" value={brandLogo} placeholder="https://…"
                      onChange={(e) => setBrandLogo(e.target.value)}
                      style={{ flex: '1 1 320px', maxWidth: 520 }} />
                    {/*
                      Завантаження поруч із полем, а не замість: лого готелю
                      частіше вже лежить на його сайті, і змушувати шукати файл
                      заради адреси, яка вже є, — зайвий крок. А от коли файлу
                      в мережі немає, поле «вставте адресу» це глухий кут.
                    */}
                    <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                      {t('Завантажити файл')}
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setBrandBusy(true);
                          const url = await uploadImage(file, 'brand');
                          setBrandBusy(false);
                          // Відповідь читається: `uploadImage` віддає `null` і
                          // на 500, і на відмову сховища, а поле, яке після
                          // вибору файла лишилось порожнім без жодного слова,
                          // читається як «воно не працює».
                          if (url) setBrandLogo(url);
                          else showToast(t('Файл не завантажився — спробуйте ще раз або вставте адресу'));
                        }} />
                    </label>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {t('Порожньо — гість побачить назву готелю текстом. Тільки https:// — адресу на http:// браузер гостя заблокує мовчки.')}
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <button className="btn btn-primary btn-sm" disabled={brandBusy}
                      onClick={() => { void saveBrand(); }}>
                      {brandBusy ? t('Збереження…') : t('Зберегти вигляд')}
                    </button>
                  </div>
                </div>

                {/* Список секцій */}
                <div className="card" style={{ padding: 20, flex: '1 1 420px', minWidth: 340 }}>
                  <div style={{ marginBottom: 4, fontWeight: 700, fontSize: 15 }}>
                    {t('Секції гостьової сторінки')}
                  </div>
                  <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {t('Вимикайте зайве і розставляйте порядок — превʼю праворуч показує сторінку гостя одразу.')}
                  </div>
                  {pageSections.map((sec, i) => {
                    const NAMES: Record<string, { icon: string; name: string; desc: string }> = {
                      hero:          { icon: '🎫', name: t('Шапка й відлік'),        desc: t('Імʼя, дати, скільки днів лишилось') },
                      quick_actions: { icon: '⚡', name: t('Швидкі дії'),            desc: t('Кнопки: як доїхати, вхід, Wi-Fi, паркінг') },
                      stay_status:   { icon: '📋', name: t('Статус проживання'),     desc: t('Чеклист дня: підтверджено, реєстрація, вхід') },
                      registration:  { icon: '🪪', name: t('Реєстрація гостей'),     desc: t('Онлайн-реєстрація перед заїздом') },
                      payments:      { icon: '💳', name: t('Оплата'),                desc: t('Залишок і кнопка оплати перед заїздом') },
                      services:      { icon: '✨', name: t('Послуги'),               desc: t('Вкладка замовлення послуг і кошик') },
                      unit_info:     { icon: '🛏', name: t('Ваш номер'),             desc: t('Фото, зручності, опис') },
                      good_to_know:  { icon: '💡', name: t('Корисно знати'),         desc: t('Час заїзду/виїзду, Wi-Fi, тварини, телефон') },
                      restaurant:    { icon: '🍽', name: t('Ресторан'),              desc: t('Картка ресторану і меню') },
                      explore:       { icon: '🗺', name: t('Околиці'),               desc: t('Вкладка з місцями поруч і мапою') },
                      faq:           { icon: '❓', name: t('Питання й відповіді'),   desc: t('Акордеон найчастіших питань') },
                      rules:         { icon: '📜', name: t('Правила будинку'),       desc: t('Короткі правила чипсами') },
                      feedback:      { icon: '💬', name: t('Відгук після виїзду'),   desc: t('Форма враження в день виїзду') },
                    };
                    const info = NAMES[sec.key] || { icon: '▫️', name: sec.key, desc: '' };
                    return (
                      <div key={sec.key}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px',
                        borderBottom: '1px solid var(--border)', opacity: sec.enabled ? 1 : 0.55,
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button className="btn btn-sm btn-ghost" style={{ padding: '0 6px', fontSize: 11, lineHeight: '14px' }}
                            disabled={sectionsBusy || i === 0} onClick={() => moveSection(sec.key, -1)}>▲</button>
                          <button className="btn btn-sm btn-ghost" style={{ padding: '0 6px', fontSize: 11, lineHeight: '14px' }}
                            disabled={sectionsBusy || i === pageSections.length - 1} onClick={() => moveSection(sec.key, 1)}>▼</button>
                        </div>
                        <span style={{ fontSize: 20 }}>{info.icon}</span>
                        <div style={{ flex: 1, minWidth: 0, cursor: sectionFields[sec.key] ? 'pointer' : 'default' }}
                          onClick={() => sectionFields[sec.key] && toggleCard(sec.key)}>
                          <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {info.name}
                            {sectionFields[sec.key] && (openCards.has(sec.key)
                              ? <ChevronDown size={13} style={{ color: 'var(--text-tertiary)' }} />
                              : <ChevronRight size={13} style={{ color: 'var(--text-tertiary)' }} />)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{info.desc}</div>
                        </div>
                        {sec.locked ? (
                          <span title={sec.locked === 'jurisdiction'
                              ? t('Обовʼязкова за законом країни обʼєкта (реєстрація гостей)')
                              : t('Без цієї секції сторінка не працює')}
                            style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            🔒 {sec.locked === 'jurisdiction' ? t('закон') : t('основа')}
                          </span>
                        ) : (
                          <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, flexShrink: 0 }}>
                            <input type="checkbox" checked={!!sec.enabled} disabled={sectionsBusy}
                              onChange={(e) => toggleSectionEnabled(sec.key, e.target.checked)}
                              style={{ opacity: 0, width: 0, height: 0 }} />
                            <span style={{
                              position: 'absolute', inset: 0, borderRadius: 22, transition: 'all .15s',
                              background: sec.enabled ? 'var(--accent-primary)' : 'var(--border)',
                            }} />
                            <span style={{
                              position: 'absolute', top: 2, left: sec.enabled ? 20 : 2, width: 18, height: 18,
                              borderRadius: '50%', background: '#fff', transition: 'all .15s',
                              boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                            }} />
                          </label>
                        )}
                      </div>
                      {openCards.has(sec.key) && sectionFields[sec.key] && (
                        <div style={{ padding: '4px 8px 16px 44px', borderBottom: '1px solid var(--border)' }}>
                          {sectionFields[sec.key]}
                          <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }}
                            disabled={saving} onClick={savePropertyConfig}>
                            {saving ? <Loader2 size={13} className="animate-pulse" /> : <Save size={13} />} {t('Зберегти зміни')}
                          </button>
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>

                {/* Превʼю телефона: справжня сторінка справжньої броні */}
                <div style={{ flex: '0 0 360px' }}>
                  <div style={{
                    width: 340, borderRadius: 36, border: '10px solid #1a1a2e', overflow: 'hidden',
                    boxShadow: '0 12px 40px rgba(0,0,0,.35)', background: '#000',
                  }}>
                    {previewToken ? (
                      <iframe key={previewNonce} src={`/guest/${previewToken}`} title={t('Превʼю сторінки гостя')}
                        style={{ width: '100%', height: 640, border: 'none', display: 'block', background: '#fff' }} />
                    ) : (
                      <div style={{ height: 640, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b8fa3', fontSize: 13, textAlign: 'center', padding: 24 }}>
                        {t('Превʼю зʼявиться, щойно в обʼєкта буде хоч одна бронь зі сторінкою гостя.')}
                      </div>
                    )}
                  </div>
                  {previewToken && (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                      {t('Це жива сторінка останньої броні — зміни видно одразу.')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════ */}
            {/* ═══ PROPERTY TAB ═══════════════════════════ */}
            {/* ═══════════════════════════════════════════ */}
            {/* ═══════════════════════════════════════════ */}
            {/* ═══ UNIT TYPES TAB ═════════════════════════ */}
            {/* ═══════════════════════════════════════════ */}
            {activeTab === 'unit-types' && (
              <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
                {/* Left — Unit type selector */}
                <div className="card" style={{ padding: 0, position: 'sticky', top: 80 }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                    {t('Тип проживання')}
                  </div>
                  {configs.map(cfg => {
                    const active = cfg.unit_type_id === selected;
                    const catColor = catColors[cfg.category_type] || '#6c7086';
                    return (
                      <div key={cfg.unit_type_id} onClick={() => handleSelectUnitType(cfg.unit_type_id)} style={{
                        padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                        borderBottom: '1px solid var(--border-primary)',
                        background: active ? 'rgba(79,110,247,0.08)' : 'transparent',
                        borderLeft: active ? '3px solid var(--accent-primary)' : '3px solid transparent',
                        transition: 'all 0.15s ease',
                      }}>
                        <span style={{ fontSize: 16 }}>{cfg.category_icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cfg.unit_type_name}</div>
                          <div style={{ fontSize: 11, color: catColor, fontWeight: 600 }}>{cfg.category_name}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right — Editor */}
                <div className="card" style={{ padding: 20 }}>
                  {selectedConfig && (
                    <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{selectedConfig.category_icon}</span>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedConfig.unit_type_name}</div>
                        <div style={{ fontSize: 12, color: catColors[selectedConfig.category_type], fontWeight: 600 }}>{selectedConfig.category_name}</div>
                      </div>
                    </div>
                  )}

                  <div style={{ padding: '8px 12px', marginBottom: 16, background: 'rgba(79,110,247,0.06)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-tertiary)', border: '1px solid rgba(79,110,247,0.12)' }}>
                    {t('💡 Wi-Fi, ресторан, правила, FAQ та Explore редагуються у вкладці')} <strong>{t('«Секції сторінки»')}</strong> {t('(спільні для всіх)')}
                  </div>

                  {/* Amenities */}
                  <SH id="amenities" title={t('Зручності')} icon="✨" />
                  {openSections.has('amenities') && (
                    <div style={{ padding: '16px 0' }}>
                      {amenities.map((a, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                          <input className="form-input" style={{ width: 50, textAlign: 'center', fontSize: 18, padding: '6px 4px' }}
                            value={a.icon} onChange={e => setAmenities(prev => prev.map((p, idx) => idx === i ? { ...p, icon: e.target.value } : p))} />
                          <input className="form-input" style={{ flex: 1 }} value={a.name} placeholder={t('Назва')}
                            onChange={e => setAmenities(prev => prev.map((p, idx) => idx === i ? { ...p, name: e.target.value } : p))} />
                          <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                            onClick={() => setAmenities(prev => prev.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button>
                        </div>
                      ))}
                      <button className="btn btn-sm btn-ghost" onClick={() => setAmenities(prev => [...prev, { icon: '✅', name: '' }])}>
                        <Plus size={14} /> {t('Додати зручність')}
                      </button>
                    </div>
                  )}

                  {/* Check-in Instructions */}
                  <SH id="instructions" title={t('Інструкція по заїзду')} icon="🚪" />
                  {openSections.has('instructions') && (
                    <div style={{ padding: '16px 0' }}>
                      <textarea className="form-input" rows={4} value={instructions} placeholder={t('Інструкція для гостя при заїзді...')}
                        onChange={e => setInstructions(e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                  )}

                  {/* Lock code */}
                  <SH id="lock" title={t('Код замка')} icon="🔑" />
                  {openSections.has('lock') && (
                    <div style={{ padding: '16px 0' }}>
                      <div className="form-group">
                        <label className="form-label">{t('Код замка / лок-бокса')}</label>
                        <input className="form-input" value={lockCode} placeholder="1234#" onChange={e => setLockCode(e.target.value)} />
                      </div>
                    </div>
                  )}

                  {/* Pets & Entry Photo (override) */}
                  <SH id="pets-override" title={t('Тварини та фото входу')} icon="🐕" />
                  {openSections.has('pets-override') && (
                    <div style={{ padding: '16px 0' }}>
                      <div style={{ padding: '8px 12px', marginBottom: 12, background: 'rgba(79,110,247,0.06)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {t('Якщо залишити порожнім — буде використано значення з Property')}
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t('Політика щодо тварин (override)')}</label>
                        <select className="form-input" value={petsPolicy} onChange={e => setPetsPolicy(e.target.value)}>
                          <option value="">{t('— Використати з Property —')}</option>
                          <option value="welcome">{t('🐕 Можна з тваринами')}</option>
                          <option value="with_fee">{t('💰 З доплатою')}</option>
                          <option value="not_allowed">{t('🚫 Не допускаються')}</option>
                        </select>
                      </div>
                      <ImageUploadField
                        label={t('Фото входу / лок-бокса')}
                        value={entryPhotoUrl}
                        onChange={setEntryPhotoUrl}
                        folder="entry-photos"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        </PropertyRequired>
      </div>
    </>
  );
}
