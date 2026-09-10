/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { ALL_PROPERTIES, oneProperty, propertyScopeFilter } from '@core/property-scope';
import { withSite, type SiteRow } from '@widget';

/**
 * GET /api/public/availability — які дати вже зайняті, для календаря віджета.
 *
 * Query params:
 *   site_id       – сайт бронювання. ОБОВʼЯЗКОВИЙ, див. нижче
 *   unit_id       – конкретний юніт
 *   unit_type_id  – тип юніта (усі юніти цього типу)
 *   from / to     – YYYY-MM-DD
 *
 * Повертає: { bookedRanges: [{check_in, check_out}], bookedDates: string[] }
 *
 * ── Чому тут зʼявився withSite ──────────────────────────────────────────
 *
 * Цей маршрут читав `reservations` БЕЗ жодного контексту орендаря — єдиний
 * такий серед тринадцяти публічних; решта делегують у `@widget`, де орендар
 * береться з ключа сайту.
 *
 * На SQLite політик немає, тож у розробці все виглядало правильно. На
 * Postgres — ні, і найгіршим способом. Холодне зʼєднання дає
 * `unrecognized configuration parameter`, тобто 500. Але зʼєднання з ПУЛУ,
 * якому вже ставили орендаря, читає параметр як порожній рядок, який не
 * збігається ні з чим: запит повертає нуль рядків БЕЗ помилки.
 *
 * Порожній список зайнятих дат календар малює як «вільно все». Тобто
 * помилка не падала, не логувалась і показувала гостю неправду — саме той
 * клас, про який AGENTS.md §7 попереджає окремо.
 *
 * `withSite` — той самий шов, що й у `getAvailability`: `booking_sites`
 * читається до орендаря (в її політиці є `OR current_setting(…) = ''`),
 * організація береться звідти, і далі все йде під `runWithOrganization`.
 *
 * ── Чому site_id тепер обовʼязковий ─────────────────────────────────────
 *
 * Інваріант 8: публічний endpoint без ідентифікатора орендаря відмовляє, а
 * не вгадує. `withSite(null, …)` падає на `requireOrganizationId()`, щойно
 * готелів більше одного, — і це правильна відповідь: сказати «зайнятих дат
 * немає» замість «я не знаю, чий це календар» гірше за 404.
 *
 * Тег `<script data-site="…">` цей параметр уже вміє передавати; embed без
 * нього тепер отримує чесну відмову замість тихої неправди.
 */
const CORS = { 'Access-Control-Allow-Origin': '*' };

/**
 * ── І чому самого орендаря мало ─────────────────────────────────────────
 *
 * Сайт належить ОБʼЄКТУ (`booking_sites.property_id` — `NOT NULL`), а `unit_id`
 * і `unit_type_id` приходять із адреси, тобто від того, хто питає. Орендаря
 * тримає `withSite`, а обʼєкт не тримало ніщо: віджет на сайті будинку А,
 * підставивши номер будинку Б того самого рахунку, діставав його зайнятість —
 * і бачив, коли в сусідньому готелі гості.
 *
 * Це друга половина INC-034: там сайт обʼєкта А ПРОДАВАВ номер обʼєкта Б, і
 * запис уже закрито; читання лишалось відкритим. Календар — це те, з чого
 * продаж починається, тож пів заборони тут не буває.
 *
 * ── Чому область береться з САЙТА, а не з адреси ────────────────────────
 *
 * Скрізь в екранах область каже оператор (`?property_id=…`) і `withOwner`
 * доводить, що обʼєкт його. Тут питає гість, і питати його про обʼєкт нема
 * сенсу: він не знає такого слова, а якби знав — це був би той самий
 * ідентифікатор із адреси, тобто нічого не доводив би. Обʼєкт тут доведено
 * ІНШИМ способом (інваріант 4, друге речення): ключем сайту, який уже назвав
 * орендаря.
 *
 * `ALL_PROPERTIES` лишається рівно на одному шляху, і він старий: віджет,
 * вбудований ДО того, як зʼявились сайти, шле запит без `site_id`, і
 * `withSite` бере єдиний готель сервера (див. `site.repo.ts`). Сайту немає —
 * немає й обʼєкта, який він назвав би; орендар при цьому тримається так само.
 * Мовчазним дефолтом це не є: гілка написана словом і має свою причину.
 *
 * Невідомий номер відповідає порожнім календарем, а не 404: адреса публічна, і
 * різниця між «немає такого номера» і «він вільний увесь рік» тут на користь
 * того, хто питає, — вона не розкриває, що в сусіда взагалі є такий номер.
 */
async function bookedFor(req: NextRequest, site: SiteRow | undefined): Promise<NextResponse> {
  const url = new URL(req.url);
  const unit_id      = url.searchParams.get('unit_id');
  const unit_type_id = url.searchParams.get('unit_type_id');

  if (!unit_id && !unit_type_id) {
    return NextResponse.json({ error: 'unit_id or unit_type_id required' }, { status: 400, headers: CORS });
  }

  const today = new Date();
  const fromStr = url.searchParams.get('from') || today.toISOString().split('T')[0];
  const toDate  = new Date(today); toDate.setDate(toDate.getDate() + 365);
  const toStr   = url.searchParams.get('to') || toDate.toISOString().split('T')[0];

  const sql = getSql();
  // Обʼєкт САЙТА, не «якийсь із рахунку». Колонка `NOT NULL`, тож сайт є —
  // обʼєкт названо; сайту немає — це той самий старий віджет, що вище.
  const scope = site ? oneProperty(String(site.property_id)) : ALL_PROPERTIES;
  const axisR = propertyScopeFilter(scope, 'r');
  const axisU = propertyScopeFilter(scope, 'u');

  let rows: any[];

  try {
    if (unit_id) {
      rows = await sql.rows<any>(`
        SELECT r.check_in, r.check_out FROM reservations r
        WHERE r.unit_id = ? AND ${axisR.sql}
          AND r.status NOT IN ('cancelled','no_show')
          AND r.check_out > ? AND r.check_in < ?
        ORDER BY r.check_in
      `, [unit_id, ...axisR.params, fromStr, toStr]);
    } else {
      // All units of this unit_type
      const units = await sql.rows<any>(
        `SELECT u.id FROM units u WHERE u.unit_type_id = ? AND ${axisU.sql}`,
        [unit_type_id!, ...axisU.params]);
      if (units.length === 0) return NextResponse.json({ bookedRanges: [], bookedDates: [] }, { headers: CORS });
      const placeholders = units.map(() => '?').join(',');
      const ids = units.map((u: any) => u.id);
      // Обʼєкт названо ВДРУГЕ, хоч номери вже відібрані попереднім запитом:
      // твердження, яке тримається на сусідньому запиті, ламається тихо,
      // щойно хтось перепише той запит. Тут воно коштує один параметр.
      rows = await sql.rows<any>(`
        SELECT r.check_in, r.check_out FROM reservations r
        WHERE r.unit_id IN (${placeholders}) AND ${axisR.sql}
          AND r.status NOT IN ('cancelled','no_show')
          AND r.check_out > ? AND r.check_in < ?
        ORDER BY r.check_in
      `, [...ids, ...axisR.params, fromStr, toStr]);
    }

    // Expand ranges to individual booked dates
    const bookedSet = new Set<string>();
    for (const r of rows) {
      let d = new Date(r.check_in + 'T00:00:00');
      const end = new Date(r.check_out + 'T00:00:00');
      while (d < end) {
        bookedSet.add(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }
    }

    const res = NextResponse.json({
      bookedRanges: rows.map((r: any) => ({ check_in: r.check_in, check_out: r.check_out })),
      bookedDates: Array.from(bookedSet).sort(),
    });

    // Allow cross-origin (embed widget on external sites)
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Cache-Control', 'public, max-age=300'); // 5 min cache
    return res;
  } catch (e: any) {
    console.error('[public/availability]', e?.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500, headers: CORS });
  }
}

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('site_id');
  const answer = await withSite(key, (site) => bookedFor(req, site));
  // null означає рівно одне: ключ не назвав жодного сайту (або його немає, а
  // готелів більше одного). Відповідь мусить нести CORS, інакше браузер
  // покаже віджету мережеву помилку замість 404 і причина загубиться.
  return answer ?? NextResponse.json({ error: 'Unknown site' }, { status: 404, headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    },
  });
}
