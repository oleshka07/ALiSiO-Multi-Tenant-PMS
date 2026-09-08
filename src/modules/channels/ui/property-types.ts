/**
 * Типи житла, які приймає канал.
 *
 * Перелік чужий: він узятий дослівно з документації вендора
 * (`docs/vendor/channex/api-v.1-documentation/hotels-collection.md`, розділ
 * `property_type`). Тому він живе одним списком і в одному місці — писач,
 * екран і гейт читають його звідси, а не переписують у себе.
 *
 * Чому це взагалі важливо, а не «поле як поле»: вендор пише про нього
 * «Recommended you set this value since it affects billing». Тобто значення
 * визначає, скільки готель ЗАПЛАТИТЬ. Для готелю на 1-15 номерів «hotel»
 * неправдиве частіше, ніж правдиве — apartment, guest_house і hostel це різні
 * гроші й різні правила показу в OTA.
 *
 * CHECK у базі на це не ставиться свідомо: перелік чужий і може зрости, а
 * міграція, яка відстала від вендора, віддавала б відмову на валідному типі.
 * Звіряє писач — там, де помилку видно оператору.
 *
 * Чому файл у `ui/`, а не в `domain/`: перелік читає ще й екран налаштувань
 * обʼєкта, а `'use client'` не може імпортувати `@channels` — фасад тягне
 * серверний код (`check-boundaries`, «дві парадні»). Той самий розклад, що в
 * `bookings/ui/payment-status.ts`: набір значень лежить у парадній для React,
 * а писач бере його звідти ж, щоб екран і перевірка не розійшлися.
 */
export const CHANNEL_PROPERTY_TYPES = [
  'apart_hotel', 'apartment', 'boat', 'camping', 'capsule_hotel', 'chalet',
  'country_house', 'farm_stay', 'guest_house', 'holiday_home', 'holiday_park',
  'homestay', 'hostel', 'hotel', 'inn', 'lodge', 'motel', 'resort', 'riad',
  'ryokan', 'tent', 'villa',
] as const;

export type ChannelPropertyType = (typeof CHANNEL_PROPERTY_TYPES)[number];

export function isChannelPropertyType(value: unknown): value is ChannelPropertyType {
  return typeof value === 'string' && (CHANNEL_PROPERTY_TYPES as readonly string[]).includes(value);
}
