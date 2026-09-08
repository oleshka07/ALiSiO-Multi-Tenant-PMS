/**
 * Курс для показу: один запит, одна відповідь, і нуля в ній не буває.
 *
 *   node src/core/currency.rates.check.ts
 *
 * Написано ДО реалізації і мусило бути червоним (інваріант 24). Сусідній
 * `currency.check.ts` читає ТЕКСТ файлів (запасні значення, точність, одне
 * джерело курсу) — тут навпаки, жива база й чотири питання:
 *
 *   1. `displayRates()` віддає базову валюту курсом 1 і кожну оголошену — її
 *      останнім курсом;
 *   2. оголошена валюта БЕЗ курсу в мапі відсутня. Не нуль і не одиниця:
 *      «курсу немає» — це інваріант 17, застосований до курсу, і показати
 *      «≈ 0 EUR» гірше, ніж не показати нічого;
 *   3. прохід ČNB не чіпає валюту, курс якої готель зафіксував сам
 *      (`rate_source = 'manual'`), і оновлює ту, що позначена `cnb`. Це і є
 *      «фіксований курс на сайті» з П19: фіксує його ГОТЕЛЬ, а не банк;
 *   4. валюти й курси сусіда не існують.
 *
 * Фікстура не вироджена по осях (інваріант 26): ДВА джерела курсу в одного
 * готелю (`manual` і `cnb`), РІЗНІ числа курсу (25 проти 30 з фіксингу), і
 * ДВА орендарі з різними базовими валютами (CZK і EUR) — з однаковою базою
 * «курс до бази» і «курс до крон» невідрізнювані.
 */
import assert from 'node:assert';
import '../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const fx = await import('./currency.ts');
const { syncCnbRates } = await import('./fx/cnb.ts');

const sql = getSql();
const ORG = '__fx_check__org';
const OTHER = '__fx_check__other';

async function cleanup() {
  for (const org of [ORG, OTHER]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM finance_exchange_rates WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM organization_currencies WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'FX', ORG]);
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'EUR')", [OTHER, 'FX2', OTHER]);

try {
  // ── 1–2. Оголошена з курсом і оголошена без курсу ─────────────────────
  await runWithOrganization(ORG, async () => {
    await fx.setSecondaryCurrencies(ORG, [
      { code: 'EUR', rateSource: 'manual' },
      { code: 'USD', rateSource: 'cnb' },
    ]);
    // Курс лише в EUR: USD оголошений, але його ніхто не називав.
    await fx.setManualRate(ORG, 'EUR', 'CZK', 25.5, '2026-09-01');

    const rates = await fx.displayRates(ORG);
    assert.strictEqual(rates.base, 'CZK', 'база — валюта організації');
    assert.strictEqual(rates.rates.CZK, 1, 'база сама до себе — рівно одиниця');
    assert.strictEqual(rates.rates.EUR, 25.5, 'оголошена валюта мала прийти зі своїм курсом');
    assert.ok(!('USD' in rates.rates),
      'валюта без курсу отримала число — «курсу немає» це відсутність, а не нуль (інваріант 17)');
    assert.deepStrictEqual(rates.missing, ['USD'],
      'валюта без курсу має бути НАЗВАНА окремо — інакше екран не знає, що спитати в готелю');
    console.log('  ok  курс є там, де його назвали; де не назвали — відсутній, а не нуль');
  });

  // ── 3. Прохід ČNB не чіпає те, що готель зафіксував сам ───────────────
  await runWithOrganization(ORG, async () => {
    // Фіксинг підставлений: жодної мережі, і число НАВМИСНО інше за ручні
    // 25.5 — інакше «оновив» і «не чіпав» дають однакову базу.
    const fixing = { date: '2026-09-06', rates: { EUR: 30, USD: 22 } };
    const result = await syncCnbRates({ organizationId: ORG, fixing, date: '2026-09-06' });

    const after = await fx.displayRates(ORG);
    assert.strictEqual(after.rates.EUR, 25.5,
      'курс, зафіксований готелем, переписав банк — на сайті зʼявилась ціна за курсом, якого готель не називав');
    assert.strictEqual(after.rates.USD, 22,
      'валюта з джерелом cnb не отримала курсу банку — тоді джерело не значить нічого');
    assert.ok(!result.upserted.includes('EUR'),
      'прохід узагалі писав EUR — рішення готелю мало спинити його ДО запису, а не після');
    console.log('  ok  фіксований курс готелю сильніший за фіксинг банку, а cnb-валюта оновлюється');
  });

  // ── 4. Сусід не існує ─────────────────────────────────────────────────
  await runWithOrganization(OTHER, async () => {
    await fx.setSecondaryCurrencies(OTHER, [{ code: 'CZK', rateSource: 'manual' }]);
    await fx.setManualRate(OTHER, 'CZK', 'EUR', 0.04, '2026-09-01');
    const mine = await fx.displayRates(OTHER);
    assert.strictEqual(mine.base, 'EUR', 'база другого готелю — його власна');
    assert.strictEqual(mine.rates.CZK, 0.04, 'свій курс на місці');
    assert.ok(!('USD' in mine.rates),
      'валюта сусіда потрапила в мій показ — таблиця читається без орендаря');
    // І в `missing` теж: валюта сусіда БЕЗ курсу не дає числа, тож у мапі її
    // не видно, і читання без орендаря лишилось би непоміченим. Саме на цьому
    // злам «прибрати WHERE organization_id» спершу ПРОЙШОВ.
    assert.deepStrictEqual(mine.missing, [],
      'у показі сусіда названо валюту, якої він не оголошував — перелік читається без орендаря');
  });
  await runWithOrganization(ORG, async () => {
    const mine = await fx.displayRates(ORG);
    assert.strictEqual(mine.rates.EUR, 25.5, 'мій курс змінився від запису сусіда');
  });
  console.log('  ok  валюти й курси сусіда не існують для показу');

  // ── Готель без основної валюти: НАЗВАНА відмова, не «щось зламалось» ──
  //
  // Це поведінкова половина твердження, яке в `currency.check.ts` лишилось
  // статичним (рецензія 07.09 раунд 7, П3). Важливі обидві частини: виклик
  // справді відхиляється — і відхилення розпізнається як НАША відмова, бо
  // саме на цій різниці стоїть `handleError`: інакше текст пішов би клієнтові
  // поряд із будь-якою помилкою драйвера, яка прийде тим самим шляхом.
  //
  // Через яку двері сюди можна зайти. `organizations.default_currency` має
  // `NOT NULL DEFAULT 'CZK'`, тож «рядок є, валюти немає» звичайним `INSERT`
  // не робиться — лишаються два справжні шляхи: організації немає взагалі
  // (той, що нижче) і порожній рядок від невдалого `UPDATE`. Перевіряємо
  // обидва: перший — реальний стан, другий — те, що `NOT NULL` не ловить.
  const NOCUR = `${ORG}_nocur`;
  await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, '')", [NOCUR, 'No currency', NOCUR]);
  try {
    const { isRefusal } = await import('@core/http/refusal');
    let caught: unknown;
    await runWithOrganization(NOCUR, async () => {
      try { await fx.organizationCurrency(NOCUR); } catch (e) { caught = e; }
    });
    let missing: unknown;
    try { await fx.organizationCurrency(`${ORG}_absent`); } catch (e) { missing = e; }
    assert.ok(isRefusal(missing), 'організації, якої немає, теж відмовляють названо');
    assert.ok(caught, 'готель без основної валюти мусить дістати відмову, а не число');
    assert.ok(isRefusal(caught), 'і відмова мусить бути НАЗВАНОЮ — інакше `handleError` не відрізнить її від помилки драйвера');
    assert.strictEqual((caught as { status: number }).status, 409, 'статус 409: запит правильний, це стан організації не дозволяє відповісти');
    assert.match(String((caught as Error).message), /основна валюта/i, 'і текст мусить казати оператору, куди йти');
    console.log('  ok  готель без основної валюти: названа відмова 409, а не вгадане число');
  } finally {
    await sql.run('DELETE FROM organizations WHERE id = ?', [NOCUR]);
  }

  console.log('currency-rates: курс для показу має одну відповідь, і нуля в ній немає');
} finally {
  await cleanup();
}
