'use client';

import React, { useState, useEffect } from 'react';
import { formatPrice, type PriceItem } from '../lib/pricing';

const TRANSLATIONS: Record<string, Record<string, string>> = {
  cs: {
    title: 'Ceník', glamping: 'Glamping', buildings: 'Budovy', camping: 'Kemp',
    standard: 'Standard', holiday: 'Svátek / Víkend', sideSeason: 'Vedlejší sezóna',
    perNight: '/ noc', perBed: '/ lůžko / noc', perRoom: '/ pokoj / noc', perPerson: '/ osoba / noc',
    perAnimal: '/ zvíře / noc', perAdult: '/ dospělý / noc', once: 'jednorázově', close: 'Zavřít',
  },
  en: {
    title: 'Price List', glamping: 'Glamping', buildings: 'Buildings', camping: 'Camping',
    standard: 'Standard', holiday: 'Holiday / Weekend', sideSeason: 'Side season',
    perNight: '/ night', perBed: '/ bed / night', perRoom: '/ room / night', perPerson: '/ person / night',
    perAnimal: '/ animal / night', perAdult: '/ adult / night', once: 'once', close: 'Close',
  },
  de: {
    title: 'Preisliste', glamping: 'Glamping', buildings: 'Gebäude', camping: 'Camping',
    standard: 'Standard', holiday: 'Feiertag / Wochenende', sideSeason: 'Nebensaison',
    perNight: '/ Nacht', perBed: '/ Bett / Nacht', perRoom: '/ Zimmer / Nacht', perPerson: '/ Person / Nacht',
    perAnimal: '/ Tier / Nacht', perAdult: '/ Erwachsener / Nacht', once: 'einmalig', close: 'Schließen',
  },
  uk: {
    title: 'Прайс-лист', glamping: 'Глемпінг', buildings: 'Будівлі', camping: 'Кемпінг',
    standard: 'Стандарт', holiday: 'Свято / Вихідні', sideSeason: 'Несезон',
    perNight: '/ ніч', perBed: '/ ліжко / ніч', perRoom: '/ кімната / ніч', perPerson: '/ особа / ніч',
    perAnimal: '/ тварина / ніч', perAdult: '/ дорослий / ніч', once: 'одноразово', close: 'Закрити',
  },
};

// Item name translations by item_code
const ITEM_NAMES: Record<string, Record<string, string>> = {
  tiny_house:             { cs: 'Tiny House',                    en: 'Tiny House',                    de: 'Tiny House',                      uk: 'Tiny House' },
  barn_house:             { cs: 'Barn House',                    en: 'Barn House',                    de: 'Barn House',                      uk: 'Barn House' },
  budova_d_bed_1night:    { cs: 'Budova D — 1 noc / lůžko',     en: 'Building D — 1 night / bed',    de: 'Gebäude D — 1 Nacht / Bett',     uk: 'Будова D — 1 ніч / ліжко' },
  budova_d_bed_2plus:     { cs: 'Budova D — 2+ nocí / lůžko',   en: 'Building D — 2+ nights / bed',  de: 'Gebäude D — 2+ Nächte / Bett',   uk: 'Будова D — 2+ ночі / ліжко' },
  budova_d_room:          { cs: 'Budova D — pokoj',              en: 'Building D — Room',             de: 'Gebäude D — Zimmer',              uk: 'Будова D — Кімната' },
  budova_f_bed_1night:    { cs: 'Budova F — 1 noc / lůžko',     en: 'Building F — 1 night / bed',    de: 'Gebäude F — 1 Nacht / Bett',     uk: 'Будова F — 1 ніч / ліжко' },
  budova_f_bed_2plus:     { cs: 'Budova F — 2+ nocí / lůžko',   en: 'Building F — 2+ nights / bed',  de: 'Gebäude F — 2+ Nächte / Bett',   uk: 'Будова F — 2+ ночі / ліжко' },
  budova_f_room:          { cs: 'Budova F — pokoj',              en: 'Building F — Room',             de: 'Gebäude F — Zimmer',              uk: 'Будова F — Кімната' },
  small_tent:             { cs: 'Malý stan (do 3×3m)',           en: 'Small tent (up to 3×3m)',       de: 'Kleines Zelt (bis 3×3m)',         uk: 'Малий намет (до 3×3м)' },
  large_tent:             { cs: 'Velký stan (nad 3×3m)',         en: 'Large tent (over 3×3m)',        de: 'Großes Zelt (über 3×3m)',         uk: 'Великий намет (понад 3×3м)' },
  car:                    { cs: 'Auto',                          en: 'Car',                           de: 'Auto',                            uk: 'Автомобіль' },
  minibus:                { cs: 'Minibus / Van',                 en: 'Minibus / Van',                 de: 'Minibus / Van',                   uk: 'Мінібус / Ван' },
  caravan:                { cs: 'Karavan',                       en: 'Caravan',                       de: 'Wohnwagen',                       uk: 'Караван' },
  motorhome:              { cs: 'Obytný vůz',                   en: 'Motorhome',                     de: 'Wohnmobil',                       uk: 'Будинок на колесах' },
  motorcycle:             { cs: 'Motorka',                       en: 'Motorcycle',                    de: 'Motorrad',                        uk: 'Мотоцикл' },
  adult_person:           { cs: 'Dospělý',                      en: 'Adult',                         de: 'Erwachsener',                     uk: 'Дорослий' },
  child_person:           { cs: 'Dítě (3-15)',                   en: 'Child (3-15)',                  de: 'Kind (3-15)',                     uk: 'Дитина (3-15)' },
  electricity:            { cs: 'Elektřina',                     en: 'Electricity hookup',            de: 'Stromanschluss',                  uk: 'Електрика' },
  pet:                    { cs: 'Domácí mazlíček',               en: 'Pet',                           de: 'Haustier',                        uk: 'Домашня тварина' },
  motorhome_service:      { cs: 'Servis obytného vozu',          en: 'Motorhome cassette service',    de: 'Wohnmobil-Kassettenservice',      uk: 'Сервіс автодому' },
  tourist_tax:            { cs: 'Turistický poplatek',           en: 'Tourist tax',                   de: 'Kurtaxe',                         uk: 'Туристичний збір' },
};

const LANG_FLAGS: Record<string, string> = { cs: '🇨🇿', en: '🇬🇧', de: '🇩🇪', uk: '🇺🇦' };

interface Props {
  open: boolean;
  onClose: () => void;
  prices: PriceItem[];
}

export default function PriceListPopup({ open, onClose, prices }: Props) {
  const [lang, setLang] = useState('en');
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

  // Prevent body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const categories = [
    { key: 'glamping', label: t.glamping, emoji: '🏕️' },
    { key: 'buildings', label: t.buildings, emoji: '🏠' },
    { key: 'camping', label: t.camping, emoji: '⛺' },
  ];

  const getUnitLabel = (ul: string) => {
    if (ul.includes('bed')) return t.perBed;
    if (ul.includes('room')) return t.perRoom;
    if (ul.includes('person')) return t.perPerson;
    if (ul.includes('animal')) return t.perAnimal;
    if (ul.includes('adult')) return t.perAdult;
    if (ul === 'once') return t.once;
    return t.perNight;
  };

  const getItemName = (item: PriceItem) => {
    return ITEM_NAMES[item.item_code]?.[lang] || item.item_name;
  };

  return (
    <div className="kc-popup-overlay" onClick={onClose}>
      <div className="kc-popup-sheet" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="kc-popup-header">
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>📋 {t.title}</h2>
          <button className="kc-popup-close" onClick={onClose} type="button">✕</button>
        </div>

        {/* Language selector */}
        <div style={{ display: 'flex', gap: 6, padding: '0 20px 12px', justifyContent: 'center' }}>
          {Object.keys(TRANSLATIONS).map(l => (
            <button key={l} type="button"
              onClick={() => setLang(l)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: lang === l ? 700 : 400,
                background: lang === l ? 'var(--kc-green)' : 'var(--kc-card-bg)',
                color: lang === l ? '#fff' : 'var(--kc-text-primary)',
              }}>
              {LANG_FLAGS[l]} {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Price tables */}
        <div style={{ padding: '0 16px 24px', overflowY: 'auto', flex: 1 }}>
          {categories.map(cat => {
            const items = prices.filter(p => p.category === cat.key && p.is_active);
            if (items.length === 0) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {cat.emoji} {cat.label}
                </div>

                <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--kc-border)' }}>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', padding: '8px 12px', background: 'var(--kc-green)', color: '#fff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <div></div>
                    <div style={{ textAlign: 'right' }}>{t.standard}</div>
                    <div style={{ textAlign: 'right' }}>{t.holiday}</div>
                    <div style={{ textAlign: 'right' }}>{t.sideSeason}</div>
                  </div>
                  {items.map((item, idx) => (
                    <div key={item.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px',
                      padding: '10px 12px', fontSize: 13, alignItems: 'center',
                      background: idx % 2 === 0 ? 'var(--kc-card-bg)' : 'var(--kc-bg)',
                      borderTop: idx > 0 ? '1px solid var(--kc-border)' : 'none',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{getItemName(item)}</div>
                        <div style={{ fontSize: 11, color: 'var(--kc-text-muted)' }}>{getUnitLabel(item.unit_label)}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontWeight: 700 }}>{formatPrice(item.rate_standard)}</div>
                      <div style={{ textAlign: 'right', color: item.rate_holiday != null ? '#e67e22' : 'var(--kc-text-muted)' }}>
                        {item.rate_holiday != null ? formatPrice(item.rate_holiday) : '—'}
                      </div>
                      <div style={{ textAlign: 'right', color: item.rate_side_season != null ? 'var(--kc-text-secondary)' : 'var(--kc-text-muted)' }}>
                        {item.rate_side_season != null ? formatPrice(item.rate_side_season) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div style={{ fontSize: 12, color: 'var(--kc-text-muted)', textAlign: 'center', marginTop: 12 }}>
            Kemp Carlsbad s.r.o. · CZK (Kč)
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--kc-border)' }}>
          <button className="kc-btn kc-btn-secondary" onClick={onClose} type="button" style={{ width: '100%' }}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}
