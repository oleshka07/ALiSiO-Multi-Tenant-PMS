/**
 * Бронь із воріт: тримає номер, доки гість не підтвердив — і не довше.
 *
 * ── Чого тут навмисно НЕМАЄ ─────────────────────────────────────────────
 *
 * Немає другого двигуна бронювання. Односерверна PMS, з якої взято цей екран,
 * створює бронь у `booking-drafts`: він дізнається орендаря через
 * `SELECT … FROM properties LIMIT 1` (інваріант 1 дослівно) і вставляє рядок
 * без `organization_id`. Скопіювати це означало б завести бронь, якої не
 * бачить жоден орендар.
 *
 * Немає й виклику `widget-reserve`, хоч план називав саме його. Причина
 * зʼясувалася при читанні: той хендлер прив'язаний до САЙТУ — `withSite`
 * вимагає рядка в `sites`, а далі йдуть CORS, перевірка домену-джерела,
 * рукостискання і `site_rate_plans`. Гостьовий застосунок сайтом не є: його
 * орендаря називає ключ у адресі (0414), тарифи в нього обʼєктні
 * (`rate_plans`), а домену-джерела немає взагалі. Прив'язати ворота до
 * фіктивного рядка в `sites` означало б завести готелю сайт, якого він не
 * заводив, — і зламати його налаштування віджета.
 *
 * Замість копії взято ті самі ЧАСТИНИ, якими користується `widget-reserve`:
 *
 *   `insertingStay` (`@bookings/overlap`) — двоє не вʼїжджають в один номер:
 *     Postgres тримає `EXCLUDE`, SQLite серіалізує писачів;
 *   `freeUnitsForRange` (`@properties`) — вільні кімнати з ємнісним тиском;
 *   `calculateQuote` (`@pricing`) — ціна, і лише вона (інваріант 16);
 *   `noteAvailabilityChanged` (`@channels/outbox`) — канал дізнається про
 *     зайняті ночі в ТІЙ САМІЙ транзакції (інваріант 11, гейт
 *     `check-outbox-writers`).
 *
 * ── Ціну називає сервер ─────────────────────────────────────────────────
 *
 * Сума в тілі запиту не читається взагалі. Її не «перевіряють» — її немає:
 * поле, яке приймають і звіряють, рано чи пізно звіряють не з тим, а поля,
 * якого немає, підмінити нічим. Котирування рахується тут заново, на тих
 * самих датах і тому самому тарифі.
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { freeUnitsForRange } from '@properties/kernel';
import { calculateQuote } from '@pricing/quote';
import { noteAvailabilityChanged, lastNight } from '@channels/outbox';
import { insertingStay, UnitOverlap } from '@bookings/overlap';
import { activeConsentTexts, recordConsent } from '@guests/kernel';
import { GUEST_APP_CONSENTS, missingConsents, blocks } from '../domain/consents';
import { priceServices, type ServicePick } from './services.repo';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';
import { holdUntil } from '../domain/hold';

/** Рід походження броні (docs/NAMING.md): ворота готелю, не канал продажу. */
export const GUEST_APP_SOURCE = 'guest_app';

export interface HoldRequest {
  organizationId: string;
  propertyId: string;
  unitTypeId: string;
  /** `null` — базова ціна типу, як і в пропозиції. */
  ratePlanId: string | null;
  from: string;
  to: string;
  adults: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  /** Мова, якою гість читає застосунок, — нею ж потім говоритиме лист. */
  lang: string;
  /**
   * Галочки, які гість поставив: пара «рід + версія».
   *
   * Версія тут не формальність — див. `missingConsents`: галочка під старою
   * редакцією не є згодою на нову, а саме так виглядає вкладка, відкрита до
   * того, як готель оновив умови.
   */
  consents: readonly { kind: string; version: string }[];
  /** Що гість додав до номера. Ціни тут немає — її бере довідник. */
  services: readonly ServicePick[];
}

export interface HeldStay {
  reservationId: string;
  /** Токен гостьової сторінки — далі гість ходить лише за ним. */
  token: string;
  unitName: string;
  /** Сума за ПРОЖИВАННЯ — те, що поїде в `reservations.total_price`. */
  total: number;
  /**
   * Сума послуг — ОКРЕМО, і це не косметика відповіді.
   *
   * Послуги живуть рядками `service_orders` і потрапляють у фоліо власним
   * шляхом. Долити їх у `total_price` броні означало б порахувати їх двічі:
   * раз у сумі броні, раз у рахунку. Гість бачить обидва числа й підсумок.
   */
  servicesTotal: number;
  currency: string;
  nights: number;
  holdExpiresAt: string;
}

const id = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Токен гостьової сторінки — 128 біт із криптографічного джерела.
 *
 * Не `Math.random().toString(36)`, як у віджеті: це посилання-перепустка, за
 * яким видно імʼя, дати й суму, і воно єдине, що стоїть між гостем і чужим
 * перебуванням. `Math.random` передбачуваний за кількома значеннями.
 */
const newToken = () => crypto.randomBytes(16).toString('hex');

/**
 * Взяти номер під бронь і тримати його до `hold_expires_at`.
 *
 * Викликається ВСЕРЕДИНІ `runWithOrganization` — орендаря називає ключ у
 * адресі, а не тіло запиту (інваріанти 1 і 8).
 *
 * Відмови названі й усі 4xx: чужий або непродажний тип — 404 (інваріант 5),
 * зайнято або немає ціни — 409 з реченням, яке ми написали самі (інваріант 6).
 */
export async function holdStay(req: HoldRequest): Promise<HeldStay> {
  const sql = getSql();

  if (!(req.to > req.from)) refuse('Дата виїзду має бути пізнішою за дату заїзду', 400);
  if (!Number.isInteger(req.adults) || req.adults < 1) refuse('Скільки гостей — не названо', 400);
  const firstName = req.firstName.trim();
  const lastName = req.lastName.trim();
  const phone = req.phone.trim();
  if (!firstName || !lastName) refuse('Імʼя і прізвище потрібні обидва', 400);
  if (!phone) refuse('Потрібен номер телефону — ним готель звʼяжеться з вами', 400);

  // Тип — свого обʼєкта, свого орендаря і дозволений до продажу онлайн.
  // Чужий id віддає 404, а не 403: інакше відповідь підтверджує, що такий
  // тип десь існує (інваріант 5).
  const type = await sql.row<{ id: string; name: string }>(
    `SELECT ut.id, ut.name
       FROM unit_types ut
       JOIN properties p ON p.id = ut.property_id
      WHERE ut.id = ? AND ut.property_id = ? AND p.organization_id = ?
        AND ut.bookable_online = TRUE`,
    [req.unitTypeId, req.propertyId, req.organizationId]);
  if (!type) refuse('Такого номера немає', 404);

  // Тариф — теж свого обʼєкта, і саме той, який гість МІГ побачити: знятий із
  // продажу або прихований у пропозиції не показувався, тож посилання на
  // нього означає або стару вкладку, або підставлений id.
  if (req.ratePlanId) {
    const plan = await sql.row<{ id: string }>(
      `SELECT rp.id FROM rate_plans rp
         JOIN properties p ON p.id = rp.property_id
        WHERE rp.id = ? AND rp.property_id = ? AND p.organization_id = ?
          AND rp.is_active = TRUE AND rp.is_hidden = FALSE`,
      [req.ratePlanId, req.propertyId, req.organizationId]);
    if (!plan) refuse('Цей тариф більше не продається', 404);
  }

  const units = await sql.rows<{ id: string; name: string }>(
    'SELECT id, name FROM units WHERE unit_type_id = ? AND property_id = ? ORDER BY name',
    [type.id, req.propertyId]);
  const free = await freeUnitsForRange(units.map((u) => u.id), req.from, req.to);
  const unit = units.find((u) => free.has(u.id));
  // Порожньо — відмова, не «поселимо кудись» (інваріант 13). Зразок, з якого
  // знято цей екран, у цьому місці селив у зайняте, «щоб бронь не загубилась»;
  // тут такий INSERT просто відхилить no_double_booking, і гість дістав би 500
  // замість речення.
  if (!unit) refuse('Цей номер щойно зайняли. Оберіть інший або інші дати', 409);

  // Ціну називає сервер, і рахує її те саме, що показувало пропозицію.
  const quote = await calculateQuote(type.id, req.from, req.to, req.adults, 0,
    { ratePlanId: req.ratePlanId });
  if (!quote.hasPricing || quote.missingDays > 0) {
    refuse('На ці дати ціну не названо — зателефонуйте, будь ласка, на рецепцію', 409);
  }

  // Умови — ПЕРЕД записом. Бронь, під якою ніхто нічого не прийняв, це рядок,
  // який нема чим накрити перед наглядачем; а відмовити після створення
  // означало б лишити по собі напівбронь, що тримає номер.
  const texts = await activeConsentTexts(req.organizationId, req.lang, GUEST_APP_CONSENTS);
  const missing = missingConsents(texts, req.consents);
  if (missing.length > 0) refuse('Щоб забронювати, потрібно прийняти умови готелю', 400);

  // Послуги оцінює ДОВІДНИК, і робить це до запису: гість має дізнатись про
  // відмову замість того, щоб дістати бронь без половини замовленого.
  //
  // Розбіжність у кількості — названа відмова, а не тиха втрата: послуга,
  // яку готель щойно зняв із продажу, зникла б із рахунку мовчки, і гість
  // побачив би це аж на виїзді.
  const priced = await priceServices(req.organizationId, req.propertyId, req.services);
  if (priced.lines.length !== req.services.length) {
    refuse('Одна з обраних послуг більше не продається. Оновіть сторінку', 409);
  }

  const reservationId = id('r');
  let guestRowId = '';
  const token = newToken();
  const expires = holdUntil();

  try {
    await insertingStay(async () => {
      await sql.tx(async (t) => {
        const guestId = id('g');
        await t.run(
          `INSERT INTO guests (id, organization_id, first_name, last_name, phone, email, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [guestId, req.organizationId, firstName, lastName, phone, req.email, GUEST_APP_SOURCE]);

        // organization_id названо явно, не лишено на DEFAULT: той DEFAULT —
        // механізм Postgres (0005), а на SQLite рядок ліг би з порожнім
        // орендарем, тобто був би невидимим геть для всіх (інваріант 12).
        await t.run(
          `INSERT INTO reservations (
             id, organization_id, property_id, unit_id, unit_type_id, rate_plan_id, guest_id,
             check_in, check_out, nights, adults, children,
             status, payment_status, source, total_price, currency,
             guest_page_token, hold_expires_at, booking_lang
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'tentative', 'unpaid', ?, ?, ?, ?, ?, ?)`,
          [reservationId, req.organizationId, req.propertyId, unit.id, type.id, req.ratePlanId, guestId,
            req.from, req.to, quote.nights, req.adults,
            GUEST_APP_SOURCE, quote.total, quote.currency,
            token, expires, req.lang]);

        // Канал дізнається в ТІЙ САМІЙ транзакції: черга, що поповнюється
        // окремим кроком, розходиться зі станом при першому ж падінні між
        // ними (інваріант 11).
        await noteAvailabilityChanged(t, {
          propertyId: req.propertyId, unitTypeId: type.id,
          from: req.from, to: lastNight(req.to),
        });

        guestRowId = guestId;

        // Послуги — тією ж транзакцією, що й бронь: рядок замовлення, який
        // ліг окремим кроком, лишається сиротою при першому ж падінні між
        // ними, і рецепція побачить послугу без броні.
        //
        // `confirmed` за станом і `none` за оплатою: гість справді це
        // замовив (це не «заявка на розгляд»), а платить на рецепції — КІ1.
        for (const line of priced.lines) {
          await t.run(
            `INSERT INTO service_orders (id, reservation_id, service_id, quantity, total_price, status, payment_status)
             VALUES (?, ?, ?, ?, ?, 'confirmed', 'none')`,
            [id('so'), reservationId, line.serviceId, line.quantity, line.total]);
        }
      });
    }, { unitId: unit.id, checkIn: req.from, checkOut: req.to, reservationId });
  } catch (e) {
    // Обмеження бази спрацювало між нашою перевіркою і записом — той самий
    // випадок, що й порожній список вище, тож і речення те саме: гість не має
    // бачити двох різних відмов на одну причину.
    if (e instanceof UnitOverlap) refuse('Цей номер щойно зайняли. Оберіть інший або інші дати', 409);
    throw e;
  }

  // Згоди — ПІСЛЯ броні й поза її транзакцією, і це не недбалість.
  // `recordConsent` посилається на рядок гостя, тобто раніше писати нічого;
  // а класти його всередину означало б, що збій запису згоди відкочує бронь,
  // яка вже тримає номер. Прийняте гостем при цьому не губиться: рід, версія
  // і джерело їдуть рядком у журнал, а не залежать від нашої транзакції.
  //
  // Пишуться ВСІ прийняті роди, не лише ті, що тримали кнопку: добровільна
  // згода на розсилку — теж згода, і доводиться вона тим самим рядком.
  for (const text of texts) {
    const ticked = req.consents.some(
      (c) => c.kind === text.consentKind && c.version === text.version);
    if (!ticked) continue;
    try {
      await recordConsent({
        organizationId: req.organizationId, guestId: guestRowId,
        consentKind: text.consentKind, version: text.version, source: GUEST_APP_SOURCE,
      });
    } catch (e) {
      console.error('[guest-app] згода не записалась', reservationId, text.consentKind, e);
      // Рід, що тримав кнопку, не записався — отже лишилась би бронь, під
      // якою НІЧОГО не прийнято, і саме її ми щойно заборонили створювати.
      // Тому бронь знімається, номер повертається в продаж, а гість дістає
      // відмову: напівстану, у якому кімната зайнята невідомо за що, не буває.
      //
      // Необовʼязковий рід (розсилка) так не робить: втрачена галочка «хочу
      // листи» не варта скасованої броні. Вона лишається в лозі.
      if (blocks(text.consentKind)) {
        await sql.run(
          `UPDATE reservations SET status = 'cancelled', hold_expires_at = NULL
            WHERE id = ? AND organization_id = ?`, [reservationId, req.organizationId]);
        refuse('Не вдалося зафіксувати згоду з умовами. Спробуйте ще раз', 409);
      }
    }
  }

  return {
    reservationId,
    token,
    unitName: unit.name,
    total: quote.total,
    servicesTotal: priced.total,
    currency: quote.currency,
    nights: quote.nights,
    holdExpiresAt: expires,
  };
}

/**
 * Гість підтвердив: бронь стає справжньою, і строк із неї знімається.
 *
 * Повертає `false`, якщо підтверджувати вже нічого — строк минув і номер
 * звільнено. Це не помилка: це рівно те, що бачить гість, який відклав
 * телефон на годину, і сказати йому треба про кімнату, а не про код 409.
 */
export async function confirmStay(token: string): Promise<boolean> {
  const sql = getSql();
  // Вісь обʼєкта тут ALL_PROPERTIES, і це рішення, а не пропуск: гість
  // приходить із ТОКЕНОМ, а токен — 128 біт, унікальний на всю базу
  // (idx_reservations_guest_token). Він і називає бронь; питати на додачу
  // «а з якого ти обʼєкта» нічого не звужує — токен уже назвав і обʼєкт, і
  // номер. Орендаря при цьому названо зовні, у хендлері (ключ у адресі).
  const stayByToken = propertyScopeFilter(ALL_PROPERTIES, '');
  // Орендар названий у запиті, не лише в контексті: на Postgres його тримає
  // політика, а на SQLite політик немає — і SQLite це вся розробка й уся CI,
  // що піднімає застосунок (рід INC-014). Порожній контекст тут означав би
  // підтвердження чужої броні за вгаданим токеном.
  const org = currentOrganizationId();
  if (!org) refuse('Не знайдено', 404);
  const row = await sql.row<{ id: string; status: string }>(
    `SELECT id, status FROM reservations
      WHERE guest_page_token = ? AND organization_id = ? AND ${stayByToken.sql}`,
    [token, org, ...stayByToken.params]);
  if (!row) return false;
  // Уже підтверджена — підтвердження повторне (гість оновив сторінку), і це
  // успіх, а не відмова: інакше кнопка «назад» у браузері виглядала б як
  // втрачена бронь.
  if (row.status !== 'tentative') return row.status !== 'cancelled';

  const changed = await sql.run(
    `UPDATE reservations
        SET status = 'confirmed', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ? AND status = 'tentative'`, [row.id, org]);
  // Умова статусу стоїть і в UPDATE: між читанням і записом строк міг минути,
  // і крон уже скасував бронь. Нуль змінених рядків — саме цей випадок.
  return changed.changes > 0;
}
