import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';

/**
 * Тариф, який бачить лише своя фірма (INC-205, CORE-GAPS п.1).
 *
 * ── Що це за річ у готелю ───────────────────────────────────────────────
 *
 * У Ґрайца `PREISCODE 3 Firmenpreise` — не знижка, а ОКРЕМИЙ ПРАЙС, і це
 * доводять його ж числа: `SD 80,10` проти `84 × 0,9 = 75,60`. Якби це була
 * знижка, вони збіглися б. Поруч живуть прайс-коди 8 і 10 — по одному на
 * конкретну фірму (`MATCHC FIRMA_B_DZD_1/2`).
 *
 * Тобто фірмовий тариф буває двох родів, і обидва в одній базі:
 *
 *   «для всіх фірм»    — один тариф, багато фірм (код 3, ~10 фірм);
 *   «для цієї фірми»   — один тариф, одна фірма (коди 8, 10).
 *
 * Саме тому звʼязок — таблиця, а не колонка: колонка виражає лише другий
 * рід, а перший довелося б розмножити по разу на кожну фірму. Повний довід —
 * у міграції 0200 і в К22.
 *
 * ── Ознака «це фірмовий тариф» — ЗВʼЯЗОК, а не `is_hidden` ──────────────
 *
 * `is_hidden` існував до цієї роботи і робить своє: не пускає тариф у канал.
 * Але він НЕ каже, чия це ціна, і ставиться галочкою руками. Якби варта
 * трималась на ньому, тариф фірми без галочки продавався б кожному — тобто
 * захист залежав би від того, чи не забув оператор клацнути.
 *
 * Тому правило стверджує ВЛАСТИВІСТЬ, а не візерунок: **тариф, у якого є хоч
 * один звʼязок із фірмою, продається лише звʼязаним фірмам.** Тариф без
 * звʼязків — звичайний, його видимість вирішує `is_hidden`, як і раніше.
 * Другого механізму публікації в канал тут немає і не треба.
 *
 * ── Чому чужий тариф — 404, а не 403 ────────────────────────────────────
 *
 * Інваріант 5. `403` стверджував би «тариф твій, але цією бронню не
 * продається» — інша обіцянка, і вона неправдива: тариф фірми Б для фірми А
 * не «її, але недоступний», а просто не її. Той самий вибір, що в INC-203:
 * номер чужого будинку — чужий id.
 */

/** Тариф, який платник може купити. Форма — та, що потрібна екрану вибору. */
export interface PayerRatePlan {
  id: string;
  code: string;
  name: string;
  currency: string;
  /** `true` — тариф належить фірмам, і цей платник у їх числі. */
  companyOnly: boolean;
}

/**
 * Тарифи обʼєкта, які МОЖЕ купити цей платник.
 *
 * `companyId = null` — гість платить сам: фірмових тарифів не бачить жодного.
 * Тариф із звʼязками бачить лише звʼязана фірма; решта — за `is_hidden`, як
 * було до цієї зміни.
 *
 * Порожній список — нормальна відповідь (обʼєкт без тарифів, чужий обʼєкт).
 */
export async function ratePlansForPayer(
  propertyId: string, organizationId: string, companyId: string | null,
): Promise<PayerRatePlan[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT rp.id, rp.code, rp.name, rp.currency, rp.is_hidden,
            (SELECT COUNT(*) FROM company_rate_plans crp
              WHERE crp.rate_plan_id = rp.id AND crp.organization_id = ?) AS company_links,
            (SELECT COUNT(*) FROM company_rate_plans crp
              WHERE crp.rate_plan_id = rp.id AND crp.organization_id = ? AND crp.company_id = ?) AS mine
       FROM rate_plans rp
       JOIN properties p ON p.id = rp.property_id
      WHERE rp.property_id = ? AND p.organization_id = ? AND rp.is_active = TRUE
      ORDER BY rp.priority, rp.code`,
    [organizationId, organizationId, companyId ?? '', propertyId, organizationId],
  ) as Record<string, unknown>[];

  const out: PayerRatePlan[] = [];
  for (const row of rows) {
    const links = Number(row.company_links) || 0;
    const mine = Number(row.mine) || 0;
    // Твердження про КІЛЬКІСТЬ, а не про перший знайдений рядок (AGENTS §7):
    // тариф може належати кільком фірмам, і `.find()` тут залежав би від
    // порядку, який Postgres і SQLite не зобовʼязані тримати однаковим.
    if (links > 0) {
      if (mine === 0) continue;               // фірмовий, але не цього платника
      out.push({ id: String(row.id), code: String(row.code), name: String(row.name), currency: String(row.currency), companyOnly: true });
      continue;
    }
    // Звичайний тариф: прихований лишається прихованим, як і був.
    if (row.is_hidden === true || Number(row.is_hidden) === 1) continue;
    out.push({ id: String(row.id), code: String(row.code), name: String(row.name), currency: String(row.currency), companyOnly: false });
  }
  return out;
}

/**
 * Чи може цей платник купити цей тариф — і названа відмова, якщо ні.
 *
 * Це ПИСАЧ правила, а не читач: список вище звужує те, що показують, а сюди
 * приходить `rate_plan_id`, який назвали ззовні. Полагодити лише список
 * означало б лишити двері, крізь які фірмову ціну дістає будь-хто, хто знає
 * ідентифікатор тарифу, — рівно той клас, за який ми вже платили тричі
 * (INC-201…203: читач полагоджений, писач відчинений).
 *
 * Порожній `ratePlanId` — не помилка: тариф не обовʼязковий.
 */
export async function assertRatePlanForPayer(
  ratePlanId: string | null | undefined, organizationId: string, companyId: string | null,
): Promise<void> {
  if (!ratePlanId) return;
  const sql = getSql();

  // Вісь обʼєкта тут НОСІЙ, а не обмеження (INC-029): питання «чи цей платник
  // може купити цей тариф» — про фірму, і фірма заведена на рахунок, а не на
  // будинок. Тариф однієї фірми може стояти на будь-якому обʼєкті готелю, і
  // звузити цей запит будинком означало б відмовляти фірмі на її ж тарифі,
  // щойно готель заведе другий обʼєкт. Орендаря тримає джойн нижче.
  const anyHouse = propertyScopeFilter(ALL_PROPERTIES, 'p');

  const row = await sql.row<any>(
    `SELECT (SELECT COUNT(*) FROM company_rate_plans crp
              WHERE crp.rate_plan_id = rp.id AND crp.organization_id = ?) AS company_links,
            (SELECT COUNT(*) FROM company_rate_plans crp
              WHERE crp.rate_plan_id = rp.id AND crp.organization_id = ? AND crp.company_id = ?) AS mine
       FROM rate_plans rp
       JOIN properties p ON p.id = rp.property_id
      WHERE rp.id = ? AND p.organization_id = ? AND ${anyHouse.sql}`,
    [organizationId, organizationId, companyId ?? '', ratePlanId, organizationId, ...anyHouse.params],
  ) as Record<string, unknown> | undefined;

  // Немає рядка — відмовляємо, а не дозволяємо (інваріант 13). Тариф чужої
  // організації сюди теж не проходить: джойн звіряє обʼєкт з орендарем.
  if (!row) throw refuse('Тариф не знайдено', 404);

  const links = Number(row.company_links) || 0;
  if (links === 0) return;                    // звичайний тариф — не наша справа
  if ((Number(row.mine) || 0) > 0) return;    // фірмовий, і фірма та сама

  // Той самий текст і той самий статус, що на неіснуючий тариф: інакше
  // відповідь сама каже, що тариф існує і чийсь — тобто стає оракулом того
  // самого роду, що INC-047.
  throw refuse('Тариф не знайдено', 404);
}
