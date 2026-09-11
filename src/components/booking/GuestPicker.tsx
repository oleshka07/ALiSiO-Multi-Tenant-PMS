'use client';
/**
 * Знайти гостя, який уже є, замість завести його вдруге.
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Форма броні збирала імʼя й прізвище текстом і віддавала серверу, а той
 * вгадував людину ланцюжком пошта → телефон → ТОЧНЕ ІМʼЯ. Для віджета й
 * каналу це правильно — там нікого не обирали. Для рецепції, яка бачить
 * гостя перед собою, — ні, і остання ланка каже чому: двоє «Іванів
 * Петренків» без пошти й телефону для дедупу одна людина.
 *
 * Тут людина БАЧИТЬ, кого бере: у рядку стоять пошта, телефон і країна —
 * рівно те, чим різняться однофамільці. Обраний гість їде на сервер
 * ідентифікатором (`guestId`), і той береться як названий.
 *
 * ── Чому не загальний пошук із шапки ────────────────────────────────────
 *
 * `GET /api/search` віддає `SearchHit` із `href` — він зроблений, щоб
 * ПЕРЕЙТИ на сторінку, і полів гостя не несе. Формі ж треба заповнити
 * пошту й телефон, тож вона питає `GET /api/guests?search=…`, який уже є
 * і вже під вартою сесії.
 *
 * ── Межа ────────────────────────────────────────────────────────────────
 *
 * Компонент нічого не зберігає. Він каже батьківській формі «ось цей» або
 * «я більше нікого не називаю» — рішення, що з цим робити, лишається там.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@core/i18n/client';
import { Search, X, UserPlus } from 'lucide-react';

export interface PickedGuest {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}

interface Props {
  /** Що набрано в полі прізвища — пошук іде за ним. */
  term: string;
  /** Кого вже обрали; `null` — нікого, показуємо підказки. */
  picked: PickedGuest | null;
  onPick: (g: PickedGuest) => void;
  onClear: () => void;
}

/** Стільки ж, скільки в загальному пошуку: більше за раз не читають. */
const LIMIT = 8;
/** Коротший рядок шукає пів бази і не звужує нічого. */
const MIN = 2;

export default function GuestPicker({ term, picked, onPick, onClear }: Props) {
  const t = useT();
  const [hits, setHits] = useState<PickedGuest[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Щоб пізня відповідь на старий рядок не перетерла свіжу: порядок
  // відповідей не гарантований, і без цього список стрибає назад.
  const seq = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (picked || q.length < MIN) { setHits([]); setOpen(false); return; }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/guests?search=${encodeURIComponent(q)}&limit=${LIMIT}`);
        if (!res.ok) { if (mine === seq.current) { setHits([]); setOpen(false); } return; }
        // Форма відповіді — `{ data, total, page, limit, totalPages }`,
        // виміряна в `guests.repo.listGuests`, а не вгадана: перша редакція
        // перебирала тут три можливі назви поля, і це рівно той спосіб, яким
        // клієнт мовчки лишається порожнім, коли жодна не вгадала.
        const body = await res.json() as { data?: PickedGuest[] };
        const rows: PickedGuest[] = Array.isArray(body.data) ? body.data : [];
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
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
        padding: '8px 10px', borderRadius: 'var(--radius-md)',
        background: 'var(--surface-elevated)', border: '1px solid var(--accent-primary)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {picked.last_name} {picked.first_name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {[picked.email, picked.phone].filter(Boolean).join(' · ') || t('без контактів')}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {t('гість із бази')}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}
            title={t('Відвʼязати і завести нового')}>
            <X size={12} />
          </button>
        </span>
      </div>
    );
  }

  if (!open) {
    return loading ? (
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{t('Шукаю…')}</div>
    ) : null;
  }

  return (
    <div style={{
      marginTop: 4, border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius-md)', background: 'var(--surface-elevated)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', fontSize: 11, color: 'var(--text-tertiary)',
        borderBottom: '1px solid var(--border-primary)',
      }}>
        <Search size={11} /> {t('Уже в базі — оберіть, щоб не заводити вдруге')}
      </div>
      {hits.map((g) => (
        <button key={g.id} type="button"
          onClick={() => { onPick(g); setOpen(false); }}
          style={{
            display: 'flex', width: '100%', gap: 8, alignItems: 'baseline',
            padding: '7px 10px', border: 0, background: 'transparent',
            cursor: 'pointer', textAlign: 'left',
          }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{g.last_name} {g.first_name}</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {/* Саме цим різняться однофамільці — без цього рядка вибір наосліп. */}
            {[g.email, g.phone, g.country].filter(Boolean).join(' · ') || t('без контактів')}
          </span>
        </button>
      ))}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', fontSize: 11, color: 'var(--text-tertiary)',
        borderTop: '1px solid var(--border-primary)',
      }}>
        <UserPlus size={11} /> {t('Нікого не обрали — заведемо нового')}
      </div>
    </div>
  );
}
