/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

const OPENAI_KEY = process.env.OPENAI_API_KEY;

const LANG_NAMES: Record<string, string> = {
  en: 'English', de: 'German', cs: 'Czech', pl: 'Polish', nl: 'Dutch', fr: 'French',
};

const translationCache = new Map<string, string>();

function cacheKey(text: string, lang: string): string {
  return `${lang}:${text.substring(0, 100)}:${text.length}`;
}

export async function translateTexts(request: NextRequest): Promise<NextResponse> {
  try {
    const { texts, lang } = await request.json();
    if (!texts || !lang || lang === 'uk') {
      return NextResponse.json({ translations: texts || [] });
    }
    if (!OPENAI_KEY) {
      return NextResponse.json({ translations: texts });
    }

    const langName = LANG_NAMES[lang] || lang;
    const results: string[] = [];
    const toTranslate: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (!t || t.trim() === '') { results[i] = t; continue; }
      const cached = translationCache.get(cacheKey(t, lang));
      if (cached) { results[i] = cached; }
      else { toTranslate.push({ index: i, text: t }); results[i] = ''; }
    }

    if (toTranslate.length === 0) return NextResponse.json({ translations: results });

    const batch = toTranslate.map((item, idx) => `[${idx}] ${item.text}`).join('\n---\n');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator for a hospitality/hotel guest page. Translate the following Ukrainian texts to ${langName}. Keep emoji and special characters. Preserve line breaks (\\n). Return ONLY the translations, one per line, prefixed with their index number like [0] translation here. Do not add explanations.`,
          },
          { role: 'user', content: batch },
        ],
      }),
    });

    if (!res.ok) {
      console.error('OpenAI translation error:', res.status);
      return NextResponse.json({ translations: texts });
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';

    const lines = reply.split('\n');
    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.*)/);
      if (match) {
        const idx = parseInt(match[1]);
        const translated = match[2].trim();
        if (idx >= 0 && idx < toTranslate.length) {
          const orig = toTranslate[idx];
          results[orig.index] = translated;
          translationCache.set(cacheKey(orig.text, lang), translated);
        }
      }
    }

    for (let i = 0; i < results.length; i++) {
      if (!results[i]) results[i] = texts[i];
    }

    return NextResponse.json({ translations: results });
  } catch (error: any) {
    console.error('Translation error:', error?.message);
    return NextResponse.json({ translations: [] }, { status: 500 });
  }
}
