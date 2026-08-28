import { NextResponse } from 'next/server';
import { currentActor } from '@core/auth/session';
import { runWithOrganization } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { listFeatures } from '@core/features';
import { LANGUAGES, LANGUAGE_CODES } from '@core/i18n/languages';

/**
 * Хто я, що вміє мій готель — і чому це читається В КОНТЕКСТІ ОРЕНДАРЯ.
 *
 * ── Чим це ламалося ─────────────────────────────────────────────────────
 *
 * `currentActor()` встановлює ОСОБУ. Орендаря він не встановлює — це робить
 * `runWithOrganization`, і саме воно кладе `app.organization_id` на
 * зʼєднання. Без нього кожен scoped-читач нижче ходить у Postgres із
 * порожнім орендарем, політика не бачить жодного рядка, і запит повертає
 * НЕ помилку, а порожньо.
 *
 * Для `listFeatures` це найгірший із можливих наслідків: `hasFeature`
 * читає «рядка немає» як «бери дефолт». Тобто готель вимикав «Зали» і
 * «Аркуші дня», рядки лягали в базу правильно — а цей маршрут відповідав
 * дефолтами `FEATURE_SPEC`, тобто `events: true, day_sheets: true`.
 *
 * Наслідок бачив оператор: пункти лишались у меню і розділи відкривались,
 * бо меню й заслінка вірять цій відповіді. Дані при цьому не текли — самі
 * маршрути (`withModule`) ходять через справжню варту й відмовляли 403, —
 * тож екран був порожній, а не чужий. Неправду казала оболонка.
 *
 * Тим самим мовчанням поверталось `countries: []` — жодної країни, хоча
 * обʼєкт у готелю є. Юрисдикційні екрани (Evidenční kniha) читають саме це.
 *
 * Витік був би, якби політики не було: на SQLite у розробника той самий код
 * прочитав би ВСІ організації. Тому це не косметика — це інваріант 11
 * (орендар належить зʼєднанню) і інваріант 4 (власна перевірка сесії в тілі
 * хендлера вартою не є) в одному місці.
 */
export async function getMe() {
  try {
    // Through currentActor, not the cookie: this is also how the screen
    // learns it is being shown to the supplier standing inside a customer's
    // account. Reading session_id directly answered 401 for that case, and the
    // dashboard bounced back to the login it had just come from.
    const actor = await currentActor();

    if (!actor) {
      return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
    }
    const user = actor.user;

    // Усе, що нижче, — scoped-читання, тож воно йде в контексті орендаря.
    // Одна обгортка на обидва блоки, а не по одній на кожен: орендар лежить
    // на зʼєднанні, і два `runWithOrganization` поспіль означали б лише два
    // однакові налаштування, а забутий третій блок — знову тиху порожнечу.
    let features: Record<string, boolean> = {};
    let organization: { currency: string; countries: string[] } | null = null;

    if (user.organization_id) {
      await runWithOrganization(user.organization_id, async () => {
        // The same registry the routes enforce — the sidebar only mirrors it.
        features = await listFeatures(user.organization_id!);

        // What the organization IS: its currency, and which countries its
        // properties stand in. Jurisdiction-bound UI (the Czech Evidenční
        // kniha, currency labels on reports) reads this instead of assuming
        // the first customer's answers.
        const sql = getSql();
        const org = await sql.row<any>(
          'SELECT default_currency FROM organizations WHERE id = ?', [user.organization_id]);
        const props = await sql.rows<any>(
          'SELECT DISTINCT country FROM properties WHERE organization_id = ? AND country IS NOT NULL',
          [user.organization_id]);
        organization = {
          // `organizations.default_currency` — NOT NULL, тож рядок організації
          // завжди її має. Порожньо буває лише тоді, коли самої організації
          // немає, і тоді екран не має чим підписувати суми — це чесніше за
          // здогадку. Тут стояло `|| 'EUR'`, тоді як решта коду вгадувала
          // 'CZK': два різні припущення про одного клієнта в одній системі.
          currency: org?.default_currency ? String(org.default_currency) : '',
          countries: props.map((p) => String(p.country).toUpperCase()).filter(Boolean),
        };
      });
    }

    // The effective language is already resolved on the session (person, else
    // hotel); it is repeated at the top level so the client does not have to
    // know the precedence rule to render a language switch.
    return NextResponse.json({
      user,
      features,
      organization,
      language: user.language,
      languages: LANGUAGE_CODES.map((code) => ({ code, native: LANGUAGES[code].native })),
      // Present only for the supplier working inside a customer. The screen
      // keeps saying whose data is on it; nothing else changes.
      platform: actor.platform ? { email: actor.platform.email } : null,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
