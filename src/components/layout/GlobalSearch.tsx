'use client';

/**
 * Одне поле, з якого видно все: броні, гості, номери, фактури, екрани.
 *
 * Відкривається кнопкою в шапці або Ctrl+K / ⌘K. Кнопка лупи стояла на всіх
 * 77 екранах і не робила нічого — не `disabled`, просто без обробника, — тож
 * виглядала зламаною, а не «ще не готовою».
 *
 * ── Що шукається де ─────────────────────────────────────────────────────
 *
 * ДАНІ — на сервері. Спокуса фільтрувати вже завантажене велика: список
 * гостей і так є на екрані гостей. Але тоді пошук знаходить лише першу
 * сторінку і мовчки не знаходить решти; а права на дані мусять
 * перевірятись там, де дані лежать.
 *
 * ЕКРАНИ — тут. Каталог статичний, він і так у цьому бандлі, і `t()` є лише
 * на клієнті — а шукає людина своєю мовою.
 *
 * ── Затримка ────────────────────────────────────────────────────────────
 *
 * 250 мс після останньої натиснутої клавіші — і кожен новий запит скасовує
 * попередній. Без скасування відповіді приходять у довільному порядку, і
 * список показує результат передостаннього слова: людина дописує запит, а
 * бачить менш точну відповідь, ніж секунду тому.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@core/i18n/client';
import { Search, X, Loader2, CornerDownLeft } from 'lucide-react';
import { SEARCH_MIN_LENGTH, SEARCH_LIMIT } from '@core/search-types';
import { DESTINATIONS } from '@core/navigation';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { hasPermission } from '@core/auth/permissions';

interface Hit { id: string; title: string; subtitle?: string; href: string }
interface Group { key: string; label: string; items: Hit[] }

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { user, features } = useCurrentUser();
  const [term, setTerm] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Екрани — тут, а не на сервері, і по ПЕРЕКЛАДЕНИХ словах.
   *
   * Каталог статичний і лежить у цьому ж бандлі, тож запит до сервера дав би
   * лише затримку. Головне інше: `t()` є лише на клієнті, а шукає людина
   * своєю мовою — чеський адміністратор набирає «DPH», а не «ПДВ».
   *
   * Права беруться з `useCurrentUser` — того самого джерела, яким бічне меню
   * вирішує, що показати. Це не «перевірка безпеки»: дані екранів на сервері,
   * і кожен із них має власну варту. Тут ідеться лише про те, щоб не
   * пропонувати перехід, який закінчиться 403.
   */
  const screens = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (q.length < SEARCH_MIN_LENGTH) return [];
    return DESTINATIONS
      .filter((d) => !user || hasPermission(user.permissions, d.permission))
      .filter((d) => !d.feature || features[d.feature])
      .filter((d) => {
        const haystack = [t(d.label), t(d.section), ...(d.keywords ?? []).map((k) => t(k))];
        return haystack.some((h) => h.toLowerCase().includes(q));
      })
      .slice(0, SEARCH_LIMIT)
      .map((d) => ({ id: d.href, title: t(d.label), subtitle: t(d.section), href: d.href }));
  }, [term, user, features, t]);

  // Екрани попереду: людина, яка шукає «ПДВ», хоче сторінку налаштувань, а не
  // фактуру, у назві платника якої трапилися ті самі літери.
  const allGroups = useMemo<Group[]>(
    () => (screens.length ? [{ key: 'screens', label: 'Екрани', items: screens }, ...groups] : groups),
    [screens, groups],
  );

  // Один плаский список — щоб стрілки ходили крізь розділи, а не всередині.
  const flat = useMemo(() => allGroups.flatMap((g) => g.items), [allGroups]);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setGroups([]);
    setCursor(0);
    // Фокус після того, як діалог справді на екрані: focus() на щойно
    // змонтованому елементі в частині браузерів не спрацьовує.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length < SEARCH_MIN_LENGTH) {
      abortRef.current?.abort();
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { groups: [] }))
        .then((data) => { setGroups(data.groups || []); setCursor(0); })
        .catch((e) => { if (e?.name !== 'AbortError') setGroups([]); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [term, open]);

  const go = useCallback((hit: Hit) => {
    onClose();
    router.push(hit.href);
  }, [onClose, router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); go(flat[cursor]); }
  };

  if (!open) return null;

  const short = term.trim().length > 0 && term.trim().length < SEARCH_MIN_LENGTH;
  let index = -1;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 18, 24, .55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '10vh 16px 16px',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('Пошук')}
    >
      <div
        onKeyDown={onKeyDown}
        style={{
          width: '100%', maxWidth: 640, background: 'var(--bg-elevated, #fff)',
          borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.28)',
          border: '1px solid var(--border, rgba(0,0,0,.08))',
          display: 'flex', flexDirection: 'column', maxHeight: '70vh', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,.08))',
        }}>
          {loading
            ? <Loader2 size={18} className="animate-pulse" style={{ color: 'var(--text-tertiary)' }} />
            : <Search size={18} style={{ color: 'var(--text-tertiary)' }} />}
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('Гість, бронь, номер, фактура, екран…')}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 16, color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={onClose}
            aria-label={t('Закрити')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {short && (
            <div style={{ padding: '18px 16px', color: 'var(--text-tertiary)', fontSize: 14 }}>
              {t('Введіть щонайменше два символи.')}
            </div>
          )}

          {!short && !loading && term.trim().length >= SEARCH_MIN_LENGTH && flat.length === 0 && (
            <div style={{ padding: '18px 16px', color: 'var(--text-tertiary)', fontSize: 14 }}>
              {t('Нічого не знайдено.')}
            </div>
          )}

          {!term.trim() && (
            <div style={{ padding: '18px 16px', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1.7 }}>
              {t('Шукає гостей, броні, номери, фактури й екрани застосунку.')}
              <br />
              {t('Показується лише те, до чого ви маєте доступ.')}
            </div>
          )}

          {allGroups.map((g) => (
            <div key={g.key}>
              <div style={{
                padding: '10px 16px 4px', fontSize: 11, textTransform: 'uppercase',
                letterSpacing: '.06em', color: 'var(--text-tertiary)', fontWeight: 600,
              }}>
                {t(g.label)}
              </div>
              {g.items.map((hit) => {
                index += 1;
                const active = index === cursor;
                const at = index;
                return (
                  <button
                    key={`${g.key}:${hit.id}`}
                    onMouseEnter={() => setCursor(at)}
                    onClick={() => go(hit)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                      padding: '9px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: active ? 'var(--bg-hover, rgba(0,0,0,.05))' : 'transparent',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 14, color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{hit.title}</div>
                      {hit.subtitle && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{hit.subtitle}</div>
                      )}
                    </div>
                    {active && <CornerDownLeft size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
