/**
 * POST /api/gift-cards/workflow
 * Генерує промокоди на основі правила автоматизації ваучера.
 *
 * Body:
 *   site_id         — до якого сайту прив'язати промокоди
 *   template_id     — ID шаблону ваучера
 *   count           — скільки промокодів згенерувати (1..500)
 *   discount_type   — 'percentage' | 'fixed_amount'
 *   offer_amount  — величина знижки
 *   valid_from      — (optional) ISO date
 *   valid_until     — (optional) ISO date
 *   min_nights      — (optional) мін. ночей
 *   max_nights      — (optional) макс. ночей
 *   allowed_days    — (optional) number[]  (1=Пн..7=Нд)
 *   applies_to      — 'listings' | 'services' | 'both'
 *   redemption_limit — ліміт використань ОДНОГО коду (default 1)
 *
 * GET /api/gift-cards/workflow?site_id=xxx
 * Повертає список automation rules для сайту.
 *
 * DELETE /api/gift-cards/workflow?rule_id=xxx
 * Видаляє правило та пов'язані промокоди.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, withPermission } from '@core/auth/session';
import { getGiftCardTemplate } from '@/modules/widget/domain/gift-card-builder';

import { randomBytes } from 'crypto';

// Генерація унікального токена кампанії у стилі CMPN-XXXXXX
function generateCampaignToken(prefix: string): string {
  const token = randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${token}`;
}

/* ─── GET: список правил автоматизації ─── */
export const GET = withActor(async (req: NextRequest) => {
  try {
    const sql = getSql();
    const siteId = new URL(req.url).searchParams.get('site_id');
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 });

    const rules = await sql.rows(`
      SELECT r.*,
             COUNT(p.id) AS total_codes,
             SUM(CASE WHEN p.current_uses > 0 THEN 1 ELSE 0 END) AS used_codes
      FROM gift_card_automation_rules r
      LEFT JOIN coupons p ON p.gift_card_rule_id = r.id
      WHERE r.site_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `, [siteId]);

    return NextResponse.json({ rules });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

/* ─── POST: створити правило + згенерувати промокоди ─── */
export const POST = withPermission('manage_sites', async (req: NextRequest) => {
  try {
    const sql = getSql();
    const body = await req.json();
    const {
      site_id,
      template_id,
      count = 10,
      discount_type = 'percentage',
      offer_amount,
      valid_from,
      valid_until,
      min_nights,
      max_nights,
      allowed_days,
      applies_to = 'listings',
      redemption_limit = 1,
      rule_name,
    } = body;

    if (!site_id) return NextResponse.json({ error: 'site_id required' }, { status: 400 });
    if (!offer_amount && offer_amount !== 0) return NextResponse.json({ error: 'offer_amount required' }, { status: 400 });
    if (count < 1 || count > 500) return NextResponse.json({ error: 'count must be 1-500' }, { status: 400 });

    const tpl = template_id ? getGiftCardTemplate(template_id) : null;
    const resolvedName = rule_name || tpl?.name || 'Автоматизований ваучер';

    // Зберегти правило
    const ruleId = `vr_${Date.now()}`;
    await sql.run(`
      -- organization_id, from the site. Left to the column DEFAULT it was
      -- NULL on SQLite: the rule was created and then invisible to its hotel.
      INSERT INTO gift_card_automation_rules
        (id, organization_id, site_id, template_id, name, discount_type, offer_amount,
         valid_from, valid_until, min_nights, max_nights,
         allowed_days, applies_to, redemption_limit, generated_count, created_at)
      VALUES (?,(SELECT organization_id FROM booking_sites WHERE id = ?),?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `, [
      ruleId, site_id, site_id, template_id || null, resolvedName,
      discount_type, Number(offer_amount),
      valid_from || null, valid_until || null,
      min_nights ? Number(min_nights) : null,
      max_nights ? Number(max_nights) : null,
      allowed_days ? JSON.stringify(allowed_days) : null,
      applies_to, Number(redemption_limit), Number(count),
    ]);

    // Визначити prefix для кодів з шаблону
    const prefix = tpl ? tpl.id.toUpperCase().slice(0, 4) : 'CMPN';

    // Генерувати промокоди в транзакції
    // organization_id, from the site — see the note on the rule insert above.
    const INSERT_PROMO = `
      INSERT INTO coupons
        (id, organization_id, code, discount_type, offer_amount,
         valid_from, valid_until, min_nights, max_nights,
         max_uses, redemption_limit, site_id, allowed_days,
         applies_to, is_active, gift_card_rule_id, created_at)
      VALUES (?,(SELECT organization_id FROM booking_sites WHERE id = ?),?,?,?,?,?,?,?,?,?,?,?,?,TRUE,?,CURRENT_TIMESTAMP)
    `;

    const generated: string[] = [];
    await sql.tx(async (t) => {
      let attempts = 0;
      while (generated.length < count && attempts < count * 3) {
        attempts++;
        const code = generateCampaignToken(prefix);
        const exists = await t.row('SELECT id FROM coupons WHERE code = ?', [code]);
        if (exists) continue;
        const pid = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await t.run(INSERT_PROMO, [
          pid, site_id, code, discount_type, Number(offer_amount),
          valid_from || null, valid_until || null,
          min_nights ? Number(min_nights) : null,
          max_nights ? Number(max_nights) : null,
          Number(redemption_limit), Number(redemption_limit),
          site_id,
          allowed_days ? JSON.stringify(allowed_days) : null,
          applies_to, ruleId,
        ]);
        generated.push(code);
      }
    });

    return NextResponse.json({
      rule_id: ruleId,
      generated: generated.length,
      codes: generated,
    }, { status: 201 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/gift-cards/workflow error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

/* ─── DELETE: видалити правило + його промокоди ─── */
export const DELETE = withPermission('manage_sites', async (req: NextRequest) => {
  try {
    const sql = getSql();
    const ruleId = new URL(req.url).searchParams.get('rule_id');
    if (!ruleId) return NextResponse.json({ error: 'rule_id required' }, { status: 400 });

    // Не видаляти вже використані коди — лише деактивувати
    await sql.run(`UPDATE coupons SET is_active = FALSE WHERE gift_card_rule_id = ? AND current_uses = 0`, [ruleId]);
    await sql.run(`DELETE FROM gift_card_automation_rules WHERE id = ?`, [ruleId]);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
