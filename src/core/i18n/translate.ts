/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server-side translation helper — translates Ukrainian content to all guest languages.
 * Storage: content_translations table (text_hash + lang → translated_text).
 * Trigger: called on admin save (config routes) and via /api/admin/retranslate.
 */
import { getDb } from '@/lib/db';
import crypto from 'crypto';
import { getSql } from '../db/async.ts';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
export const GUEST_LANGS = ['en', 'de', 'cs', 'pl', 'nl', 'fr'] as const;
export type GuestLang = typeof GUEST_LANGS[number];

const LANG_NAMES: Record<string, string> = {
  en: 'English', de: 'German', cs: 'Czech',
  pl: 'Polish',  nl: 'Dutch', fr: 'French',
};

/** Stable MD5 hash for a text string */
export function textHash(text: string): string {
  return crypto.createHash('md5').update(text.trim()).digest('hex');
}

/**
 * Extract all translatable Ukrainian strings from property/unit-type config.
 */
export function extractTexts(config: any): string[] {
  const texts = new Set<string>();
  const add = (t: any) => { if (t && typeof t === 'string' && t.trim().length > 1) texts.add(t.trim()); };

  // Rules [{icon, text}]
  try {
    const rules = typeof config.rules === 'string' ? JSON.parse(config.rules) : config.rules;
    if (Array.isArray(rules)) rules.forEach((r: any) => add(r.text));
  } catch { /* skip */ }

  // FAQ [{q, a}]
  try {
    const faq = typeof config.faq_items === 'string' ? JSON.parse(config.faq_items) : config.faq_items;
    if (Array.isArray(faq)) faq.forEach((f: any) => { add(f.q); add(f.a); });
  } catch { /* skip */ }

  // Useful info [{icon, title, desc}]
  try {
    const info = typeof config.useful_info === 'string' ? JSON.parse(config.useful_info) : config.useful_info;
    if (Array.isArray(info)) info.forEach((u: any) => { add(u.title); add(u.desc); });
  } catch { /* skip */ }

  // Amenities [{icon, name}]
  try {
    const amenities = typeof config.amenities === 'string' ? JSON.parse(config.amenities) : config.amenities;
    if (Array.isArray(amenities)) amenities.forEach((a: any) => add(a.name));
  } catch { /* skip */ }

  // Simple text fields
  add(config.restaurant_name);
  add(config.restaurant_hours);
  add(config.check_in_instructions);
  add(config.parking_info);

  return Array.from(texts);
}

/**
 * Extract translatable texts from additional_services rows.
 */
export function extractServiceTexts(services: any[]): string[] {
  const texts = new Set<string>();
  const add = (t: any) => { if (t && typeof t === 'string' && t.trim().length > 1) texts.add(t.trim()); };
  for (const s of services) {
    add(s.name);          // Ukrainian name → translated via content_translations
    add(s.description);
    add(s.unit_label);
  }
  return Array.from(texts);
}

/**
 * Translate an array of Ukrainian texts to ALL guest languages via OpenAI.
 * Stores/updates results in content_translations table.
 * Skips texts already translated (unless force=true).
 */
export async function translateAndStore(texts: string[], force = false): Promise<{ translated: number; skipped: number }> {
  if (!OPENAI_KEY || texts.length === 0) return { translated: 0, skipped: texts.length };

  const sql = getSql();
  let translated = 0;
  let skipped = 0;

  const UPSERT = `
    INSERT INTO content_translations (text_hash, source_text, lang, translated_text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (text_hash, lang) DO UPDATE SET
      translated_text = excluded.translated_text,
      source_text = excluded.source_text,
      created_at = CURRENT_TIMESTAMP
  `;

  for (const lang of GUEST_LANGS) {
    const langName = LANG_NAMES[lang];

    // Find which texts need translation for this language
    const toTranslate: string[] = [];
    for (const text of texts) {
      if (!force) {
        const existing = await sql.row<any>('SELECT id FROM content_translations WHERE text_hash = ? AND lang = ?', [textHash(text), lang]) as any;
        if (existing) { skipped++; continue; }
      }
      toTranslate.push(text);
    }

    if (toTranslate.length === 0) continue;

    // Batch: 20 texts per API call
    for (let i = 0; i < toTranslate.length; i += 20) {
      const batch = toTranslate.slice(i, i + 20);
      const numbered = batch.map((t, idx) => `[${idx}] ${t}`).join('\n---\n');

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content: `You are a professional hospitality translator. Translate the following Ukrainian texts to ${langName}. 
Rules: Keep all emoji. Preserve \\n line breaks. Keep prices, codes, times as-is. 
Return ONLY the translations, one per line, prefixed with index like [0] translation. No explanations.`,
              },
              { role: 'user', content: numbered },
            ],
          }),
        });

        if (!res.ok) {
          console.error(`[translate] OpenAI ${lang} error:`, res.status, await res.text());
          continue;
        }

        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content || '';

        for (const line of reply.split('\n')) {
          const match = line.match(/^\[(\d+)\]\s*(.*)/);
          if (match) {
            const idx = parseInt(match[1]);
            const translatedText = match[2].trim();
            if (idx >= 0 && idx < batch.length && translatedText) {
              await sql.run(UPSERT, [textHash(batch[idx]), batch[idx], lang, translatedText]);
              translated++;
            }
          }
        }
      } catch (error: any) {
        console.error(`[translate] Error for ${lang}:`, error?.message);
      }
    }
  }

  console.log(`[translate] Done: ${translated} translated, ${skipped} skipped`);
  return { translated, skipped };
}

/**
 * Look up stored translations for an array of source texts.
 * Returns: { "source text": { en: "...", de: "...", cs: "...", ... } }
 */
export async function getStoredTranslations(texts: string[]): Promise<Record<string, Record<string, string>>> {
  if (texts.length === 0) return {};
  const sql = getSql();
  const result: Record<string, Record<string, string>> = {};

  for (const text of texts) {
    const rows = await sql.rows<any>('SELECT lang, translated_text FROM content_translations WHERE text_hash = ?', [textHash(text)]) as any[];

    if (rows.length > 0) {
      result[text] = {};
      for (const row of rows) {
        result[text][row.lang] = row.translated_text;
      }
    }
  }
  return result;
}
