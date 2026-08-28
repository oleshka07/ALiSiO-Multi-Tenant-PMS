/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';

/**
 * Шаблони ваучерів — того готелю, який їх продає.
 *
 * ── Що тут було ─────────────────────────────────────────────────────────
 *
 * Константа `GIFT_CARD_TEMPLATES`: шість шаблонів із цінами (4900 і 8500 Kč,
 * 580, 220, 190 і 95 €) та продуктами одного кемпінгу — глемпінг, фінська
 * сауна, карпатський чан, будиночок на двох. У файлі платформи, тобто
 * СПІЛЬНА: екран «Пропозиції» показував ці шість карток кожному готелю на
 * сервері, і будь-хто міг видати ваучер «АКЦІЯ 1+1+1» за 220 € з чужого
 * прайса.
 *
 * Це дефект ізоляції, не косметика. Він протримався тому, що
 * `check-no-tenant-names` шукав ІМЕНА — назву, домен, телефон, GPS — і жодного
 * разу не спитав, що цей клієнт ПРОДАЄ. Гейт розширено; маркери продуктів,
 * сум і копії ваучерів тепер у ньому поіменно.
 *
 * ── Де вони тепер ───────────────────────────────────────────────────────
 *
 * `gift_card_templates`, рядок на організацію (міграція 0047). Порожній
 * список — правильний стан нового клієнта: свої пропозиції він заводить сам,
 * і платформа не пропонує йому чужих.
 *
 * Уже видані ваучери від цього не залежать: `POST /api/gift-cards` копіює в
 * рядок `gift_cards` усе, що взяв із шаблону — назву, тип, суму, валюту,
 * `config_json`. Ваучер на руках у гостя самодостатній.
 */
export interface GiftCardTemplate {
  /** Ключ, яким шаблон називають екрани й `gift_cards.template_id`. */
  id: string;
  name: string;
  description: string;
  type: 'open_date' | 'package' | 'discount';
  value_type: 'fixed_czk' | 'fixed_eur' | 'percent' | 'nights';
  face_value: number;
  currency: string;
  config_json: Record<string, unknown>;
  emoji: string;
  badge: string;
  /** Стандартний термін дії, місяців. */
  validityMonths: number;
}

function toTemplate(row: any): GiftCardTemplate {
  return {
    id: String(row.template_key),
    name: String(row.name),
    description: String(row.description ?? ''),
    type: row.type,
    value_type: row.value_type,
    face_value: Number(row.face_value ?? 0),
    currency: String(row.currency),
    // SQLite тримає JSON текстом, Postgres — JSONB і віддає вже об'єктом.
    config_json: typeof row.config_json === 'string'
      ? JSON.parse(row.config_json || '{}')
      : (row.config_json ?? {}),
    emoji: String(row.emoji ?? '🎁'),
    badge: String(row.badge ?? ''),
    validityMonths: Number(row.validity_months ?? 12),
  };
}

/** Шаблони цього готелю. Порожньо — нормальний стан, не помилка. */
export async function listGiftCardTemplates(organizationId: string): Promise<GiftCardTemplate[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT template_key, name, description, type, value_type, face_value, currency,
            config_json, emoji, badge, validity_months
       FROM gift_card_templates
      WHERE organization_id = ? AND is_active = TRUE
      ORDER BY sort_order, name`,
    [organizationId],
  );
  return rows.map(toTemplate);
}

/**
 * Один шаблон цього готелю, або null.
 *
 * `organizationId` — обов'язковий аргумент, а не зручність: шаблон із чужим
 * ключем не має знаходитись. Стара версія приймала лише `templateId` і шукала
 * в спільному масиві, тому будь-який готель міг видати ваучер за чужим
 * шаблоном, просто назвавши його id.
 */
export async function getGiftCardTemplate(
  organizationId: string,
  templateId: string,
): Promise<GiftCardTemplate | null> {
  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT template_key, name, description, type, value_type, face_value, currency,
            config_json, emoji, badge, validity_months
       FROM gift_card_templates
      WHERE organization_id = ? AND template_key = ? AND is_active = TRUE`,
    [organizationId, templateId],
  );
  return row ? toTemplate(row) : null;
}

/**
 * Код ваучера.
 *
 * Префікс був `LIS-` — скорочення від назви першого клієнта, і воно стояло на
 * ваучерах кожного готелю. `GC` (gift card) не належить нікому.
 *
 * Без 0, O, I та 1: гість читає код із паперу або з екрана телефону і диктує
 * його на рецепції.
 */
export function buildGiftCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `GC-${suffix}`;
}

/** Дата закінчення ваучера від сьогодні. */
export function calcExpiresAt(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}
