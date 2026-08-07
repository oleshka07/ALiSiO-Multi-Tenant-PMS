'use client';

/**
 * The interface language, on the client.
 *
 * Every operator screen is a client component, so the language cannot be read
 * from the session on the server the way a handler reads it. The dashboard
 * layout already fetches /api/auth/me to decide whether to render at all; the
 * language rides along on that same response and is put here, so there is one
 * request and one source of truth rather than a lookup per screen.
 *
 * Before the fetch resolves the value is the source language, which means the
 * first paint is Ukrainian and then settles. That is deliberate: the
 * alternative is holding the whole dashboard blank on a dictionary.
 */

import { createContext, useContext, useMemo } from 'react';
import { translate, translatePlural } from './dictionary';
import { type Language, UI_SOURCE_LANGUAGE } from './languages';

const LanguageContext = createContext<Language>(UI_SOURCE_LANGUAGE);

export function I18nProvider({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

/** The language this screen is rendering in. */
export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/**
 * `const t = useT()` then `t('Зберегти')`.
 *
 * The argument is the Ukrainian source string, not a key — see dictionary.ts
 * for why. An unknown string returns itself, so this is safe to wrap around
 * text that has not been translated yet.
 */
export function useT(): (text: string) => string {
  const language = useContext(LanguageContext);
  return useMemo(() => (text: string) => translate(text, language), [language]);
}

/**
 * `const plural = usePlural()` then `` `${n} ${plural(n, 'записів')}` ``.
 *
 * Use it wherever a word follows a number. `t()` cannot: it is handed the word
 * alone, so it can only ever return one form, and «1 Einträge» is what that
 * looks like. Czech and Polish make the same mistake three times louder.
 *
 * The count stays at the call site rather than being formatted in here, because
 * the surrounding text is often more than a number — `(${n} ${plural(…)})`,
 * `${n.toLocaleString()} …` — and swallowing it would take that away.
 */
export function usePlural(): (count: number, text: string) => string {
  const language = useContext(LanguageContext);
  return useMemo(
    () => (count: number, text: string) => translatePlural(text, count, language),
    [language],
  );
}
