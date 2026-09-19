/**
 * Адреса, під якою цей сервер видно ЗВІДТИ, де стоїть гість.
 *
 * ── Чому окремий файл, а не `new URL(request.url).origin` ───────────────
 *
 * Бо саме так і було, і саме це надрукували на папері:
 *
 *     https://0.0.0.0:3000/stay/avstta7hamqxcpva
 *
 * Аркуш A4 із цією адресою в QR виглядає бездоганно, друкується бездоганно,
 * і не працює НІ В КОГО. `0.0.0.0` — це адреса, на якій процес СЛУХАЄ, а не
 * та, за якою до нього приходять: у прод-образі Next standalone слухає
 * `0.0.0.0:3000`, а назовні стоїть nginx із `beta.alisio.rozum.one`.
 * `request.url` каже про перше й мовчить про друге.
 *
 * Помилка тиха з обох боків: у розробника `request.url` — `localhost:3000`,
 * що для нього ПРАВДА, тож локально все виглядає правильно. Видно лише на
 * сервері й лише на папері, тобто після друку.
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * Адреса береться з НАЛАШТУВАННЯ (`APP_URL`, `core/app-url.ts`) або з того,
 * що сказав проксі (`x-forwarded-*`, `host`) — і НІКОЛИ з сокета, до якого
 * прив'язаний процес. Адреса прив'язки (`0.0.0.0`, `::`) відкидається
 * завжди: вона не є адресою нікого, і надрукувати її гірше, ніж відмовити.
 *
 * Немає нічого — `null`, і викликач відмовляє НАЗВАНИМИ словами (інваріант
 * 13: перевірка, яка не знайшла, відмовляє). Аркуш із вигаданою адресою це
 * пачка мертвого паперу на стійці — рівно те саме, що вигадана ціна в
 * інваріанті 17.
 *
 * `localhost` НЕ відкидається: у розробника він справді той, хто треба, і
 * заборона зробила б неможливим подивитись на аркуш у себе.
 */
import { appBaseUrl } from './app-url.ts';

/** Адреси, на яких процес слухає. До жодної з них ніхто не приходить. */
const BIND_ONLY = new Set(['0.0.0.0', '::', '[::]', '0', '']);

/** Мінімальний вигляд заголовків — щоб гейт міг покликати без `next/*`. */
export interface HeaderBag {
  get(name: string): string | null | undefined;
}

const firstOf = (raw: string | null | undefined): string =>
  (raw ?? '').split(',')[0]?.trim() ?? '';

/** `host[:port]` без адрес прив'язки; порожньо — не годиться. */
function usableHost(raw: string | null | undefined): string {
  const host = firstOf(raw);
  if (!host) return '';
  // Порт відрізаємо лише для ПЕРЕВІРКИ, повертаємо як прийшло: `:3131` у
  // беті значуще, і викинути його означало б послати гостя на порт 80.
  const bare = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return BIND_ONLY.has(bare) ? '' : host;
}

/**
 * Публічний origin або `null`.
 *
 * Порядок не випадковий:
 *
 *   1. `APP_URL` — єдина відповідь, яку хтось СВІДОМО дав. Вона ж їде у
 *      вебхуки каналу й у листи, тож аркуш не має права казати інше;
 *   2. `x-forwarded-proto` + `x-forwarded-host` — те, що бачив nginx;
 *   3. `host` — коли проксі немає (розробка, прямий доступ). Схема тоді
 *      вгадується з імені: `localhost` — http, решта — https.
 *
 * `request.url` не читається ВЗАГАЛІ, і це головне твердження файла.
 */
export function publicOrigin(headers: HeaderBag): string | null {
  const configured = appBaseUrl();
  if (configured) {
    // Налаштоване теж звіряємо: `APP_URL=http://0.0.0.0:3000` у env-файлі —
    // така сама мертва адреса, лише записана руками.
    try {
      const u = new URL(configured);
      if (usableHost(u.host)) return `${u.protocol}//${u.host}`;
    } catch { /* не адреса — пробуємо заголовки */ }
  }

  const fwdHost = usableHost(headers.get('x-forwarded-host'));
  if (fwdHost) {
    const proto = firstOf(headers.get('x-forwarded-proto')) || 'https';
    return `${proto}://${fwdHost}`;
  }

  const host = usableHost(headers.get('host'));
  if (host) {
    const local = /^(localhost|127\.0\.0\.1)(:|$)/i.test(host);
    return `${local ? 'http' : 'https'}://${host}`;
  }

  return null;
}
