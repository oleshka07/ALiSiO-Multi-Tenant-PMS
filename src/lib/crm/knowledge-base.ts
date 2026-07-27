/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CRM Knowledge Base — Smart knowledge retrieval for AI responses
 * 
 * Searches knowledge articles by keyword matching and injects
 * relevant articles into the AI prompt as context.
 * 
 * Future: migrate to LightRAG (https://github.com/HKUDS/LightRAG)
 * for vector-based semantic search when knowledge base grows.
 */
import { getDb } from '@/lib/db';

export interface KnowledgeArticle {
  id: string;
  topic: string;
  keywords: string;
  content: string;
  category: string;
  language: string;
  usage_count: number;
}

/* ────────────────────────────────────────────────────────
   Search knowledge base by message content
   Returns top N most relevant articles
   ──────────────────────────────────────────────────────── */
export function searchKnowledge(messageContent: string, maxResults = 5): KnowledgeArticle[] {
  const db = getDb();
  
  const articles = db.prepare(`
    SELECT id, topic, keywords, content, category, language, usage_count
    FROM crm_knowledge_base
    WHERE is_active = 1
  `).all() as KnowledgeArticle[];

  if (articles.length === 0) return [];

  // Normalize message for matching
  const msgLower = messageContent.toLowerCase()
    .replace(/[^\w\sа-яА-ЯіІїЇєЄґҐěščřžýáíéúůäöüß]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const msgWords = new Set(msgLower.split(' ').filter(w => w.length > 2));

  // Score each article by keyword match
  const scored = articles.map(article => {
    const keywords = article.keywords.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    
    let score = 0;
    let matchedKeywords: string[] = [];

    for (const keyword of keywords) {
      // Multi-word keyword (phrase match)
      if (keyword.includes(' ')) {
        if (msgLower.includes(keyword)) {
          score += 3; // Phrase match = high score
          matchedKeywords.push(keyword);
        }
      } else {
        // Single word keyword
        if (msgWords.has(keyword) || msgLower.includes(keyword)) {
          score += 1;
          matchedKeywords.push(keyword);
        }
      }
    }

    // Bonus for topic word match
    const topicWords = article.topic.toLowerCase().split(/\s+/);
    for (const tw of topicWords) {
      if (tw.length > 3 && msgLower.includes(tw)) {
        score += 2;
      }
    }

    return { article, score, matchedKeywords };
  });

  // Filter articles with at least 1 match, sort by score desc
  const matches = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  // Update usage count for matched articles
  if (matches.length > 0) {
    const updateStmt = db.prepare('UPDATE crm_knowledge_base SET usage_count = usage_count + 1 WHERE id = ?');
    for (const m of matches) {
      updateStmt.run(m.article.id);
    }
  }

  console.log(`[Knowledge] Searched "${msgLower.substring(0, 60)}..." → ${matches.length} matches: ${matches.map(m => `${m.article.topic}(${m.score})`).join(', ')}`);

  return matches.map(m => m.article);
}

/* ────────────────────────────────────────────────────────
   Build knowledge context string for prompt injection
   ──────────────────────────────────────────────────────── */
export function buildKnowledgeContext(articles: KnowledgeArticle[]): string {
  if (articles.length === 0) return '';

  const sections = articles.map((a, i) => 
    `### ${i + 1}. ${a.topic} [${a.category}]\n${a.content}`
  );

  return `## 📚 БАЗА ЗНАНЬ — Релевантна інформація
Використовуй цю інформацію для відповіді. НЕ вигадуй нічого понад це.

${sections.join('\n\n')}
`;
}

/* ────────────────────────────────────────────────────────
   Detect if question is non-standard (no knowledge match)
   Returns confidence level: 'standard' | 'uncertain' | 'unknown'
   ──────────────────────────────────────────────────────── */
export function assessQuestionConfidence(
  messageContent: string,
  knowledgeMatches: number,
  hasPriceData: boolean,
): 'standard' | 'uncertain' | 'unknown' {
  const lower = messageContent.toLowerCase();
  
  // Standard pricing questions — always confident
  const pricingPatterns = [
    /how much|kolik|ціна|price|cost|rate|сколько|wieviel/i,
    /book|reserv|бронюв|зарезерв|buchen|objednat/i,
    /availab|volno|вільн|свобод|verfügbar/i,
    /check.?in|check.?out|заїзд|виїзд/i,
    /breakfast|snídaně|сніданок|завтрак/i,
  ];

  const isStandardQuestion = pricingPatterns.some(p => p.test(lower));

  if (isStandardQuestion || hasPriceData) {
    return 'standard';
  }

  if (knowledgeMatches >= 2) {
    return 'standard';
  }

  if (knowledgeMatches === 1) {
    return 'uncertain'; // Have some info, but may need human review
  }

  // No knowledge match and not a standard question
  return 'unknown';
}
