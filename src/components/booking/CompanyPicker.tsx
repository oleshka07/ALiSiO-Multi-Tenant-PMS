'use client';
/**
 * Фірма-платник у формі створення броні.
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Платника-юрособу можна було поставити лише ПІСЛЯ створення, з картки
 * броні. Тобто портьє, який уже знає, що платить фірма, заводив бронь на
 * гостя й мусив згадати вернутись. Забув — фактура пішла на фізособу, і
 * помітили це на бухгалтерії.
 *
 * ── Чому пошук, а не список ─────────────────────────────────────────────
 *
 * `PayerPicker` на картці тягне ВЕСЬ довідник у `<select>` — це працює, поки
 * фірм десяток. Тут пошук із самого початку: `GET /api/companies?search=…`
 * уже є, вже під вартою сесії і вже звужений орендарем.
 *
 * Форма відповіді — `{ rows }`, виміряна в `companies.handlers.listCompanies`,
 * а не вгадана: клієнт, що перебирає три можливі назви поля, мовчки лишається
 * порожнім, коли жодна не вгадала.
 *
 * ── Межа ────────────────────────────────────────────────────────────────
 *
 * Компонент нічого не зберігає і нічого не створює. Він каже формі «ось ця
 * фірма» або «жодної»; сервер усе одно звіряє id з довідником СВОГО готелю
 * (`bookingPayerFields` — чужа 404, архівна 409).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@core/i18n/client';
import { Building2, Search, X } from 'lucide-react';

export interface PickedCompany {
  id: string;
  name: string;
  business_id?: string | null;
  address_city?: string | null;
}

interface Props {
  picked: PickedCompany | null;
  onPick: (c: PickedCompany | null) => void;
}

/** Стільки ж, скільки в пошуку гостя: більше за раз не читають. */
const LIMIT = 8;
/** Коротший рядок не звужує нічого. */
const MIN = 2;

export default function CompanyPicker({ picked, onPick }: Props) {
  const t = useT();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<PickedCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Пізня відповідь на старий рядок не має перетирати свіжу.
  const seq = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (picked || q.length < MIN) { setHits([]); setOpen(false); return; }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies?search=${encodeURIComponent(q)}`);
        if (!res.ok) { if (mine === seq.current) { setHits([]); setOpen(false); } return; }
        const body = await res.json() as { rows?: PickedCompany[] };
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (mine !== seq.current) return;
        setHits(rows.slice(0, LIMIT));
        setOpen(rows.length > 0);
      } catch { if (mine === seq.current) { setHits([]); setOpen(false); } }
      finally { if (mine === seq.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [term, picked]);

  if (picked) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderRadius: 'var(--radius-md)',
        background: 'var(--surface-elevated)', border: '1px solid var(--accent-primary)',
      }}>
        <Building2 size={14} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{picked.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {[picked.business_id, picked.address_city].filter(Boolean).join(' · ')}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {t('документ піде на фірму')}
          <button type="button" className="btn btn-sm btn-ghost"
            onClick={() => { onPick(null); setTerm(''); }} title={t('Платить гість')}>
            <X size={12} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <Search size={13} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--text-tertiary)' }} />
      <input className="form-input" style={{ paddingLeft: 28 }}
        value={term} onChange={(e) => setTerm(e.target.value)}
        placeholder={t('Назва фірми або ID — порожньо, якщо платить гість')} />
      {loading && !open && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{t('Шукаю…')}</div>
      )}
      {open && (
        <div style={{
          marginTop: 4, border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-md)', background: 'var(--surface-elevated)', overflow: 'hidden',
        }}>
          {hits.map((c) => (
            <button key={c.id} type="button"
              onClick={() => { onPick(c); setOpen(false); }}
              style={{
                display: 'flex', width: '100%', gap: 8, alignItems: 'baseline',
                padding: '7px 10px', border: 0, background: 'transparent',
                cursor: 'pointer', textAlign: 'left',
              }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {/* Саме цим різняться однойменні фірми. */}
                {[c.business_id, c.address_city].filter(Boolean).join(' · ') || t('без реквізитів')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
