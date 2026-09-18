/**
 * The language registry: one list, and everything that asks reads it.
 *
 * Before this there were four separate lists — the guest portal knew seven
 * languages, the booking widget four, translate.ts six, and the operator
 * interface none at all, because Ukrainian was written straight into the JSX.
 * Adding a language meant finding all four and hoping there was not a fifth.
 *
 * Two things are stored, and they are deliberately the same column:
 *
 *   organizations.language  the hotel's base language. Its staff see the
 *                           interface in it, and it is the language its people
 *                           type content in — so it is also the SOURCE for
 *                           translating that content to guests.
 *   app_users.language      one person's override. NULL means "whatever the
 *                           hotel uses", which is what almost everyone wants.
 *
 * Imports here stay dependency-free on purpose: provisioning runs this under
 * plain node, where '@core/…' and 'next/server' do not resolve.
 */

/**
 * ── Порядок тут і є порядком на екрані ──────────────────────────────────
 *
 * Не абетка і не історія — це список, який бачить гість у перемикачі й
 * оператор у налаштуваннях, зверху вниз. Німецька першою, бо продукт
 * продається німецькому готелю, і мова, якою він говорить зі своїми гостями,
 * має стояти першою; далі англійська як спільна, далі сусіди за ринком.
 *
 * Українська ОСТАННЯ і при цьому нікуди не дівається: нею написані літерали
 * в JSX (`UI_SOURCE_LANGUAGE`), тобто вона лишається мовою, у яку впирається
 * запасний шлях каталогу. Це дві РІЗНІ ролі, і плутати їх не можна —
 * `language-order.check` тримає їх окремо.
 */
export const LANGUAGES = {
  de: { native: 'Deutsch', english: 'German' },
  en: { native: 'English', english: 'English' },
  cs: { native: 'Čeština', english: 'Czech' },
  pl: { native: 'Polski', english: 'Polish' },
  nl: { native: 'Nederlands', english: 'Dutch' },
  fr: { native: 'Français', english: 'French' },
  uk: { native: 'Українська', english: 'Ukrainian' },
} as const;

export type Language = keyof typeof LANGUAGES;

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];

/**
 * Мова, яку дістає готель, коли ніхто нічого не обрав, — і ПЕРША в реєстрі.
 *
 * Була українська, «бо нею написані всі рядки продукту». Це плутало дві речі:
 * мову, якою написані ЛІТЕРАЛИ (вона нижче, і вона й далі українська), і
 * мову, яку продукт пропонує ПЕРШОЮ. Друга — рішення про ринок, а не
 * властивість нашого коду, і для німецького готелю українська першою була
 * просто неправильною відповіддю.
 *
 * Що це збігається з `LANGUAGE_CODES[0]`, стверджує `language-order.check`:
 * інакше перша кнопка перемикача каже одне, а система без вибору робить інше,
 * і побачить це лише той, хто нічого не обирав.
 */
export const DEFAULT_LANGUAGE: Language = 'de';

/**
 * Мова, якою написані літерали в JSX. Ключі каталогу — це САМІ ці рядки, тож
 * поки каталог такий, вона лишається українською, хоч би яка мова була
 * базовою.
 *
 * Змінити її можна лише разом із переписуванням усього каталогу (3717 ключів
 * на день цього рядка). `DEFAULT_LANGUAGE` міняється коли завгодно — це різні
 * речі, і `language-order.check` стверджує саме їхню окремість.
 */
export const UI_SOURCE_LANGUAGE: Language = 'uk';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in LANGUAGES;
}

/** A code from anywhere untrusted — a column, a form, a query string. */
export function parseLanguage(value: unknown, fallback: Language = DEFAULT_LANGUAGE): Language {
  if (typeof value !== 'string') return fallback;
  const code = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(code) ? code : fallback;
}

/**
 * The languages a hotel's content is translated INTO — everything except the
 * one it is written in. A German hotel does not need its own text translated
 * to German, and asking a model to do it produces drift, not a copy.
 */
export function targetLanguages(source: Language): Language[] {
  return LANGUAGE_CODES.filter((code) => code !== source);
}

/**
 * Best match from an Accept-Language header. Only used when there is nobody to
 * ask — a guest arriving on a portal link, before any preference exists.
 */
export function fromAcceptLanguage(
  header: string | null | undefined,
  fallback: Language,
): Language {
  if (!header) return fallback;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      const weight = q ? Number.parseFloat(q.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of ranked) {
    const code = tag.split(/[-_]/)[0];
    if (isLanguage(code)) return code;
  }
  return fallback;
}
