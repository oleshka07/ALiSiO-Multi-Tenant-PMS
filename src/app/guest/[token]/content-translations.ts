// Re-exports from src/lib/content-translations.ts.
// Kept here for backward compat with page.tsx import.

export { translateContent, CONTENT_LANGS } from '@/lib/content-translations';
export type { ContentLang } from '@/lib/content-translations';

import { translateContent } from '@/lib/content-translations';
import type { Lang } from './translations';

export function translateAmenity(item: { icon: string; name: string }, lang: Lang): { icon: string; name: string } {
  return { icon: item.icon, name: translateContent(item.name, lang) };
}

export function translateFaq(item: { q: string; a: string }, lang: Lang): { q: string; a: string } {
  return { q: translateContent(item.q, lang), a: translateContent(item.a, lang) };
}

export function translateRule(item: { icon: string; text: string }, lang: Lang): { icon: string; text: string } {
  return { icon: item.icon, text: translateContent(item.text, lang) };
}

export function translateUsefulInfo(item: { icon: string; title: string; desc: string }, lang: Lang): { icon: string; title: string; desc: string } {
  return { icon: item.icon, title: translateContent(item.title, lang), desc: translateContent(item.desc, lang) };
}
