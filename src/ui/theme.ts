/**
 * Тема інтерфейсу: світла за замовчуванням, темна перемикачем (П18).
 *
 * Один набір токенів, два набори значень (`globals.css`): вибір — це атрибут
 * `data-theme` на `<html>`. Зберігається у двох місцях: `localStorage` — для
 * браузера, кука `theme` — щоб і серверний рендер, і інші вкладки бачили те
 * саме. Перед першим малюванням атрибут ставить інлайновий скрипт у
 * `app/layout.tsx` (`THEME_BOOT_SCRIPT`) — тому сторінка не мигає темою
 * «за замовчуванням» перед тим, як застосувати обрану.
 *
 * Чому не `cookies()` у кореневій розкладці: вона спільна для маркетингового
 * сайту, віджета і застосунку, і читання куки на сервері зробило б КОЖНУ
 * сторінку динамічною. Скрипт у `<head>` дає той самий результат без цієї
 * ціни (рішення кодової сесії, 05.09.2026).
 */
export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';
export const THEME_STORAGE_KEY = 'alisio:theme';
export const DEFAULT_THEME: Theme = 'light';

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

/** Що обрано зараз — з атрибута, який поставив скрипт завантаження. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const v = document.documentElement.dataset.theme;
  return isTheme(v) ? v : DEFAULT_THEME;
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* приватний режим */ }
  // Рік; не httpOnly — її читає скрипт завантаження до першого малювання.
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Інлайновий скрипт для `<head>`: кука → localStorage → світла. Ставить лише
 * `data-theme="dark"`; світла — це відсутність атрибута, як у `:root`.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);var t=m?m[1]:null;if(!t){t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});}if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;
