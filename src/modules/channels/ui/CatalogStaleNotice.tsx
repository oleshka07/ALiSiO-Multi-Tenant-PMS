'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';

/**
 * «Обʼєкт змінено — у каналі оновиться при наступній синхронізації», і дія.
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Шлях оновлення обʼєкта у вендора існує (`propertyDrift` → `updateProperty`),
 * але живе ВСЕРЕДИНІ синку каталогу, і ніщо не запускає його після того, як
 * готель змінив рід житла. Оператор міняє поле, яке вендор бере за ОСНОВУ
 * РАХУНКУ (готельна група — за обʼєкт, оренда — за юніт), бачить успішне
 * збереження — і у вендора лишається старий рід доти, доки хтось не зробить
 * синк з іншої причини (Р15.1).
 *
 * Мовчазна розбіжність, яка коштує грошей готелю. Тому вона названа на
 * екрані, і поруч є дія — а не інструкція «не забудьте синхронізувати».
 *
 * ── Чому рядок не висить завжди ─────────────────────────────────────────
 *
 * `stale` рахується локально: обʼєкт змінили ПІСЛЯ того, як каталог востаннє
 * поїхав. До першого синку розходитись нема з чим, і рядка немає — інакше
 * попередження висіло б у кожного готелю назавжди й перестало б щось
 * означати.
 *
 * ── Чому компонент модуля ───────────────────────────────────────────────
 *
 * Готель без каналів не має цього бачити. Сторінка малює його лише під
 * `features.channels`, а сам він живе в модулі, який його продає: ядро про
 * канали не знає (`check-boundaries --strict`, друга вісь).
 */
export function CatalogStaleNotice({ propertyId, reloadKey }: { propertyId: string; reloadKey?: number }) {
  const t = useT();
  const [stale, setStale] = useState(false);
  const [connections, setConnections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState('');

  const read = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/catalog-state?property_id=${encodeURIComponent(propertyId)}`);
      // Модуль вимкнено (409) або будь-яка інша відмова — мовчимо: це
      // підказка, а не функція, і червоніти на екрані обʼєкта їй нема чого.
      if (!res.ok) { setStale(false); return; }
      const data = await res.json();
      setStale(!!data.stale);
      setConnections(Array.isArray(data.connections) ? data.connections : []);
    } catch {
      setStale(false);
    }
  }, [propertyId]);

  useEffect(() => { setDone(false); setFailed(''); void read(); }, [read, reloadKey]);

  const syncNow = async () => {
    setBusy(true);
    setFailed('');
    try {
      for (const id of connections) {
        const res = await fetch(`/api/channels/connections/${encodeURIComponent(id)}/catalog`, { method: 'POST' });
        if (!res.ok) {
          // Названа відмова каталогу (рід житла не вказано, пояс порожній,
          // немає тарифу з валютою) доїжджає своїм текстом — `handleError`
          // на маршруті це вміє. Показуємо її, а не «щось пішло не так».
          const body = await res.json().catch(() => ({}));
          setFailed(String(body?.error || t('Не вдалося синхронізувати каталог')));
          setBusy(false);
          return;
        }
      }
      setDone(true);
      await read();
    } catch {
      setFailed(t('Не вдалося синхронізувати каталог'));
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <div className="form-hint" role="alert">{failed}</div>;
  if (done && !stale) return <div className="form-hint">{t('Каталог синхронізовано з каналом.')}</div>;
  if (!stale) return null;

  return (
    <div className="form-hint" role="status">
      {t('Обʼєкт змінено — у каналі це оновиться при наступній синхронізації каталогу.')}{' '}
      <button type="button" className="btn btn-link" onClick={syncNow} disabled={busy}>
        {busy ? t('Синхронізую…') : t('Синхронізувати зараз')}
      </button>
    </div>
  );
}
