/**
 * Ключ вендора з оточення — або людська відмова.
 *
 *   import { requireVendorKey } from './lib/vendor-key.mjs';
 *   const apiKey = requireVendorKey('CHANNEX_API_KEY');
 *
 * ── Навіщо окремий файл заради двох рядків ──────────────────────────────
 *
 * Ключ їде в заголовок HTTP, а заголовок мусить бути ByteString: кожен код
 * ≤ 0xFF, без керівних символів. Значення з кирилицею чи з переносом рядка
 * (класика: `CHANNEX_API_KEY=$(cat key.txt)`) вбиває виклик усередині undici —
 * «Cannot convert argument to a ByteString», стеком із чужих нутрощів, за
 * десяток кадрів від причини. Оператор бачить падіння клієнта і не бачить,
 * що зіпсоване саме оточення (знайдено живим проходом 07.09, Ж2).
 *
 * Перевіряють це ПʼЯТЬ живих скриптів однаково, тож і відмова одна: інакше
 * наступний скрипт скопіює `if (!apiKey)` без другої половини — рівно так
 * клас і повторюється (див. `scripts/check-entry-imports.mjs`, чотири випадки
 * за добу).
 *
 * Саме пʼять, поіменно: `channex-ari-live`, `-catalog-`, `-full-sync-`,
 * `-mappings-`, `-stop-sell-`. Живих скриптів вісім, але `connect`,
 * `webhook` і `pull` ключа з оточення не беруть узагалі. Тут стояло
 * «шість» — число, якого ніхто не рахував (рецензія раунду 8, Р8.2).
 *
 * Дозволено: друковані ASCII без пробілів — цього досить будь-якому ключу
 * (hex, uuid, base64url) і рівно це переживає заголовок. Значення НЕ
 * друкується у відмові: воно секрет, а сказати треба не «яке воно», а «чим
 * саме воно погане».
 */

/** Перше недозволене місце ключа, або `null`. */
export function badKeyChar(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.codePointAt(i);
    if (c < 0x21 || c > 0x7e) {
      const what = c === 0x20 ? 'пробіл'
        : c === 0x0a ? 'перенос рядка'
        : c === 0x0d ? 'повернення каретки'
        : c === 0x09 ? 'табуляція'
        : c > 0x7e ? `неASCII-символ U+${c.toString(16).toUpperCase().padStart(4, '0')}`
        : `керівний символ U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
      return { position: i + 1, what };
    }
  }
  return null;
}

/**
 * Значення змінної оточення, придатне для заголовка. Інакше — відмова з
 * назвою причини і вихід 2 (той самий код, що й «немає ключа»: для оператора
 * це той самий рід біди — запуск не почався).
 */
export function requireVendorKey(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`немає ${name} в оточенні — далі йти нема куди`);
    process.exit(2);
  }
  const bad = badKeyChar(value);
  if (bad) {
    console.error(
      `${name} містить недопустимі символи: ${bad.what} на позиції ${bad.position} з ${value.length}.`);
    console.error('Ключ їде в заголовок HTTP, а туди можна лише друковані ASCII без пробілів.');
    console.error('Найчастіша причина — перенос рядка з файла: беріть значення без нього');
    console.error(`(наприклад, ${name}="$(tr -d '\\r\\n' < key.txt)").`);
    process.exit(2);
  }
  return value;
}
