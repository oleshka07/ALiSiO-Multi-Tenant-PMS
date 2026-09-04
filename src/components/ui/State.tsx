'use client';

/**
 * Чотири стани екрана — один набір на всі екрани (BUILD-PLAN, Блок 1).
 *
 * Порожньо, завантаження, помилка, відмова. До цього кожен екран малював
 * їх сам: 26 екранів писали «Завантаження...» по-своєму, порожній стан був
 * то «Немає даних», то «Нічого не знайдено», то реченням без кнопки. Тут
 * вони складаються з тих самих токенів (`globals.css` `:root`), і кожен
 * має один вигляд.
 *
 * Правило порожнього стану — краще за Channex («No items created yet»):
 * він КАЖЕ, ЩО РОБИТИ ДАЛІ, І ДАЄ КНОПКУ. Порожній список без дії — це
 * екран, який людина читає як поломку.
 *
 * Тексти — з екрана, через `t()`: тут лише форма.
 */

import Link from 'next/link';
import { useT } from '@core/i18n/client';
import { Loader2, Inbox, AlertTriangle, Lock } from 'lucide-react';

interface Action {
  label: string;
  /** Або посилання, або дія — не обидва. */
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

function ActionButton({ action, primary }: { action: Action; primary: boolean }) {
  const cls = `btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm`;
  if (action.href) return <Link href={action.href} className={cls}>{action.icon}{action.label}</Link>;
  return <button type="button" className={cls} onClick={action.onClick}>{action.icon}{action.label}</button>;
}

const box: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
  gap: 8, padding: '40px 24px', color: 'var(--text-secondary)', fontSize: 13,
};

/**
 * Порожньо. `title` — що саме порожнє, `hint` — що робити далі, `action` —
 * кнопка, яка це робить. Без `action` — лише для списків, де дія неможлива
 * (пошук нічого не дав: тоді `hint` каже змінити фільтр).
 */
export function EmptyState({ title, hint, action, secondary, icon, compact }: {
  title: string;
  hint?: string;
  action?: Action;
  secondary?: Action;
  icon?: React.ReactNode;
  /** У вузькому місці (вкладка, картка) — менше повітря. */
  compact?: boolean;
}) {
  return (
    <div className="card" style={{ ...box, padding: compact ? '20px 16px' : box.padding }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{icon ?? <Inbox size={compact ? 22 : 30} />}</span>
      <div style={{ fontWeight: 700, fontSize: compact ? 13 : 15, color: 'var(--text-primary)' }}>{title}</div>
      {hint && <div style={{ maxWidth: 480 }}>{hint}</div>}
      {(action || secondary) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
          {action && <ActionButton action={action} primary />}
          {secondary && <ActionButton action={secondary} primary={false} />}
        </div>
      )}
    </div>
  );
}

/** Завантаження. Підпис за замовчуванням — один на всі екрани. */
export function LoadingState({ label, compact }: { label?: string; compact?: boolean }) {
  const t = useT();
  return (
    <div className="card" style={{ ...box, padding: compact ? '16px' : '48px 24px' }} role="status" aria-live="polite">
      <Loader2 size={compact ? 16 : 22} className="animate-pulse" />
      <span>{label ?? t('Завантаження...')}</span>
    </div>
  );
}

/**
 * Помилка — те, що зламалось у нас, а не те, що зробила людина. Каже, що
 * можна спробувати ще раз, і дає кнопку. Текст помилки сервера сюди не
 * потрапляє (інваріант 6): `detail` — уже перекладене пояснення екрана.
 */
export function ErrorState({ title, detail, retry }: { title?: string; detail?: string; retry?: () => void }) {
  const t = useT();
  return (
    <div className="card" style={{ ...box, borderLeft: '4px solid var(--accent-danger)' }} role="alert">
      <AlertTriangle size={26} style={{ color: 'var(--accent-danger)' }} />
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{title ?? t('Не вдалося завантажити')}</div>
      {detail && <div style={{ maxWidth: 480 }}>{detail}</div>}
      {retry && <button type="button" className="btn btn-secondary btn-sm" onClick={retry} style={{ marginTop: 6 }}>{t('Спробувати ще раз')}</button>}
    </div>
  );
}

/**
 * Відмова — доступу немає, і це не поломка: роль без права, вимкнений
 * модуль (`ModuleGate` малює свій, зі своїм текстом), чужий обʼєкт.
 */
export function DeniedState({ title, hint, action }: { title?: string; hint?: string; action?: Action }) {
  const t = useT();
  return (
    <div className="card" style={box}>
      <Lock size={26} style={{ color: 'var(--text-tertiary)' }} />
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{title ?? t('Недостатньо прав')}</div>
      {hint && <div style={{ maxWidth: 480 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}><ActionButton action={action} primary={false} /></div>}
    </div>
  );
}
