# Форми PMS: що на екрані, що в базі, і де це в коді

**Знімок на коміт `6948768f` (гілка `beta`, 12.09.2026).** Усі посилання нижче
прибиті до цього коміта, тож номери рядків не «попливуть» від наступного пуша.
Щоб подивитись поточний стан — заміни `6948768f` на `beta` в адресі.

Документ зроблено для роботи над **дизайном**: він каже, які вікна є, які поля в
кожному, які поля вже існують у базі й уже кимось пишуться, але місця на екрані
не мають, і де саме в коді це подивитись. Він **не** каже, як має виглядати
результат — це вирішує дизайн.

> **Як перевірити, а не повірити.** Кожен список полів витягнутий із коду
> грепом, не з памʼяті. Якщо щось не сходиться — вигравати має код:
> `grep -n "form-label\|placeholder=" <файл>` для екрана,
> `awk '/CREATE TABLE "<таблиця>" \(/,/^\);/' db/postgres/schema.sql` для бази.

---

## 1. Карта екранів

| Екран | Адреса в застосунку | Десктоп | Мобільний |
|---|---|---|---|
| Список броней | `/app/bookings` | `bookings/page.tsx` | `MobileBookings.tsx` |
| **Форма броні** (створення/правка) | модалка з `/app/bookings` і `/app/calendar` | `BookingForm.tsx` | той самий компонент |
| **Картка броні** (перегляд) | модалка звідти ж | `BookingViewModal.tsx` | `MobileBookingDetail.tsx` |
| Список гостей | `/app/guests` | `guests/page.tsx` | `MobileGuests.tsx` |
| **Картка гостя** (створення/правка) | модалка з `/app/guests` | там само | там само |
| **Компанії** | `/app/guests/companies` | `companies/page.tsx` | той самий |
| **Книга гостей** (Evidenční kniha) | `/app/guest-registry` | `guest-registry/page.tsx` | той самий |
| **Гостьовий портал** (самореєстрація) | `/guest/<token>` — публічний | `guest/[token]/page.tsx` | той самий, адаптивний |

Мобільна версія вмикається хуком `useDevice()` у самій сторінці
(`if (isMobile) return <MobileBookings … />`), тобто це **два різні компоненти**,
а не одна адаптивна розмітка. Дизайн треба давати на обидва — інакше половина
змін не доїде до телефона.

---

## 2. Форма броні (створення і правка)

**Файл:** [`src/components/booking/BookingForm.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx)
· 929 рядків
**Тип значень форми:** [L16–L37](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx#L16-L37)
**Пише:** `POST /api/bookings` (створення), `PATCH /api/bookings/[id]` (правка)

Одна довга колонка з пʼяти блоків. Порядок блоків саме такий у коді:

### 2.1 Розміщення і дати (без заголовка, перший блок)

| Підпис на екрані | Ключ | Колонка в базі | Обовʼязкове | Нотатки |
|---|---|---|---|---|
| Категорія | `category` | — (визначає список типів) | так | заповнюється з довідника готелю, не з коду |
| Тип розміщення | `unitTypeId` | `reservations.unit_type_id` | так | |
| Юніт | `unitId` | `reservations.unit_id` | на правці — так | на створенні є пункт «Автоматично (перший вільний)» |
| Джерело | `source` | `reservations.source` | ні | довідник `booking_sources` |
| Заїзд | `checkIn` | `reservations.check_in` | так | |
| Виїзд | `checkOut` | `reservations.check_out` | так | підпис уточнює «ніч виїзду не входить» |
| Дорослих | `adults` | `reservations.adults` | ні (дефолт 1) | впливає на ціну і на збір |
| Дітей | `children` | `reservations.children` | ні | |

[L578–L680](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx#L578-L680)

### 2.2 «Дані гостя» ([L686–L755](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx#L686-L755))

| Підпис | Ключ | Колонка | Обовʼязкове | Нотатки |
|---|---|---|---|---|
| Імʼя | `firstName` | `guests.first_name` | так | |
| Прізвище | `lastName` | `guests.last_name` | так | під ним живий пошук |
| **(пошук гостя)** | `pickedGuest` | `reservations.guest_id` | — | `GuestPicker` шукає за прізвищем; обраний заповнює 4 поля, але лишає їх редагованими |
| Email | `email` | `guests.email` | ні | |
| Телефон | `phone` | `guests.phone` | ні | |
| **Платник — фірма** | `pickedCompany` | `reservations.company_id` + знімок `invoice_company_*` | ні | `CompanyPicker`, пошук по `GET /api/companies?search=`; порожньо = платить гість |
| **Прейскурант** | `ratePlanId` | `reservations.rate_plan_id` | ні | `RatePlanPicker`; список залежить від обраної фірми |

Компоненти-пікери: [`GuestPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/GuestPicker.tsx) ·
[`CompanyPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/CompanyPicker.tsx) ·
[`RatePlanPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/RatePlanPicker.tsx)

### 2.3 «💰 Фінанси» ([L757–L845](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx#L757-L845))

| Підпис | Ключ | Колонка | Нотатки |
|---|---|---|---|
| Сума | `totalPrice` | `reservations.total_price` | на створенні плейсхолдер «авто з прайсингу»; поруч індикатор «рахуємо…» і попередження, якщо якусь ніч ніхто не оцінив |
| Комісія | `commissionAmount` | `reservations.commission_amount` | підказує авто-відсоток джерела |
| Статус | `status` | `reservations.status` | 6 пунктів: чернетка, очікується, підтверджено, заселено, виселено, скасовано |
| Статус оплати | `paymentStatus` | `reservations.payment_status` | 5 пунктів; **«Частково оплачено» вимкнене** — його рахують гроші, не оператор ([чому — L96–L107](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx#L96-L107)) |

Валюти в формі немає навмисно: вона в готелю, а не в броні.

### 2.4 «🏛️ Туристичний збір» ([L849–L888](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx#L849-L888))

Блок **не показується взагалі**, якщо в готелю ставка збору нульова.

| Підпис | Ключ | Колонка |
|---|---|---|
| Сума збору | `cityTaxAmount` | `reservations.city_tax_amount` |
| Статус збору | `cityTaxPaid` | `reservations.city_tax_paid` (`pending` / `paid` / `exempt`) |
| Збір входить у ціну | `cityTaxIncluded` | `reservations.city_tax_included` |

### 2.5 «📝 Примітки»

| Підпис | Ключ | Колонка |
|---|---|---|
| Внутрішні примітки | `internalNotes` | `reservations.internal_notes` |

### 2.6 Чого у формі НЕМАЄ, хоч колонка є

Все це вже пишеться — каналом, віджетом, імпортом або іншим екраном:

| Колонка | Хто пише сьогодні | Чи варта екрана |
|---|---|---|
| `notes` (примітка, яку бачить гість) | канал, віджет | так — портьє не має де її прочитати чи змінити |
| `infants` | ніхто | навряд; або прибрати |
| `deposit_amount`, `deposit_status`, `deposit_paid_at` | ніхто в UI | так, якщо готель бере депозит |
| `lodging_discount_percent`, `lodging_discount_reason` | картка броні (окремий блок) | вже є, але не у формі створення |
| `breakfast_included` | картка броні, вкладка «Фінанси» | вже є |
| `meal_plan`, `cancellation_policy` | екран тарифів | належить тарифу, не броні |
| `is_pool_unit` | код (INC-045) | ні, службове |
| `registration_status` | рахується з реєстрацій | ні, похідне |
| `guest_page_token`, `guest_page_expires_at` | сервер | ні |
| `utm_*`, `ga_client_id`, `widget_session_id`, `booking_lang`, `country_code` | віджет | ні, аналітика |
| `hostex_*`, `total_rate_eur`, `commission_eur`, `net_rate_eur`, `channel_remarks`, `is_prepaid`, `is_multi_room`, `multi_room_marker` | канал | лише читання, і воно вже є на картці |
| `parent_id`, `external_uid`, `external_ref`, `promotions_applied`, `payment_id` | код | ні |

Повний список колонок: [`schema.sql` L1941–L2016](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1941-L2016)

---

## 3. Картка броні (перегляд і дії)

**Файл:** [`src/components/booking/BookingViewModal.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx)
· **1824 рядки** — найбільша форма продукту й головний кандидат на впорядкування.

Зверху — шапка (гість, дати, будинок, джерело, сума), під нею **смуга «наступної
дії»** (одна кнопка з пріоритетом: прийняти оплату / зареєструвати / заселити /
виселити), під нею **чотири вкладки**
([L893–L896](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L893-L896)):

| Вкладка | Ключ | Бейдж | Що всередині |
|---|---|---|---|
| Проживання | `stay` | `N/M` зареєстрованих | реєстрація гостей, збір, підброні |
| Фінанси | `finance` | `%` оплати | платежі, фактура, компанія, сніданок, знижка |
| Файли | `files` | кількість | вкладення |
| Історія змін | `audit` | — | лише тим, хто має право |

### 3.1 Вкладка «Фінанси» ([L916+](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L916))

- **Три числа згори:** Всього / Оплачено / Залишок.
- **Форма платежу** ([L987–L1044](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L987-L1044)):
  сума · спосіб (готівка / картка / …) · вид (передплата / часткова / …) · примітка.
  Готівка йде в касу як факт, решта — позначка статусу; це написано прямо у формі.
- **Список транзакцій** з видаленням.
- **🥐 Сніданок у ціні** — три стани: «За правилом готелю» / «Так» / «Ні»
  (`breakfast_included`, [L1096–L1106](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L1096-L1106)).
- **🏢 На компанію** ([L1130–L1210](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L1130-L1210)) —
  РАЗОВИЙ бланк, сім полів: назва компанії\*, IČO, DIČ, адреса, місто, країна, email
  (`reservations.invoice_company_*`). Стерта назва знімає й `company_id` (Д79).
- **`PayerPicker`** ([`card/PayerPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/card/PayerPicker.tsx)) —
  вибір фірми з довідника: `<select>` «Гість (фізособа)» + список, плюс два поля
  для швидкого заведення нової (назва, IČO).
  **Відомий біль:** тягне ВЕСЬ довідник у `<select>` без пошуку (ARCHITECTURE §8 «Лишається»).
- **🏷 Знижка на проживання** — швидкі кнопки відсотків + своє число + причина (`lodging_discount_percent`, `lodging_discount_reason`), [L1053–L1090](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L1053-L1090).
- **Фактура** — згенерувати / оновити, попередження, якщо сума фактури ≠ сумі броні.

### 3.2 Вкладка «Проживання» ([L1228+](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L1228))

- Смуга прогресу «зареєстровано N з M» + кнопка **📄 Meldeschein**.
- **Список зареєстрованих** ([L1269–L1300](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L1269-L1300)):
  кожен рядок із ⭐ **заявника** (кнопка «Зробити заявником» — саме його прізвище
  йде на Meldeschein) і видаленням.
- **Форма «➕ Гість #N»** — див. розділ 6.
- **Туристичний збір** — картка зі станом (очікує / оплачено / звільнено) і розрахунком
  «N дор. × M ноч. × ставка».
- **Підброні** (групове бронювання) — список із мітками й видаленням.

### 3.3 Мобільна картка

[`MobileBookingDetail.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/MobileBookingDetail.tsx)
· 1070 рядків. Своя, скорочена: ті самі дії, але вкладок немає — акордеони.
Форма реєстрації гостя там теж своя ([L857–L890](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/MobileBookingDetail.tsx#L857-L890)),
з тими самими полями в компактнішій сітці.

---

## 4. Картка гостя

**Файл:** [`src/app/app/(dashboard)/guests/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/page.tsx)
**Порожня форма (усі ключі):** [L124–L135](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/page.tsx#L124-L135)
**Поля:** [L364–L465](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/page.tsx#L364-L465)
**Пише:** `POST /api/guests`, `PATCH /api/guests/[id]`

| Підпис | Ключ | Колонка | Нотатки |
|---|---|---|---|
| Імʼя \* | `firstName` | `guests.first_name` | |
| Прізвище \* | `lastName` | `guests.last_name` | |
| Звернення | `salutation` | `guests.salutation` | вільний текст: «пан / пані / Dr.» — закритий словник закодував би одну юрисдикцію |
| По-батькові | `middleName` | `guests.middle_name` | |
| Email | `email` | `guests.email` | |
| Телефон | `phone` | `guests.phone` | |
| Номер авто | `vehiclePlate` | `guests.vehicle_plate` | підказка «для паркінгу й шлагбаума» |
| Країна | `country` | `guests.country` | |
| Місто | `city` | `guests.city` | |
| Адреса | `address` | `guests.address` | |
| Тип документа | `documentType` | `guests.document_type` | |
| Номер документа | `documentNumber` | `guests.document_number` | |
| Дата народження | `dateOfBirth` | `guests.date_of_birth` | |
| Примітки | `notes` | `guests.notes` | |

### 4.1 Чого в картці НЕМАЄ, хоч колонка є і писач є

Це найцікавіший список для дизайну — тут не треба нічого вигадувати в базі:

| Колонка | Стан | Що бракує |
|---|---|---|
| `is_vip` | колонка є, **маршрут-писач є** (`PATCH /api/guests/[id]/flags`), мобільний список **малює корону** | **немає жодного контролю, щоб її поставити** — ні на десктопі, ні на мобільному |
| `blacklisted_at` / `blacklisted_by` / `blacklist_reason` | те саме: писач вимагає причину (400 без неї), автора ставить сервер | немає екрана. Потрібен діалог «заблокувати» з обовʼязковою причиною і показ «ким і коли» |
| `whatsapp` | **є в мапі полів `updateGuest`** — тобто API прийме | поля у формі немає |
| `language` | те саме | те саме; це мова листів гостю |
| `nationality` | пишуть реєстрація і портал | у картці гостя не показується й не редагується, хоч на Meldeschein їде саме вона |
| `gender` | колонка з CHECK (`female`/`male`/`other`) | не пише ніхто й ніде не видно |
| `merged_into`, `merged_at`, `merged_by` | злиття дублікатів | у картці не видно, що гість — злитий слід |
| `source`, `external_ref` | імпорт/канал | службове, лише читання |

Колонки: [`schema.sql` L1349–L1383](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1349-L1383)
Мапа полів, які приймає правка: [`guests.repo.ts` L184–L193](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/modules/guests/data/guests.repo.ts#L184-L193)
Писач прапорців: [`guest-flags.repo.ts`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/modules/guests/data/guest-flags.repo.ts)

### 4.2 Мобільна картка гостя

[`MobileGuests.tsx` L69–L81](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/mobile/pages/MobileGuests.tsx#L69-L81) —
**інший набір полів**: тут є `nationality`, але немає `salutation`, `middleName`,
`vehiclePlate`, `dateOfBirth`. Дві форми одного обʼєкта розійшлись; це теж робота
для дизайну — вирішити один канонічний набір.

---

## 5. Компанії

**Файл:** [`src/app/app/(dashboard)/guests/companies/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/companies/page.tsx)
**Поля форми:** [L353–L366](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/companies/page.tsx#L353-L366)
**Пише:** `POST /api/companies`, `PATCH /api/companies/[id]`

Сітка у дві колонки; поля, позначені `span: 2`, займають рядок цілком.

| Підпис | Колонка | Ширина |
|---|---|---|
| Назва \* | `companies.name` | 2 |
| ID компанії (IČO) | `business_id` | 1 |
| ДІЧ / VAT ID | `vat_id` | 1 |
| Реєстраційний номер | `registry_no` | 2 |
| Вулиця | `address_street` | 2 |
| Індекс | `address_zip` | 1 |
| Місто | `address_city` | 1 |
| Країна | `address_country` | 1 |
| Email | `email` | 1 |
| Телефон | `phone` | 1 |
| Банк | `bank_name` | 1 |
| IBAN | `iban` | 1 |
| BIC / SWIFT | `bic` | 1 |
| Примітки | `notes` | 2, textarea |

**У списку компаній** є фільтри-чипи (є контакт / є банк / є гості / показати архівні),
пошук «Назва, ID або ДІЧ», і на кожному рядку — **«Показати гостей фірми»**:
розгортає список людей, які жили за рахунок цієї фірми, з лічильником перебувань
і посиланням у картку гостя.

**Чого немає у формі:** `debtor_no` (номер дебітора, ставить система),
`payment_terms_days` (відстрочка платежу — **колонка є, екрана немає**),
`archived_at` (архівація окремою дією), `external_ref`.
Колонки: [`schema.sql` L515–L539](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L515-L539)

---

## 6. Реєстрація гостя на рецепції (усередині картки броні)

**Де:** картка броні → вкладка «Проживання» → «➕ Гість #N»
**Код:** [`BookingViewModal.tsx` L1306–L1416](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx#L1306-L1416)
**Пише:** `POST /api/bookings/[id]/registrations` → таблиця `reservation_guests`
(книга гостей) + `guest_registrations` (журнал згоди)

Сітка 2 колонки, плюс кнопка **📷 Фото документа** (OCR) над полями.

| Підпис | Ключ | Колонка в `reservation_guests` | Обовʼязкове |
|---|---|---|---|
| Прізвище \* | `lastName` | `last_name` | так |
| Імʼя \* | `firstName` | `first_name` | так |
| Дата народження | `dateOfBirth` | `date_of_birth` | ні — але від неї залежить звільнення від збору (діти) |
| Тип документа | `documentType` | `document_type` | ні |
| Номер документа \* | `documentNumber` | `document_number` | так |
| Національність | `nationality` | `nationality` | ні — від неї залежить «іноземець» і UbyPort |
| Країна (код) | `country` | пише в `guests.country` | ні |
| Адреса | `address` | `address` | ні, на всю ширину |
| **Мета приїзду** | `purposeOfStay` | `purpose_of_stay` | **ні — і це важливо**: не назвали, значить порожньо. Літерала більше немає (Д80) |
| **Номер візи** | `visaNumber` | `visa_number` | ні |

Мобільна версія тієї самої форми:
[`MobileBookingDetail.tsx` L857–L890](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/MobileBookingDetail.tsx#L857-L890)

**Що ще є в `reservation_guests`, але не у формі:** `fee_amount`, `fee_exempt`,
`fee_exempt_reason` (рахуються з віку й ставки, правляться в реєстрі),
`police_reported*` (кнопка в реєстрі), `is_hidden`, `sub_booking_id`.
Колонки: [`schema.sql` L1887–L1912](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1887-L1912)

---

## 7. Гостьовий портал — самореєстрація

**Файл:** [`src/app/guest/[token]/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/guest/%5Btoken%5D/page.tsx)
· 1888 рядків
**Пише:** `POST /api/guest/[token]/register`
**Мова:** сім мов, свій словник — [`translations.ts`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/guest/%5Btoken%5D/translations.ts)

Майстер із **трьох кроків** зі смугою прогресу. Гість без сесії — сторінку
відкриває токен у посиланні.

| Крок | Поля |
|---|---|
| **1. Хто ви** | Повне імʼя \*, Email \*, Телефон, Дата народження \* |
| **2. Документ** | Тип документа \*, Номер документа \*, Національність \*, Постійна адреса \*, **Мета приїзду**, **Номер візи** |
| **3. Підтвердження** | таблиця «поле → значення» з усіма 10 полями + галочка згоди GDPR |

Крок 2: [L643–L690](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/guest/%5Btoken%5D/page.tsx#L643-L690)

> **Пастка для дизайну:** форма існує у файлі **двічі** — як модалка і як нижній
> «шит» — його крок 1 починається на [L1544](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/guest/%5Btoken%5D/page.tsx#L1544), крок 2 — на L1572. Правка в одній копії не зʼявиться в
> другій. Це відоме дублювання; якщо дизайн їх обʼєднає — стане краще.

---

## 8. Книга гостей (Evidenční kniha)

**Файл:** [`src/app/app/(dashboard)/guest-registry/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guest-registry/page.tsx)
**Читає:** `GET /api/guest-registry?month=…` · **Пише:** `PATCH /api/guest-registry/[id]`

Це **документ для поліції**, а не звичайний список. Єдиний екран продукту, повністю
**чеською** й без `t()` — бо мова тут за юрисдикцією, а не за оператором.

- Згори — картки підсумку (гостей, іноземців, подано в UbyPort, сума збору).
- Навігація по місяцях, пошук, два чипи-фільтри: «лише іноземці», «не подані».
- **Export CSV** — той самий набір колонок, що на екрані.

**Колонки таблиці** ([L305–L318](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guest-registry/page.tsx#L305-L318)):
UbyPort · Jméno · Nar. · Stát · Doklad · Ubytování · Příjezd · Odjezd · Noci · **Účel** · Poplatek

**Картка гостя в реєстрі** (модалка по кліку на рядок) показує: імʼя, дату
народження, громадянство, тип і номер документа, адресу, **номер візи**, **мету
приїзду**, розміщення, дати, збір, стан UbyPort. Редаговані звідти:

| Дія | Що змінює |
|---|---|
| **Upravit** біля «Účel pobytu» | `purpose_of_stay`, `visa_number` (додано 12.09.2026) |
| позначка UbyPort | `police_reported`, `police_reported_at`, `police_report_ref` |
| правка збору | `fee_amount`, `fee_exempt`, `fee_exempt_reason` |
| сховати запис | `is_hidden` |

Блок правки мети: [L452+](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guest-registry/page.tsx#L452)

---

## 9. Що болить у нинішньому вигляді (спостереження з коду, не з екрана)

Це список для дизайну — кожен пункт видно в коді, і кожен я бачив, поки правив.

1. **Картка броні — 1824 рядки в одному компоненті.** Чотири вкладки, а всередині
   «Проживання» ще чотири самостійні блоки. Форма реєстрації гостя (10 полів)
   живе всередині вкладки всередині модалки.
2. **Форма броні — одна колонка з 20+ полів.** На створенні видно все одразу,
   хоча половина потрібна рідко (комісія, збір, статуси).
3. **Дві форми одного гостя** (десктоп і мобільний) з різними наборами полів.
4. **Дві копії форми в гостьовому порталі** — модалка і шит.
5. **VIP і чорний список: писач є, екрана немає.** Мобільний список уже малює
   корону, поставити її ніде.
6. **`PayerPicker` тягне весь довідник фірм у `<select>`** — сотні опцій без пошуку,
   тоді як форма створення вже вміє шукати.
7. **Порожнє поле й «нема даних» виглядають однаково** — скрізь `—`. Після Д80
   порожня мета приїзду це «ще не спитали», і це стан, який має бути видимим.
8. **Інлайн-стилі** у більшості форм (`style={{ … }}`) поруч із токенами
   `var(--…)`. Кольори-літерали ловить гейт-храповик, але структура лишається
   інлайновою.

---

## 10. Правила, які дизайн не має зламати

Не стиль — механіка. Кожне вже коштувало інциденту.

| Правило | Чому |
|---|---|
| **Порожнє лишається порожнім.** Ніяких «розумних» дефолтів у полях, які потім читає документ | Літерал `'Tourism'` у книзі для поліції — саме це й прибрали (Д80). Те саме з `\|\| 'CZK'` і `\|\| 'Europe/Prague'` |
| **Кольори — токенами**, не літералами (`var(--accent-warning)`, не `#f59e0b`) | у другій темі літерал лишається кольором першої; тримає `check-ui-tokens --strict` |
| **Кожен новий текст — через `t()`** і в каталог | інакше німецький портьє побачить українське речення; `check:unwrapped` + `check:i18n` |
| **Текст на документах — мовою юрисдикції**, не оператора | книга гостей чеською навмисно; тримає `check-i18n-leak` |
| **Ціну ночі не вводять руками там, де її рахує система** | єдине джерело — `priceNights()`; ніч, якої ніхто не оцінив, називається і не продається |
| **«Частково оплачено» показується, але не обирається** | його рахують гроші; два писачі одного поля розійдуться мовчки |
| **Екран, який пише, мусить прочитати відповідь** | `await fetch(…, {method:'PATCH'})` без читання показує «збережено» і на 400; тримає `check-unread-write-response` |
| **Чужий ідентифікатор — 404, не 403** | інакше відповідь стає оракулом «такий обʼєкт існує» |

---

## 11. Куди дивитись у GitHub — одним списком

Репозиторій: **`oleshka07/ALiSiO-Multi-Tenant-PMS`**, гілка **`beta`**,
знімок цього документа — коміт **`6948768f`**.

### Форми

| Що | Файл |
|---|---|
| Форма броні | [`src/components/booking/BookingForm.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingForm.tsx) |
| Картка броні | [`src/components/booking/BookingViewModal.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/BookingViewModal.tsx) |
| Картка броні (моб.) | [`src/components/booking/MobileBookingDetail.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/MobileBookingDetail.tsx) |
| Пошук гостя | [`src/components/booking/GuestPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/GuestPicker.tsx) |
| Пошук фірми | [`src/components/booking/CompanyPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/CompanyPicker.tsx) |
| Вибір прейскуранта | [`src/components/booking/RatePlanPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/RatePlanPicker.tsx) |
| Платник на картці | [`src/components/booking/card/PayerPicker.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/card/PayerPicker.tsx) |
| Фоліо / платежі | [`src/components/booking/card/FolioPanel.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/booking/card/FolioPanel.tsx) |
| Гості | [`src/app/app/(dashboard)/guests/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/page.tsx) |
| Гості (моб.) | [`src/components/mobile/pages/MobileGuests.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/components/mobile/pages/MobileGuests.tsx) |
| Компанії | [`src/app/app/(dashboard)/guests/companies/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guests/companies/page.tsx) |
| Книга гостей | [`src/app/app/(dashboard)/guest-registry/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/app/%28dashboard%29/guest-registry/page.tsx) |
| Гостьовий портал | [`src/app/guest/[token]/page.tsx`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/src/app/guest/%5Btoken%5D/page.tsx) |

### Схема бази (усі колонки)

| Таблиця | Рядки в `db/postgres/schema.sql` |
|---|---|
| `reservations` | [L1941–L2016](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1941-L2016) |
| `guests` | [L1349–L1383](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1349-L1383) |
| `companies` | [L515–L539](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L515-L539) |
| `reservation_guests` | [L1887–L1912](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1887-L1912) |
| `guest_registrations` | [L1333–L1347](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/db/postgres/schema.sql#L1333-L1347) |

### Контекст, який варто прочитати перед правкою

| Файл | Про що |
|---|---|
| [`AGENTS.md`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/AGENTS.md) | правила проєкту, інваріанти, гейти |
| [`docs/DECISIONS.md`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/docs/DECISIONS.md) | що вже вирішено (Д73–Д80 — саме про ці форми) |
| [`docs/ARCHITECTURE.md`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/docs/ARCHITECTURE.md) | шари, гейти, розділ «Лишається» |
| [`docs/NAMING.md`](https://github.com/oleshka07/ALiSiO-Multi-Tenant-PMS/blob/6948768f/docs/NAMING.md) | як називати нові поля й маршрути |

---

## 12. Що передати дизайнерові одним абзацом

> Є вісім робочих вікон PMS для готелю: форма броні, картка броні (4 вкладки),
> картка гостя, компанії, реєстрація гостя на рецепції, гостьовий портал на 3
> кроки, книга гостей для поліції — і в кожного є мобільний двійник, часто з
> іншим набором полів. Найбільша — картка броні, 1824 рядки в одному файлі.
> Поля перелічені вище поіменно разом із колонками бази; окремо названо те, що
> в базі вже є й уже кимось пишеться, але місця на екрані не має — VIP,
> чорний список, WhatsApp, мова гостя, депозит, відстрочка платежу фірми.
> Правила, які не можна ламати, — у розділі 10; вони не про смак, а про те, що
> вже одного разу зламалось.
