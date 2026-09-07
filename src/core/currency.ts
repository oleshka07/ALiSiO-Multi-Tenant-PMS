import { getSql } from '@core/db/async';
import { refuse } from './http/refusal';
import { todayFor } from '@core/hotel-day';
import { money } from '@core/money';

/**
 * У якій валюті працює цей готель — і в яких ще він показує суми.
 *
 * ── Навіщо окремий файл ─────────────────────────────────────────────────
 *
 * Валюта в коді була написана 174 рази, і 77 із них — запасним значенням
 * виду `row.currency || 'CZK'`. Тобто щоразу, коли база не сказала валюти,
 * код вирішував, що це чеські крони. Німецький готель отримував суму в
 * євро з підписом CZK — не «майже правильно», а неправильно: 4200 EUR і
 * 4200 CZK це різні гроші, і на фактурі це різні зобовʼязання.
 *
 * Запасного значення тут немає й не буде. Це той самий інваріант 17
 * («ціни, якої немає, не існує»), застосований до валюти: суму, валюти якої
 * ми не знаємо, не можна ні показати, ні записати. Правильна відповідь —
 * відмова, і вона голосна.
 *
 * ── Основна і другорядні ────────────────────────────────────────────────
 *
 * ОСНОВНА (`organizations.default_currency`) — та, у якій готель веде
 * бухгалтерію: ціни, фоліо, фактури, звіти. Обирається під час створення
 * готелю й змінюється в налаштуваннях. Змінити її не означає перерахувати
 * історію: наявні документи вже несуть свою валюту рядком, і саме тому
 * несуть.
 *
 * ДРУГОРЯДНІ (1–3, `organization_currencies`) — ті, у яких готель ПОКАЗУЄ
 * суми: гостю у віджеті, партнеру у звіті. Курс до основної береться з
 * `finance_exchange_rates` — тієї самої таблиці для ручного й автоматичного
 * курсу. Два джерела курсу дали б два різні числа на одному екрані, як
 * чотири цикли по днях колись давали чотири різні ціни (інваріант 16).
 */

/** Скільки другорядних валют має сенс. Більше — це вже мультивалютний облік. */
export const MAX_SECONDARY_CURRENCIES = 3;

/**
 * Звідки береться курс цієї валюти.
 *
 * `manual` — людина вписала число в налаштуваннях; воно лягло в
 * `finance_exchange_rates` рядком із датою і живе, доки його не змінять.
 * `cnb` — денний фіксинг Чеського нацбанку (`cron/sync-cnb-rates`).
 *
 * НБУ і ЄЦБ сюди додадуться так само — рядком тут і джерелом у кроні. Поки
 * їх немає, вибирати їх не можна: список, що обіцяє те, чого немає, гірший
 * за короткий.
 */
export type RateSource = 'manual' | 'cnb';

export interface SecondaryCurrency {
  code: string;
  rateSource: RateSource;
  /** Курс до основної валюти на сьогодні, або null — якщо його ще не внесли. */
  rate: number | null;
  /** Дата курсу — щоб екран міг сказати «курс від 26 серпня», а не мовчати. */
  rateDate: string | null;
}

/**
 * Основна валюта готелю. Відмовляє, якщо її немає.
 *
 * Відмовляє навмисно. Порожня `default_currency` означає зламаний рядок
 * організації, і підставити замість неї будь-що — значить пустити далі суму,
 * про яку ніхто вже не дізнається, що вона в невідомій валюті.
 *
 * `refuse`, а не голий `Error` (рецензія 07.09 раунд 7, П3): це повідомлення
 * написали ми і воно каже оператору, що робити, — тож `catch` мусить уміти
 * відрізнити його від помилки драйвера, яка прийде тим самим шляхом (обидва
 * читання тут ходять у базу). Статус 409, а не 400: запит правильний, це стан
 * організації не дозволяє відповісти.
 */
export async function organizationCurrency(organizationId: string): Promise<string> {
  const sql = getSql();
  const org = await sql.row<{ default_currency?: string }>(
    'SELECT default_currency FROM organizations WHERE id = ?', [organizationId]);
  if (org?.default_currency) return String(org.default_currency);
  refuse(
    `У організації ${organizationId} не задана основна валюта. `
    + 'Налаштування → Загальні → Основна валюта.', 409);
}

/**
 * Другорядні валюти з поточним курсом до основної.
 *
 * Порожній список — нормальний стан: готель, який працює в одній валюті,
 * не мусить нічого налаштовувати.
 */
export async function secondaryCurrencies(organizationId: string): Promise<SecondaryCurrency[]> {
  const sql = getSql();
  const base = await organizationCurrency(organizationId);

  const rows = await sql.rows<{ code: string; rate_source: string }>(
    `SELECT code, rate_source FROM organization_currencies
      WHERE organization_id = ? ORDER BY sort_order, code`,
    [organizationId]);

  const out: SecondaryCurrency[] = [];
  for (const r of rows) {
    const fx = await latestRate(organizationId, String(r.code), base);
    out.push({
      code: String(r.code),
      rateSource: r.rate_source === 'cnb' ? 'cnb' : 'manual',
      rate: fx?.rate ?? null,
      rateDate: fx?.date ?? null,
    });
  }
  return out;
}

/**
 * Найсвіжіший курс `from` → `to`, не пізніший за `onDate`.
 *
 * `<=`, а не `=`: курс вноситься не щодня, і вимога точного збігу означала б
 * «курсу немає» в кожен вихідний. Назад у часі — можна: фактура вчорашнього
 * дня має рахуватись вчорашнім курсом, і саме тому таблиця має історію.
 */
export async function latestRate(
  organizationId: string,
  from: string,
  to: string,
  onDate?: string,
): Promise<{ rate: number; date: string } | null> {
  if (from === to) return { rate: 1, date: onDate ?? await todayFor(organizationId) };
  const sql = getSql();
  const row = await sql.row<{ rate: number; effective_from: unknown }>(
    `SELECT rate, effective_from FROM finance_exchange_rates
      WHERE organization_id = ? AND from_currency = ? AND to_currency = ?
        AND effective_from <= ?
      ORDER BY effective_from DESC
      LIMIT 1`,
    [organizationId, from, to, onDate ?? await todayFor(organizationId)]);
  if (!row) return null;
  return { rate: Number(row.rate), date: isoDay(row.effective_from) };
}

/**
 * Сума в іншій валюті — або null, якщо курсу немає.
 *
 * null, а не приблизне число. Показати «≈ 170 EUR», порахувавши за курсом,
 * якого готель не називав, — це те саме, що продати ніч за ціною, якої не
 * називали (інваріант 17). Екран, який отримав null, каже «курс не заданий»
 * і веде в налаштування; це чесно й полагоджується за хвилину.
 */
export async function convert(
  organizationId: string,
  amount: number,
  from: string,
  to: string,
  onDate?: string,
): Promise<number | null> {
  const fx = await latestRate(organizationId, from, to, onDate);
  if (!fx) return null;
  // Округлення тут навмисно НЕ робиться: це показ, а не запис. Усе, що
  // лягає в базу, проходить через money() (інваріант 9) на місці запису.
  return amount * fx.rate;
}

/**
 * Замінити список другорядних валют цілим.
 *
 * Запис живе ТУТ, а не в хендлері, і це не стиль. Храповик меж спіймав саме
 * це: поки `organization_currencies` писав `@properties`, таблиця ставала
 * власністю того модуля — і читання з `core/currency.ts` рахувалось пробоєм у
 * нього. Що правильно як діагноз: валюта не належить модулю обʼєктів, вона
 * наскрізна. Отже, і читає, і пише її core; хендлер лишається тим, чим має
 * бути, — поверхнею HTTP із правами й валідацією.
 *
 * Цілим списком, а не по одній: «додати/прибрати» двома маршрутами дає стан,
 * у якому екран показує одне, база інше.
 */
export async function setSecondaryCurrencies(
  organizationId: string,
  list: { code: string; rateSource: RateSource }[],
): Promise<void> {
  const sql = getSql();
  await sql.tx(async (t) => {
    // Курси у finance_exchange_rates НЕ чіпаються: валюту можуть прибрати й
    // повернути, а історія курсів належить документам, уже виписаним за нею.
    await t.run('DELETE FROM organization_currencies WHERE organization_id = ?', [organizationId]);
    for (let i = 0; i < list.length; i++) {
      await t.run(
        `INSERT INTO organization_currencies (organization_id, code, rate_source, sort_order)
         VALUES (?, ?, ?, ?)`,
        [organizationId, list[i].code, list[i].rateSource, i]);
    }
  });
}

/**
 * Курси для ПОКАЗУ — одна відповідь на «у чому ще ми показуємо суми».
 *
 * ── Чому це окремі двері, а не `secondaryCurrencies()` ──────────────────
 *
 * `secondaryCurrencies()` описує НАЛАШТУВАННЯ: перелік із джерелом і датою,
 * як його бачить екран. Показ гостю питає інше — «на скільки множити», — і
 * додає базу (курс 1), якої в переліку немає за означенням. Два різні
 * питання з однієї функції означали б, що вітрина сама вирішує, що робити
 * з базою й порожнім курсом, а таких вітрин уже три.
 *
 * ── Валюта БЕЗ курсу відсутня, а не нуль ────────────────────────────────
 *
 * Це інваріант 17, застосований до курсу. «≈ 0 EUR» гірше за відсутність:
 * нуль виглядає як факт, і саме таким його показує будь-який `||`. Тому
 * `missing` називає такі валюти окремо — щоб екран сказав «курс не заданий»
 * і повів у налаштування, а не мовчав.
 *
 * ── Фіксований курс — це курс, який назвав ГОТЕЛЬ ────────────────────────
 *
 * П19 каже «кілька валют із фіксованим курсом на сайті». Фіксує його готель
 * (`rate_source = 'manual'`), і прохід ČNB такі валюти не чіпає взагалі
 * (`fx/cnb.ts`). Другої колонки курсу для цього не заводиться: курс живе в
 * `finance_exchange_rates` і лише там (ARCHITECTURE §2.2.1) — інакше два
 * джерела розійшлися б тихо, і жодне з них не було б неправильним на вигляд.
 */
export interface DisplayRates {
  /** Валюта обліку. Ціна, бронь, фоліо й документ — завжди в ній (О6). */
  base: string;
  /** код → скільки одиниць БАЗИ коштує одиниця цієї валюти. База — 1. */
  rates: Record<string, number>;
  /** Оголошені валюти, курсу яких готель ще не назвав. */
  missing: string[];
}

export async function displayRates(organizationId: string, onDate?: string): Promise<DisplayRates> {
  const base = await organizationCurrency(organizationId);
  const sql = getSql();
  const rows = await sql.rows<{ code: string }>(
    `SELECT code FROM organization_currencies
      WHERE organization_id = ? ORDER BY sort_order, code`,
    [organizationId]);

  const rates: Record<string, number> = { [base]: 1 };
  const missing: string[] = [];
  for (const r of rows) {
    const code = String(r.code);
    if (code === base) continue;
    const fx = await latestRate(organizationId, code, base, onDate);
    if (fx) rates[code] = fx.rate;
    else missing.push(code);
  }
  return { base, rates, missing };
}

/** Чи оголошена ця валюта в готелі — і з яким джерелом курсу. */
export async function declaredCurrency(
  organizationId: string,
  code: string,
): Promise<{ rateSource: RateSource } | null> {
  const sql = getSql();
  const row = await sql.row<{ rate_source: string }>(
    'SELECT rate_source FROM organization_currencies WHERE organization_id = ? AND code = ?',
    [organizationId, code]);
  if (!row) return null;
  return { rateSource: row.rate_source === 'cnb' ? 'cnb' : 'manual' };
}

/**
 * Вписати курс руками — у ту саму таблицю, куди пише крон.
 *
 * `money(rate, 8)`, а НЕ `money(rate)`. Інваріант 9 — про суму, не про курс:
 * два знаки за замовчуванням перетворили б 24.53750000 на 24.54, тобто
 * тридцять крон з нічого на рахунку в 300 000. Колонка — NUMERIC(18,8),
 * стільки ж бере крон ČNB.
 */
export async function setManualRate(
  organizationId: string,
  from: string,
  to: string,
  rate: number,
  onDate: string,
): Promise<void> {
  const sql = getSql();
  await sql.run(
    `INSERT INTO finance_exchange_rates (organization_id, from_currency, to_currency, rate, effective_from)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, from_currency, to_currency, effective_from)
     DO UPDATE SET rate = excluded.rate`,
    [organizationId, from, to, money(rate, 8), onDate]);
}

/** `effective_from` — TEXT у SQLite і DATE у Postgres. */
function isoDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}
