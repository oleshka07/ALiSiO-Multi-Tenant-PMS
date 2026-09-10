'use client';

/**
 * Дублікати гостя: подивитись пару, обрати кого лишити, або сказати «різні».
 *
 * ── Чому екран, а не лише двері ─────────────────────────────────────────
 *
 * Шукач кандидатів (INC-303) зроблений для імпорту, тобто для коду. Але
 * дублікати робить портьє щодня, і без екрана жоден живий користувач їх не
 * бачить — а отже вони й не зникають.
 *
 * ── Три рішення, які видно просто на екрані ─────────────────────────────
 *
 * 1. Кожна пара показує ПРИЧИНУ збігу словами («той самий документ»), а не
 *    «схоже»: людина мусить бачити, ЧОМУ їх зіставили, інакше вона не може
 *    перевірити висновок.
 * 2. Кого лишаємо — обирає людина, обидві кнопки рівноправні. «Лишаємо
 *    старшого» здається очевидним і неправильне: у старшого може не бути
 *    документа, а в молодшого — бути.
 * 3. Перед злиттям показано, ЩО САМЕ переїде. Дія незворотна, тож число
 *    показується до натискання, а не в повідомленні після.
 */
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/State';
import { Users, ArrowRight, UserX, Loader2, ShieldCheck } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Side {
  id: string; first_name: string; last_name: string;
  email: string | null; phone: string | null;
  document_type: string | null; document_number: string | null;
  date_of_birth: string | null; total_stays?: number;
}
interface Pair { keepId: string; dropId: string; tier: string; says: string; left: Side; right: Side; }

export default function GuestDuplicatesPage() {
  const t = useT();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, Record<string, number>>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/guests/duplicates');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || t('Не вдалося завантажити дублікати'));
      setPairs(body.pairs || []);
    } catch (e: any) {
      setError(e?.message || t('Не вдалося завантажити дублікати'));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const key = (p: Pair) => `${p.keepId}|${p.dropId}`;

  /** Перегляд ПЕРЕД дією: скільки рядків переїде, якщо лишити саме цього. */
  const askPreview = useCallback(async (p: Pair, keepId: string) => {
    const dropId = keepId === p.keepId ? p.dropId : p.keepId;
    const res = await fetch('/api/guests/duplicates/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId, dropId }),
    });
    const body = await res.json();
    if (res.ok) setPreview((prev) => ({ ...prev, [`${key(p)}|${keepId}`]: body.moves || {} }));
  }, []);

  const decide = useCallback(async (p: Pair, decision: 'same' | 'different', keepId?: string) => {
    setBusy(key(p));
    try {
      const keep = keepId ?? p.keepId;
      const drop = keep === p.keepId ? p.dropId : p.keepId;
      const res = await fetch('/api/guests/duplicates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, keepId: keep, dropId: drop }),
      });
      // Відповідь ЧИТАЄТЬСЯ: без цього екран однаково казав би «зроблено» і на
      // 200, і на названу відмову (check-unread-write-response).
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || t('Не вдалося зберегти рішення'));
      await load();
    } catch (e: any) {
      setError(e?.message || t('Не вдалося зберегти рішення'));
    } finally { setBusy(null); }
  }, [load, t]);

  const movesText = (moves: Record<string, number> | undefined) => {
    if (!moves) return null;
    const total = Object.values(moves).reduce((a, b) => a + b, 0);
    return t('Переїде рядків: {n}').replace('{n}', String(total));
  };

  const card = (side: Side) => (
    <div className="rounded-lg border border-gray-200 p-3 text-sm">
      <div className="font-medium">{side.last_name} {side.first_name}</div>
      {side.email && <div className="text-gray-500">{side.email}</div>}
      {side.phone && <div className="text-gray-500">{side.phone}</div>}
      {side.document_number && (
        <div className="text-gray-500">{side.document_type} {side.document_number}</div>
      )}
      {side.date_of_birth && <div className="text-gray-500">{side.date_of_birth}</div>}
    </div>
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState detail={error} retry={load} />;
  if (pairs.length === 0) {
    return <EmptyState icon={<ShieldCheck size={22} />} title={t('Дублікатів не знайдено')} hint={t('Схожих карток гостей зараз немає. Пари, які ви назвали різними людьми, більше не показуються.')} />;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <Users className="w-5 h-5" /> {t('Схожі гості')}
      </h1>
      <p className="text-sm text-gray-600">{t('Пари, які схожі на одну людину. Оберіть, кого лишити, — решта записів переїде на нього. Дію не скасувати.')}</p>

      {pairs.map((p) => (
        <div key={key(p)} className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="text-sm font-medium text-amber-700">{p.says}</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[p.left, p.right].map((side) => (
              <div key={side.id} className="space-y-2">
                {card(side)}
                <button
                  type="button"
                  disabled={busy === key(p)}
                  onMouseEnter={() => askPreview(p, side.id)}
                  onClick={() => decide(p, 'same', side.id)}
                  className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy === key(p) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {t('Лишити цього')}
                </button>
                <div className="h-4 text-xs text-gray-500">
                  {movesText(preview[`${key(p)}|${side.id}`])}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={busy === key(p)}
            onClick={() => decide(p, 'different')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm flex items-center justify-center gap-2"
          >
            <UserX className="w-4 h-4" /> {t('Це різні люди')}
          </button>
        </div>
      ))}
    </div>
  );
}
