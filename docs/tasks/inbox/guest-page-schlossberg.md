# Гостьова сторінка Ґрайца заповнена — і ШОСТИЙ пункт до INC-050

Контролер, 18–19.09.

## Заповнено в `hotels/schlossberghotel.json` → `guestPage`

Джерела — відкриті сторінки самого готелю й міста, не здогад:
`schlossberghotel-greiz.de/anfahrt/`, `/gaestemappe/auf-einen-blick-von-a-z/`,
`/gaestemappe/kulinarisches/`, `/hotel/`, `/agb/`, `greiz.de/…/parken`.
Поля: `parkingInfo`, `parkingMapsUrl`, `mapsUrl`, `restaurantName`, `restaurantHours`,
`rules` (6), `faqItems` (13), `usefulInfo` (14), `emergencyPhone`, `petsPolicy`.

**Паркування виправлено по суті.** Стояло «Schlossgarage» як МІСЬКА парковка, вʼїзд
«Siebenhitze / Neuer Weg», висота «ca. 2,00 m». Джерела: гараж **під самим готелем** із ліфтом у
дім, вʼїзд ОДИН — **Neuer Weg, Richtung Kreiskrankenhaus**, 10 €/ніч, квиток на виїзд на
рецепції. «Siebenhitze» немає ніде; висоти немає теж — обидва числа прибрано.
`parkingMapsUrl` веде **до вʼїзду**, не до дверей.

Ресторану в готелю немає — картка `restaurant` віддана сніданку (Mo–Fr 7.00–10.00, Sa/So/свята
7.30–10.00). Девʼять сусідніх закладів із телефонами — в `usefulInfo` з кнопкою навігації.

## ДЕФЕКТ: `apply-hotel.mjs` не доносить пʼять полів

`scripts/apply-hotel.mjs:356-359`, статичний `COLS`, у ньому **немає** `parking_maps_url`,
`parking_photo_url`, `whatsapp_phone`, `weather_lat`, `weather_lon` — хоча всі пʼять є в
`schema.sql`, у писачі `property-guest-config.handlers.ts:52-58` і на сторінці
(`page.tsx:1297, 1324, 153, 198`).

Доведено прогоном. Скрипт друкує, що поклав:

    +  гостьова сторінка: restaurant_name, restaurant_hours, rules, useful_info, faq_items,
       maps_url, pets_policy, parking_info, emergency_phone

і запит у базу при заповненому `parkingMapsUrl` у файлі дає `parking_maps_url: null`. Кнопка
карти паркування через файл готелю **не вмикається взагалі**, і мовчки: `check-hotels` зелений.

**Правка (шостий пункт INC-050):** пʼять колонок у `COLS` — і гейт на ВЛАСТИВІСТЬ: множина
колонок `property_guest_config` у `schema.sql` мусить дорівнювати `COLS` плюс названий виняток
(`id`, `property_id`, `created_at`, `updated_at`). Мутація: прибрати один рядок із `COLS` —
гейт має почервоніти поіменно.

## Залишок — його взяти нізвідки

`wifiNetwork`/`wifiPassword` (назва й пароль ідуть **парою або ніяк** —
`guest-portal.repo.ts:259`), `parkingPhotoUrl` (фото вʼїзду з Neuer Weg),
`territoryMapUrl`, `videoGuideUrl`, `whatsappPhone`, `weatherLat`/`weatherLon`.

Координати **навмисно не поставлені**: виведення «гараж під готелем» дає ≈ 50.6582 / 12.1993,
але карта на «Explore» і погода мають стояти на виміряній точці, а не на здогаді.

Три ціни з їхньої ж гостьової папки потребують підтвердження рецепцією (дат оновлення в джерелі
немає): сніданок 15,00 € · собака 10,00 €/день · паркомісце 10,00 €/ніч.
