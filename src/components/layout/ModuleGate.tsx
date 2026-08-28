'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@core/i18n/client';
import { PowerOff } from 'lucide-react';
import { destinationForPath } from '@core/navigation';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';

/**
 * Екран вимкненого модуля не відкривається.
 *
 * ── Чого бракувало ──────────────────────────────────────────────────────
 *
 * Ключ модуля перевіряли дві речі: меню (ховало пункт) і маршрути API
 * (`withModule` відмовляв 403). Самі СТОРІНКИ не перевіряв ніхто.
 *
 * Тому готель, який вимкнув «Задачі персоналу», відкривши `/app/tasks` —
 * із закладки, з історії браузера, з пошуку Ctrl+K або просто набравши
 * адресу — бачив нормальний екран розділу. Дані на ньому не з'являлись, бо
 * API чесно відмовляв, але людині це виглядало як «розділ є, просто
 * порожній» або «щось зламалось». Вимкнений модуль має сказати, що він
 * вимкнений.
 *
 * Витоку тут не було: без даних екран нічого не показує. Була неправда —
 * інтерфейс стверджував, що розділ працює.
 *
 * ── Звідки береться відповідність «екран → ключ» ────────────────────────
 *
 * З `core/navigation.ts` — того самого каталогу, яким живуть пошук Ctrl+K і
 * меню акаунта, через `destinationForPath()`. Другий список тут означав би
 * два списки, які розійдуться: додав розділ у меню, забув у заслінці — і
 * вимкнений модуль знову відкривається.
 *
 * Це заслінка, а не варта. Справжня відмова — на маршрутах (`withModule`),
 * і вона лишається єдиним, що тримає дані. Тут виправляється неправда
 * інтерфейсу, не доступ.
 */
export default function ModuleGate({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname() || '';
  const { user, features, loading } = useCurrentUser();

  // Поки `/api/auth/me` не відповів — НЕ показуємо ні екран, ні табличку.
  //
  // Пропускати дітей на цей час здається безпечнішим, і це помилка: екран
  // вимкненого модуля встигає змонтуватись, його запити отримують 403, і
  // сторінка падає раніше, ніж заслінка встигає вирішити. Саме так
  // `/app/finance` при вимкненому обліку показував «This page couldn't load»
  // (`Cannot read properties of undefined (reading 'map')`) замість «модуль
  // вимкнено» — падіння виграло перегони в однієї відповіді мережі.
  //
  // Показувати табличку теж не можна: тоді нею мигав би КОЖЕН екран. Тому
  // мовчання — доти, доки відповідь не прийде.
  //
  // Це не сповільнення: `ModuleGate` живе в layout, тобто монтується раз на
  // повне завантаження сторінки, а не на кожен перехід. Бічне меню чекає на
  // ту саму відповідь, тож оболонка й так неповна.
  if (loading) return null;

  // Відповідь прийшла, сесії немає — оболонка веде на вхід сама; судити тут
  // нема про що.
  if (!user) return <>{children}</>;

  const match = destinationForPath(pathname);

  // Той самий предикат, що ховає пункт меню (`visibleDestinations`): ключ,
  // якого сервер не назвав, вважається вимкненим. Інваріант 13 — перевірка,
  // яка не знайшла рядка, відмовляє, а не дозволяє.
  if (!match?.feature || features[match.feature]) return <>{children}</>;

  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 460, textAlign: 'center', background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-lg, 12px)',
        padding: '32px 28px',
      }}>
        <PowerOff size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 14 }} />
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
          {t('Модуль вимкнено')} — {t(match.label)}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
          {t('Цей розділ вимкнено для вашого готелю, тому він не відкривається. Дані нікуди не зникли — вони повернуться, щойно модуль увімкнуть.')}
        </div>
        <Link href="/app/settings/features" className="btn btn-primary btn-sm">
          {t('Модулі та інтеграції')}
        </Link>
      </div>
    </div>
  );
}
