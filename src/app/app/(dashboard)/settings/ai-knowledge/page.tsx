'use client';

import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/lib/MobileMenuContext';
import { useState, useEffect, useCallback } from 'react';
import {
  Brain, Plus, Pencil, Trash2, Save, X, Search,
  Building2, Car, PawPrint, Wifi, UtensilsCrossed,
  KeyRound, MapPin, HelpCircle, ChevronDown,
} from 'lucide-react';

interface KnowledgeArticle {
  id: string;
  topic: string;
  keywords: string;
  content: string;
  category: string;
  language: string;
  is_active: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: 'general', label: 'Загальне', icon: <HelpCircle size={14} /> },
  { value: 'properties', label: "Об'єкти", icon: <Building2 size={14} /> },
  { value: 'logistics', label: 'Логістика', icon: <Car size={14} /> },
  { value: 'rules', label: 'Правила', icon: <KeyRound size={14} /> },
  { value: 'services', label: 'Сервіси', icon: <UtensilsCrossed size={14} /> },
  { value: 'activities', label: 'Активності', icon: <MapPin size={14} /> },
  { value: 'pets', label: 'Тварини', icon: <PawPrint size={14} /> },
  { value: 'tech', label: 'Технічне', icon: <Wifi size={14} /> },
];

function getCategoryIcon(cat: string) {
  const found = CATEGORIES.find(c => c.value === cat);
  return found?.icon || <HelpCircle size={14} />;
}

function getCategoryLabel(cat: string) {
  const found = CATEGORIES.find(c => c.value === cat);
  return found?.label || cat;
}

export default function AIKnowledgePage() {
  const onMenuClick = useMobileMenu();
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTopic, setFormTopic] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('general');
  const [formActive, setFormActive] = useState(true);

  const fetchArticles = useCallback(async () => {
    try {
      const url = filterCategory
        ? `/api/crm/ai/knowledge?category=${filterCategory}`
        : '/api/crm/ai/knowledge';
      const res = await fetch(url);
      const data = await res.json();
      setArticles(data.articles || []);
    } catch {
      console.error('Failed to fetch knowledge articles');
    } finally {
      setLoading(false);
    }
  }, [filterCategory]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const openNew = () => {
    setIsNew(true);
    setEditingId('__new__');
    setFormTopic('');
    setFormKeywords('');
    setFormContent('');
    setFormCategory('general');
    setFormActive(true);
  };

  const openEdit = (a: KnowledgeArticle) => {
    setIsNew(false);
    setEditingId(a.id);
    setFormTopic(a.topic);
    setFormKeywords(a.keywords);
    setFormContent(a.content);
    setFormCategory(a.category);
    setFormActive(!!a.is_active);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
  };

  const saveArticle = async () => {
    if (!formTopic.trim() || !formKeywords.trim() || !formContent.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/crm/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: isNew ? undefined : editingId,
          topic: formTopic,
          keywords: formKeywords,
          content: formContent,
          category: formCategory,
          isActive: formActive,
        }),
      });
      setEditingId(null);
      setIsNew(false);
      fetchArticles();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const deleteArticle = async (id: string) => {
    if (!confirm('Видалити цю статтю?')) return;
    await fetch(`/api/crm/ai/knowledge?id=${id}`, { method: 'DELETE' });
    fetchArticles();
  };

  const filtered = articles.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.topic.toLowerCase().includes(q) ||
           a.keywords.toLowerCase().includes(q) ||
           a.content.toLowerCase().includes(q);
  });

  return (
    <>
      <Header title="AI База знань" onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Brain size={24} /> AI База знань
            </h2>
            <div className="page-subtitle">
              Навчайте AI-рецепціоніста: додавайте знання, правила та приклади відповідей.
              AI автоматично знаходить релевантні статті при відповіді гостям.
            </div>
          </div>
          <button className="btn btn-primary" onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> Додати знання
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 400 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              placeholder="Пошук за темою, ключовими словами..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input"
              style={{ paddingLeft: 36, width: '100%' }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="input"
              style={{ minWidth: 160, appearance: 'none', paddingRight: 30 }}
            >
              <option value="">Всі категорії</option>
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', fontSize: 13 }}>
            📚 {filtered.length} {filtered.length === 1 ? 'стаття' : 'статей'}
          </div>
        </div>

        {/* Editor modal */}
        {editingId && (
          <div className="card" style={{ marginBottom: 20, border: '1px solid var(--accent)', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {isNew ? '➕ Нова стаття' : '✏️ Редагування'}
              </h3>
              <button onClick={cancelEdit} className="btn btn-ghost" style={{ padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                  Тема *
                </label>
                <input
                  type="text"
                  value={formTopic}
                  onChange={e => setFormTopic(e.target.value)}
                  className="input"
                  placeholder="Наприклад: QA Glamping / Quiet Anomaly"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                    Категорія
                  </label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    className="input"
                    style={{ width: '100%' }}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formActive}
                      onChange={e => setFormActive(e.target.checked)}
                    />
                    Активна
                  </label>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                  Ключові слова * <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(через кому)</span>
                </label>
                <input
                  type="text"
                  value={formKeywords}
                  onChange={e => setFormKeywords(e.target.value)}
                  className="input"
                  placeholder="quiet anomaly, glamping, domek, tiny house"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Додайте всі можливі слова, якими гість може запитати про цю тему (різними мовами)
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                  Зміст / Інформація для AI *
                </label>
                <textarea
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  className="input"
                  rows={8}
                  placeholder="Напишіть факти, правила, інструкції які AI повинен знати. Це НЕ відповідь гостю — це знання для AI."
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={cancelEdit} className="btn btn-ghost">Скасувати</button>
                <button
                  onClick={saveArticle}
                  className="btn btn-primary"
                  disabled={saving || !formTopic.trim() || !formKeywords.trim() || !formContent.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Save size={14} /> {saving ? 'Зберігаю...' : 'Зберегти'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Articles list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
            Завантаження...
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <Brain size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>База знань порожня</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 16 }}>
              Додайте знання, щоб AI-рецепціоніст давав точніші відповіді
            </div>
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={16} /> Додати першу статтю
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {filtered.map(article => (
              <div key={article.id} className="card" style={{
                opacity: article.is_active ? 1 : 0.5,
                borderLeft: `3px solid ${article.is_active ? 'var(--accent)' : 'var(--border)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      {getCategoryIcon(article.category)}
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                        color: 'var(--accent)', letterSpacing: '0.5px',
                      }}>
                        {getCategoryLabel(article.category)}
                      </span>
                      {!article.is_active && (
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
                        }}>
                          вимкнено
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                        використано: {article.usage_count}×
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{article.topic}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                      🏷️ {article.keywords}
                    </div>
                    <div style={{
                      fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden',
                    }}>
                      {article.content}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => openEdit(article)}
                      className="btn btn-ghost"
                      style={{ padding: 6 }}
                      title="Редагувати"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => deleteArticle(article.id)}
                      className="btn btn-ghost"
                      style={{ padding: 6, color: 'var(--color-error)' }}
                      title="Видалити"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
