/**
 * Вигляд термінала: лого, фон — і межа, яку вони не переходять.
 *
 * Чисті функції: жодного запиту. Сцени — `kiosk.check.ts`, 25.
 *
 * ── Чому адреса картинки взагалі потребує правила ───────────────────────
 *
 * Її набирає ЛЮДИНА в полі форми на картці застосунку, а екран у холі
 * підставляє її в `src` картинки. `javascript:…` у такому полі — це виконаний
 * код на терміналі, біля якого стоїть будь-хто з вулиці; заводить його не
 * зловмисник ззовні, а свій же оператор, якому «дали адресу логотипа».
 *
 * Тому список БІЛИЙ, а не чорний: дозволено рівно `https://`, `http://` і
 * власний шлях від кореня. Чорний список («заборонити javascript:») ловить
 * лише те, що вже згадали, — а `data:text/html`, ` javascript:` з пробілом і
 * `JaVaScRiPt:` вигадуються швидше, ніж дописуються.
 *
 * `//evil.test/logo.png` серед дозволених немає навмисно: це адреса на ЧУЖИЙ
 * хост, яка виглядає як свій шлях, і саме тому її легко проґавити очима.
 *
 * ── Чому правило одне на запис і на читання ─────────────────────────────
 *
 * Писач (`saveDeviceConfig`) відмовляє одразу — оператор дізнається про
 * помилку там, де її зробив. Читач (`readAppearance`) перевіряє ще раз —
 * рядок міг лягти в базу до цього правила або повз форму. Два різні правила
 * розійшлися б при першій же правці, тому функція одна.
 */

/** Адреса, придатна для `src` на екрані в холі, або `null`. */
export function safeAssetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  // Свій шлях від кореня — але не `//`, бо це вже чужий хост.
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  return /^https?:\/\//i.test(v) ? v : null;
}

export interface KioskAppearance {
  logoUrl: string | null;
  backgroundUrl: string | null;
}

/** Лого й фон із `config_json` пристрою — уже перевірені. */
export function readAppearance(configJson: string | null): KioskAppearance {
  try {
    const parsed = configJson
      ? (typeof configJson === 'string' ? JSON.parse(configJson) : configJson)
      : {};
    const c = parsed as { logo_url?: unknown; background_url?: unknown };
    return { logoUrl: safeAssetUrl(c?.logo_url), backgroundUrl: safeAssetUrl(c?.background_url) };
  } catch {
    return { logoUrl: null, backgroundUrl: null };
  }
}
