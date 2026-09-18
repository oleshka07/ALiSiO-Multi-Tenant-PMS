'use client';

/**
 * Вигляд обʼєкта: кольори і зображення за ролями.
 *
 * ── Чому саме тут, а не на екрані гостьової сторінки ────────────────────
 *
 * Палітра й лого жили в Налаштування → Гостьова сторінка (0419, КІ37) — бо
 * там вони вперше знадобились. Але це ДАНІ ОБʼЄКТА, а не налаштування однієї
 * поверхні: те саме лого бере гостьовий застосунок із наліпки, аркуш A4,
 * і візьме кожен наступний екран. Тримати їх у налаштуваннях однієї сторінки
 * означало б, що оператор шукає лого готелю в розділі, який до лого не має
 * стосунку.
 *
 * ── Ролі, а не галерея ──────────────────────────────────────────────────
 *
 * Кожне зображення має ІМʼЯ (`core/brand-assets.ts`), і кожне імʼя називає
 * свого читача. Це не формальність: типізовані фото обʼєкта тут уже робили
 * (`property_photos.photo_type`) і знесли як мертві — писач був, читача не
 * було жодного. Роль без читача тепер валить гейт.
 */
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { BRAND_PALETTES } from '@core/brand-palettes';
import { ImageUploadField } from '@/components/ui/ImageUploadField';

/**
 * Підписи ролей і палітр — на ЕКРАНІ, бо звідси їх бере `extract-strings`.
 * Копія в реєстрі дала б другий рядок, який у каталог не потрапляє: німецький
 * адміністратор бачив би українське слово при 100 % покриття (§3.2.1, шостий
 * випадок).
 */
const PALETTE_NAMES: Record<string, string> = {
  sand_brass: 'Пісок і латунь',
  teal_warm_grey: 'Бірюза і теплий сірий',
  forest_stone: 'Ліс і камінь',
  ink_amber: 'Чорнило і бурштин',
};

const ROLE_NAMES: Record<string, { title: string; help: string }> = {
  logo: {
    title: 'Лого',
    help: 'Знак готелю. Його бачить гість у застосунку й на аркуші A4. Немає — показуємо назву текстом.',
  },
  logo_light: {
    title: 'Лого для темного тла',
    help: 'Потрібне, лише якщо обрано темну палітру: темний знак на темній шапці зникає. Порожньо — беремо основне.',
  },
  cover: {
    title: 'Обкладинка',
    help: 'Фасад або загальний вигляд. Іде на аркуш A4 і робить його впізнаваним іздалеку.',
  },
};

export function PropertyBrandCard({ propertyId, palette, onPalette, busy }: {
  propertyId: string;
  palette: string;
  onPalette: (key: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/properties/${propertyId}/brand-assets`);
      if (!res.ok) return;
      const body = await res.json() as { assets?: Record<string, string>; roles?: string[] };
      setAssets(body.assets ?? {});
      setRoles(body.roles ?? []);
    } catch { /* мережа впала — картка лишається порожньою, і це видно */ }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  async function save(role: string, url: string) {
    setMessage(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/brand-assets`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, url }),
      });
      // Відповідь ЧИТАЄТЬСЯ: маршрут віддає названу відмову на чужу адресу
      // (`http://`) і на невідому роль, а екран, який не подивиться в тіло,
      // однаково показав би успіх (`check-unread-write-response`).
      const body = await res.json().catch(() => ({})) as { error?: string; assets?: Record<string, string> };
      if (!res.ok) { setMessage(body.error ?? t('Не вдалося зберегти')); return; }
      setAssets(body.assets ?? {});
    } catch {
      setMessage(t('Не вдалося зберегти'));
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ marginBottom: 4, fontWeight: 700, fontSize: 15 }}>{t('Вигляд обʼєкта')}</div>
      <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
        {t('Кольори й зображення бачить гість: на гостьовій сторінці, у застосунку з наліпки та на аркуші A4 для друку.')}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {BRAND_PALETTES.map((pal) => (
          <button key={pal.key} type="button" disabled={busy}
            className={`btn btn-sm ${palette === pal.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onPalette(pal.key)}>
            {t(PALETTE_NAMES[pal.key] ?? pal.key)}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {roles.map((role) => (
          <div key={role}>
            <ImageUploadField
              label={t(ROLE_NAMES[role]?.title ?? role)}
              value={assets[role] ?? ''}
              onChange={(url) => { void save(role, url); }}
              folder="brand"
              aspectRatio={role === 'cover' ? '16/9' : '3/1'}
              placeholder={t('https://… або завантажте файл')}
            />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {t(ROLE_NAMES[role]?.help ?? '')}
            </div>
          </div>
        ))}
      </div>

      {message && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{message}</div>}
    </div>
  );
}
