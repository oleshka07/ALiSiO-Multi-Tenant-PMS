'use client';

import { useT } from '@core/i18n/client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';

/**
 * Код для вставки форми бронювання на зовнішній сайт. Модулі «Бронювання
 * сауни / купелі / сніданку» (окремий `service-embed.js`) вирізано 05.09.2026
 * (П17): це був флоу одного клієнта, зашитий у продукт.
 */
export default function BookingWidgetSettingsPage() {
  const t = useT();
  const [sites, setSites] = useState<any[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [listings, setListings] = useState<any[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [lang, setLang] = useState('uk');
  const [color, setColor] = useState('#1a1a2e');
  const [copied, setCopied] = useState(false);
  const [embedMode, setEmbedMode] = useState<'native' | 'iframe'>('native');

  useEffect(() => {
    fetch('/api/booking-sites')
      .then(r => r.json())
      .then(data => {
        const list = data.sites || [];
        setSites(list);
        if (list.length > 0 && !selectedSite) setSelectedSite(list[0].id);
      })
      .catch(() => {});
  }, []);

  // Load listings (models) for the selected site
  useEffect(() => {
    if (!selectedSite) return;
    setLoadingListings(true);
    setSelectedUnit('');
    fetch(`/api/booking-sites/${selectedSite}/listings`)
      .then(r => r.json())
      .then(data => {
        setListings(data.listings || []);
      })
      .catch(() => setListings([]))
      .finally(() => setLoadingListings(false));
  }, [selectedSite]);

  const domain = typeof window !== 'undefined' ? window.location.origin : 'https://your-pms-domain.com';

  const containerId = 'alisio-booking-widget';

  const currentSite = sites.find(s => s.id === selectedSite);
  const siteSlug = currentSite?.slug || '';

  const embedCode = embedMode === 'native'
    ? `<div id="${containerId}" 
     data-site="${siteSlug}" 
     data-lang="${lang}"
     ${selectedUnit ? `data-unit="${selectedUnit}"` : ''}>
</div>
<script src="${domain}/widget/native-embed.js"></script>`
    : `<iframe 
  src="${domain}/w/${siteSlug}?lang=${lang}${selectedUnit ? `&unit=${selectedUnit}` : ''}" 
  style="width: 100%; min-height: 650px; border: none; border-radius: 12px; overflow: hidden;"
  allow="payment"
></iframe>`;

  function copyCode() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Live preview via iframe (dynamic scripts can't use document.currentScript)
  const previewSrc = embedMode === 'native'
    ? `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5}</style>
</head><body>
<div id="alisio-booking-widget" data-site="${siteSlug}" data-lang="${lang}" ${selectedUnit ? `data-unit="${selectedUnit}"` : ''}></div>
<script src="${domain}/widget/native-embed.js"></script>
</body></html>`
    : `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f5f5f5;height:100vh;overflow:hidden;}</style>
</head><body>
<iframe src="${domain}/w/${siteSlug}?lang=${lang}${selectedUnit ? `&unit=${selectedUnit}` : ''}" style="width:100%;height:100%;border:none;" allow="payment"></iframe>
</body></html>`;

  return (
    <>
      <div className="app-content">
        <div className="page-header">
          <div>
            <h2 className="page-title">{t('Віджети бронювання')}</h2>
            <div className="page-subtitle">
              {t('Згенеруйте код для вставки на будь-який зовнішній сайт')}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
          {/* Left: Configuration */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)' }}>
              {t('⚙️ Налаштування')}
            </h3>

            <>
                {/* Embed Mode Toggle */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {t('Метод інтеграції')}
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setEmbedMode('native')}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: embedMode === 'native' ? `2px solid ${color}` : '2px solid var(--border-primary)',
                        background: embedMode === 'native' ? `${color}15` : 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all .15s',
                      }}
                    >
                      {t('🚀 JS Embed (Новий)')}
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {t('Для Clarity, Pixels, GTM')}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmbedMode('iframe')}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: embedMode === 'iframe' ? `2px solid ${color}` : '2px solid var(--border-primary)',
                        background: embedMode === 'iframe' ? `${color}15` : 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all .15s',
                      }}
                    >
                      {t('🔲 Iframe (Класичний)')}
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {t('Без скриптів на сайті')}
                      </div>
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {t('Сайт бронювання')}
                  </label>
                  <select
                    value={selectedSite}
                    onChange={e => setSelectedSite(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--border-primary)', fontSize: 14,
                      background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    }}
                  >
                    {sites.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {t('Модель розміщення (опціонально)')}
                  </label>
                  <select
                    value={selectedUnit}
                    onChange={e => setSelectedUnit(e.target.value)}
                    disabled={loadingListings}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--border-primary)', fontSize: 14,
                      background: 'var(--bg-primary)', color: 'var(--text-primary)',
                      opacity: loadingListings ? 0.6 : 1,
                    }}
                  >
                    <option value="">{t('Всі моделі')}</option>
                    {listings.map((l: any) => (
                      <option key={l.unit_id || l.id} value={l.unit_id || ''}>
                        {l.unit_name || l.unit_type_name || l.unit_id}
                        {l.unit_type_code ? ` (${l.unit_type_code})` : ''}
                      </option>
                    ))}
                  </select>
                  {loadingListings && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{t('⏳ Завантаження моделей...')}</div>
                  )}
                  {!loadingListings && listings.length === 0 && selectedSite && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{t('ℹ️ До цього сайту не прив\'язано жодної моделі')}</div>
                  )}
                </div>
            </>
          </div>

          {/* Right: Preview */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)' }}>
              {t('👁️ Попередній перегляд')}
            </h3>
            <iframe
              key={`${selectedSite}-${lang}-${color}`}
              srcDoc={previewSrc}
              style={{
                width: '100%', minHeight: 500, border: 'none', borderRadius: 12,
                background: '#f5f5f5',
              }}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </div>
      </div>
    </>
  );
}
