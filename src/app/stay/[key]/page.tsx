/**
 * Гостьова сторінка: те, що відкривається з QR на склі.
 *
 * СЕРВЕРНИЙ компонент, і це не деталь реалізації. Дві речі мусять статись до
 * першого малювання:
 *
 *   1. орендар — з ключа в адресі (`propertyByAppKey`), бо сесії тут немає за
 *      визначенням і вгадувати його не можна (інваріант 8);
 *   2. мова — з `Accept-Language` телефона (КІ20), бо `navigator.language`
 *      доступний лише після гідратації, і англієць побачив би спалах
 *      німецької на екрані, який і є весь екран.
 *
 * Ключа немає або він нічого не відчиняє — 404, не «оберіть готель» і не
 * порожня сторінка: чужий чи вигаданий ключ не відрізняється від відсутнього
 * (інваріант 5).
 */
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { propertyByAppKey } from '@/apps/guest-app/data/property.repo';
import { readGuestAppKey } from '@/apps/guest-app/domain/key';
import { GuestHome } from '@/apps/guest-app/ui/GuestHome';
import { languageFromHeader } from '@/apps/guest-app/ui/translations';
import '../guest-app.css';

export const dynamic = 'force-dynamic';

export default async function StayPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  // Форма перевіряється ДО запиту: сегмент адреси приходить від будь-кого з
  // інтернету, і рядок, який не може бути ключем, не стає умовою запиту.
  const key = readGuestAppKey(raw);
  if (!key) notFound();

  const home = await propertyByAppKey(key);
  if (!home) notFound();

  const lang = languageFromHeader((await headers()).get('accept-language'));

  return <GuestHome propertyName={home.propertyName} initialLang={lang} />;
}
