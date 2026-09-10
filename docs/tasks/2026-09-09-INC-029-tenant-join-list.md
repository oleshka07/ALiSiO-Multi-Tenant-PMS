# INC-029 — вісь орендаря, вдягнена як вісь обʼєкта

**137 пар на момент рішення контролера; у цьому файлі 136** — одну
(`src/app/api/checklists/route.ts:28`) виправлено тим самим комітом, яким
список заведено, і вона лишилась нижче як приклад класу, а не як робота.

Список породжений, не написаний. Відтворити:

```bash
node scripts/check-property-scope.mjs --list   # усе «не доведено»
# саме ці 137 — поле `tenantJoinOnly` у scripts/lib/property-scope-scan.mjs
```

## Що це за клас

09.09.2026 контролер звузив означення «називає обʼєкт»: названим є **обмеження**
обʼєктом, а не згадка `property_id` у фільтрі. До звуження під «названо»
підпадала форма

```sql
FROM units u JOIN properties p ON p.id = u.property_id
 WHERE p.organization_id = ?
```

Це вісь **орендаря** — «усі обʼєкти цього рахунку», — тобто рівно та форма, з
якої почався INC-029: `listUnits` виглядав проскоупленим і не був ним. Ці пари
різняться між старим і чинним означенням і саме тому зʼявились у базлайні:
**370 → 507**, після виправлення чекліста **506 у 130 файлах**.

## Що це НЕ список дірок

Так само, як 59 місць `audit-by-id-scope` не були 59 дірками. Три законні
випадки, і їх тут більшість:

1. **Читання за первинним ключем після доведеної власності** — `WHERE r.id = ?
   AND p.organization_id = ?`: обʼєкт визначається рядком, на якому запит
   висить.
2. **Читання від гостя або броні** — `WHERE r.guest_id = ? AND
   p.organization_id = ?`: обʼєкт приходить із самої броні.
3. **Законне «усі обʼєкти рахунку»** — зведений звіт, GDPR-вивантаження,
   пошук по всьому рахунку. Після переведення воно пишеться `ALL_PROPERTIES`
   і лишається законним; змінюється те, що це СКАЗАНО, а не забуто.

Дірка — коли на екрані видно обʼєкт, а запит бере всі. Перший підтверджений
приклад цього класу — і вже **виправлений**:

```
src/app/api/checklists/route.ts:28   ← було
  FROM units u JOIN properties p ON p.id = u.property_id
   WHERE p.organization_id = ? AND u.cleaning_status IN ('dirty', 'in_progress')
```

Чекліст зміни покоївки одного обʼєкта показував брудні номери **всіх** обʼєктів
рахунку. Над запитом стояв коментар «Scoped: unqualified this listed every
hotel's dirty rooms» — правдивий рівно наполовину: чужий РАХУНОК справді не
видно, сусідній ОБʼЄКТ видно повністю. Саме тому клас і потрібен списком: він
виглядає як уже полагоджене місце.

Тепер SQL живе в `properties/data/cleaning.repo.ts` (`dirtyUnitsForShift`),
бере `PropertyScope`, а сцена в `property-lists.check.ts` тримає числа: 2 у А,
4 у Б, 6 «усі», 0 через межу орендаря. Червоність доведена — «очікували 2
брудні номери обʼєкта А, отримали 6».

## Як це читається трьома сесіями

Кожен рядок — оператор і таблиці, які він читає. Порядок усередині власника —
за густотою файла. Виправлення = читач приймає `PropertyScope` і вставляє
`${filter.sql}` у сам запит; «усі обʼєкти» пишеться `ALL_PROPERTIES` з причиною
поруч. Стеля файла в `scripts/property-scope-baseline.json` опускається тим,
хто виправив.

**48 пар у 16 файлах — ПОЗА закритою картою власності** (`modules/guests`,
`modules/tasks`, `modules/dashboard`, `modules/housekeeping`, `src/app/api/**`).
Це не прогалина списку, а прогалина карти: редакція 2 розподілу їх не називає.
Рішення, кому вони, — контролера.

---

## Скільки і в кого

| Власник | Пар | Файлів |
|---|---|---|
| 3 — ядро | 45 | 22 |
| 1 — фінанси | 12 | 6 |
| 2 — канали | 21 | 15 |
| ПОЗА КАРТОЮ ВЛАСНОСТІ | 47 | 15 |
| спільний файл міграцій | 11 | 1 |
| **разом** | **136** | **59** |

---

## 3 — ядро — 45 пар у 22 файлах

**`src/modules/properties/data/cleaning.repo.ts`** — 6 пар у 5 операторах

- `:46` → units
  ```sql
  FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ? AND p.organization_id = ?
  ```
- `:97` → unit_types, units
  ```sql
  FROM units u JOIN properties p ON p.id = u.property_id LEFT JOIN unit_types ut ON ut.id = u.unit_type_id WHERE p.organization_id = ? ${scope} AND u.is_active = T
  ```
- `:108` → units
  ```sql
  FROM availability_blocks b JOIN units u ON u.id = b.unit_id JOIN properties p ON p.id = u.property_id WHERE p.organization_id = ? ${scope} AND b.date_from <= ? A
  ```
- `:117` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id LEFT JOIN guests g ON g.id = r.guest_id WHERE p.organization_id = ? ${scope.replace('u.property_id'
  ```
- `:198` → units
  ```sql
  FROM unit_cleaning_log l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN app_users a ON a.id = l.changed_by WHERE ${where.jo
  ```

**`src/modules/bookings/api/reservation.handlers.ts`** — 5 пар у 2 операторах

- `:28` → categories, reservations, unit_types, units
  ```sql
  FROM reservations r JOIN guests g ON r.guest_id = g.id JOIN properties p ON r.property_id = p.id LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN categories c ON
  ```
- `:210` → units
  ```sql
  FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ? AND p.organization_id = ?
  ```

**`src/modules/bookings/api/reservations.handlers.ts`** — 5 пар у 2 операторах

- `:24` → categories, reservations, unit_types, units
  ```sql
  FROM reservation_sub_bookings WHERE reservation_id = r.id) as sub_booking_count, g.id as guest_id, g.first_name, g.last_name, g.email as guest_email, g.phone as
  ```
- `:250` → booking_sources
  ```sql
  FROM booking_sources bs JOIN properties p ON p.id = bs.property_id WHERE bs.code = ? AND p.organization_id = ?
  ```

**`src/modules/bookings/api/availability-blocks.handlers.ts`** — 3 пар у 3 операторах

- `:15` → units
  ```sql
  FROM availability_blocks b JOIN units u ON b.unit_id = u.id JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ? ORDER BY b.date_from ASC 
  ```
- `:66` → units
  ```sql
  FROM availability_blocks b JOIN units u ON u.id = b.unit_id JOIN properties p ON u.property_id = p.id WHERE b.id = ? AND p.organization_id = ? 
  ```
- `:71` → units
  ```sql
  FROM availability_blocks WHERE id = ? AND unit_id IN ( SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ? ) 
  ```

**`src/modules/properties/data/properties.repo.ts`** — 3 пар у 1 операторах

- `:20` → categories, unit_types, units
  ```sql
  FROM categories c WHERE c.property_id = p.id) as category_count, (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.is_active = TRUE) as unit_count,
  ```

**`src/modules/bookings/data/owned.repo.ts`** — 2 пар у 2 операторах

- `:15` → reservations
  ```sql
  FROM reservations r JOIN properties p ON r.property_id = p.id WHERE r.id = ? AND p.organization_id = ? 
  ```
- `:24` → units
  ```sql
  FROM units u JOIN properties p ON u.property_id = p.id WHERE u.id = ? AND p.organization_id = ? 
  ```

**`src/modules/bookings/data/send-abandoned-cart-email.ts`** — 2 пар у 1 операторах

- `:33` → reservations, units
  ```sql
  FROM reservations r LEFT JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN properties p ON r.property_id = p.id WHERE r.id = ? 
  ```

**`src/modules/bookings/data/send-confirmation-email.ts`** — 2 пар у 1 операторах

- `:217` → reservations, units
  ```sql
  FROM reservations r LEFT JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN properties p ON r.property_id = p.id WHERE r.id = ? 
  ```

**`src/modules/bookings/data/send-guest-reminder-email.ts`** — 2 пар у 1 операторах

- `:10` → reservations, units
  ```sql
  FROM reservations r LEFT JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN properties p ON r.property_id = p.id WHERE r.id = ? 
  ```

**`src/modules/properties/api/guest-page-configs.handlers.ts`** — 2 пар у 1 операторах

- `:18` → categories, unit_types
  ```sql
  FROM unit_types ut JOIN categories c ON ut.category_id = c.id JOIN properties p ON ut.property_id = p.id LEFT JOIN guest_page_config gpc ON gpc.unit_type_id = u
  ```

**`src/modules/properties/data/unit-search.ts`** — 2 пар у 1 операторах

- `:20` → unit_types, units
  ```sql
  FROM units u JOIN properties pr ON pr.id = u.property_id LEFT JOIN unit_types ut ON ut.id = u.unit_type_id WHERE pr.organization_id = ? AND (${like('u.name')} OR
  ```

**`src/modules/bookings/api/booking-source-widgets.handlers.ts`** — 1 пар у 1 операторах

- `:35` → booking_sites
  ```sql
  FROM booking_sites WHERE status != 'deleted' AND property_id IN (SELECT id FROM properties WHERE organization_id = ?) ORDER BY name 
  ```

**`src/modules/bookings/api/booking-source.handlers.ts`** — 1 пар у 1 операторах

- `:96` → reservations
  ```sql
  FROM reservations r JOIN properties p ON r.property_id = p.id WHERE r.source = ? AND p.organization_id = ? 
  ```

**`src/modules/bookings/api/booking-sources.handlers.ts`** — 1 пар у 1 операторах

- `:14` → booking_sources
  ```sql
  FROM booking_sources bs JOIN properties p ON p.id = bs.property_id WHERE p.organization_id = ? ORDER BY bs.sort_order, bs.name 
  ```

**`src/modules/bookings/api/service-orders.handlers.ts`** — 1 пар у 1 операторах

- `:207` → additional_services
  ```sql
  FROM booking_service_orders bso JOIN additional_services ads ON bso.service_id = ads.id JOIN properties p ON ads.property_id = p.id WHERE bso.id = ? AND p.organ
  ```

**`src/modules/bookings/data/company-stays.repo.ts`** — 1 пар у 1 операторах

- `:19` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE p.organization_id = ? AND r.company_id IS NOT NULL AND r.status <> 'cancelled' GROUP BY r.co
  ```

**`src/modules/day-sheets/data/day-sheets.repo.ts`** — 1 пар у 1 операторах

- `:149` → additional_services
  ```sql
  FROM booking_service_orders o JOIN additional_services s ON s.id = o.service_id WHERE o.status <> 'cancelled' AND o.service_date = ? AND s.property_id IN (SELEC
  ```

**`src/modules/properties/api/guest-page-config.handlers.ts`** — 1 пар у 1 операторах

- `:11` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ? AND p.organization_id = ? 
  ```

**`src/modules/properties/api/photos.handlers.ts`** — 1 пар у 1 операторах

- `:28` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON ut.property_id = p.id WHERE ut.id = ? AND p.organization_id = ?
  ```

**`src/modules/properties/api/property-guest-config.handlers.ts`** — 1 пар у 1 операторах

- `:20` → property_guest_config
  ```sql
  FROM properties p LEFT JOIN property_guest_config pgc ON pgc.property_id = p.id WHERE p.organization_id = ? ORDER BY p.name 
  ```

**`src/modules/properties/data/amenities.repo.ts`** — 1 пар у 1 операторах

- `:238` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ? AND p.organization_id = ?
  ```

**`src/modules/properties/data/fees.repo.ts`** — 1 пар у 1 операторах

- `:157` → fees_taxes
  ```sql
  FROM fees_taxes f JOIN properties p ON p.id = f.property_id WHERE f.id = ? AND p.organization_id = ?
  ```

## 1 — фінанси — 12 пар у 6 файлах

**`src/modules/finance/api/reports.handlers.ts`** — 5 пар у 2 операторах

- `:116` → reservations
  ```sql
  FROM fin_operations WHERE reservation_id = r.id AND op_type = 'income' AND status = 'completed'), 0) + COALESCE((SELECT SUM(amount) FROM fin_operations WHERE re
  ```
- `:964` → booking_sources, categories, reservations, units
  ```sql
  FROM fin_operations WHERE reservation_id = r.id AND op_type = 'income' AND status = 'completed'), 0) as paid_amount, COALESCE((SELECT SUM(amount) FROM fin_opera
  ```

**`src/modules/finance/api/paid-services.handlers.ts`** — 3 пар у 1 операторах

- `:56` → additional_services, reservations, units
  ```sql
  FROM fin_operations f WHERE f.organization_id = ? AND f.source_ref = o.id LIMIT 1) AS fin_operation_id FROM booking_service_orders o JOIN additional_services s 
  ```

**`src/modules/finance/api/payment-bridge.ts`** — 1 пар у 1 операторах

- `:135` → reservations
  ```sql
  FROM reservations r JOIN properties prop ON r.property_id = prop.id WHERE r.id = ? 
  ```

**`src/modules/invoicing/api/invoices.handlers.ts`** — 1 пар у 1 операторах

- `:247` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = ? AND p.organization_id = ?
  ```

**`src/modules/invoicing/data/reservation-invoice.repo.ts`** — 1 пар у 1 операторах

- `:25` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = ?
  ```

**`src/modules/invoicing/data/stay-charges.repo.ts`** — 1 пар у 1 операторах

- `:432` → additional_services
  ```sql
  FROM additional_services s JOIN properties p ON p.id = s.property_id WHERE s.id = ? AND p.organization_id = ?
  ```

## 2 — канали — 21 пар у 15 файлах

**`src/modules/channels/api/ical-channels.handlers.ts`** — 4 пар у 2 операторах

- `:19` → booking_sources, ical_channels, units
  ```sql
  FROM ical_channels ic JOIN properties p ON ic.property_id = p.id LEFT JOIN units u ON ic.unit_id = u.id LEFT JOIN booking_sources bs ON bs.code = ic.source_code
  ```
- `:74` → ical_channels
  ```sql
  FROM ical_channels WHERE unit_id = ? AND source_code = ? AND property_id IN (SELECT id FROM properties WHERE organization_id = ?)
  ```

**`src/modules/channels/api/ical-sync.handlers.ts`** — 2 пар у 2 операторах

- `:34` → ical_channels
  ```sql
  FROM ical_channels ic JOIN properties p ON ic.property_id = p.id WHERE ic.id = ? AND ic.is_active = TRUE AND p.organization_id = ? 
  ```
- `:42` → ical_channels
  ```sql
  FROM ical_channels ic JOIN properties p ON ic.property_id = p.id WHERE ic.is_active = TRUE AND ic.ical_url IS NOT NULL AND p.organization_id = ? 
  ```

**`src/modules/pricing/data/nightly-price.ts`** — 2 пар у 2 операторах

- `:226` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ?
  ```
- `:690` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ?
  ```

**`src/modules/pricing/data/price-calendar.repo.ts`** — 2 пар у 2 операторах

- `:557` → unit_types
  ```sql
  FROM price_calendar pc JOIN unit_types ut ON pc.unit_type_id = ut.id JOIN properties p ON ut.property_id = p.id WHERE p.organization_id = ? AND pc.date >= ? AND
  ```
- `:827` → rate_plans
  ```sql
  FROM rate_plans rp JOIN properties p ON p.id = rp.property_id WHERE rp.id = ? AND p.organization_id = ? AND rp.pricing_type = 'derived'
  ```

**`src/modules/channels/api/ical-channel.handlers.ts`** — 1 пар у 1 операторах

- `:16` → ical_channels
  ```sql
  FROM ical_channels ic JOIN properties p ON ic.property_id = p.id WHERE ic.id = ? AND p.organization_id = ? 
  ```

**`src/modules/channels/api/ical-cron.handlers.ts`** — 1 пар у 1 операторах

- `:43` → ical_channels
  ```sql
  FROM ical_channels ic JOIN properties p ON ic.property_id = p.id WHERE ic.is_active = TRUE AND ic.ical_url IS NOT NULL AND ( ic.last_synced_at IS NULL OR ${sql.d
  ```

**`src/modules/channels/data/connections.repo.ts`** — 1 пар у 1 операторах

- `:210` → cm_connections
  ```sql
  FROM cm_connections WHERE organization_id = ? ORDER BY property_id, id
  ```

**`src/modules/pricing/api/quote.handlers.ts`** — 1 пар у 1 операторах

- `:31` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ? AND p.organization_id = ?
  ```

**`src/modules/pricing/data/owned.repo.ts`** — 1 пар у 1 операторах

- `:24` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ? AND p.organization_id = ?
  ```

**`src/modules/pricing/data/price-mode.repo.ts`** — 1 пар у 1 операторах

- `:54` → unit_types
  ```sql
  FROM price_calendar pc JOIN unit_types ut ON pc.unit_type_id = ut.id JOIN properties p ON ut.property_id = p.id WHERE p.organization_id = ? AND pc.date >= ? AND
  ```

**`src/modules/pricing/data/quote.repo.ts`** — 1 пар у 1 операторах

- `:94` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON p.id = ut.property_id JOIN organizations o ON o.id = p.organization_id WHERE ut.id = ?
  ```

**`src/modules/pricing/data/rate-plans.repo.ts`** — 1 пар у 1 операторах

- `:249` → rate_plans
  ```sql
  FROM rate_plans rp JOIN properties p ON p.id = rp.property_id WHERE rp.id = ? AND p.organization_id = ?
  ```

**`src/modules/pricing/data/seasons.repo.ts`** — 1 пар у 1 операторах

- `:120` → seasons
  ```sql
  FROM seasons s JOIN properties p ON p.id = s.property_id WHERE s.id = ? AND s.organization_id = ? AND p.organization_id = ?
  ```

**`src/modules/widget/api/site-analytics.handlers.ts`** — 1 пар у 1 операторах

- `:41` → booking_sites
  ```sql
  FROM booking_sites bs JOIN properties p ON bs.property_id = p.id WHERE bs.id = ? AND p.organization_id = ? 
  ```

**`src/modules/widget/api/widget-reserve.handlers.ts`** — 1 пар у 1 операторах

- `:692` → units
  ```sql
  FROM units u LEFT JOIN properties p ON u.property_id = p.id WHERE u.id = ? 
  ```

## ПОЗА КАРТОЮ ВЛАСНОСТІ — 47 пар у 15 файлах

**`src/modules/guests/data/guests.repo.ts`** — 9 пар у 7 операторах

- `:62` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND r.status NOT IN ('cancelled'
  ```
- `:71` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = g.id AND p.organization_id = g.organization_id AND r.company_id IS NOT NULL)
  ```
- `:83` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = g.id AND p.organization_id = g.organization_id )
  ```
- `:89` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = g.id AND p.organization_id = g.organization_id ORDER BY r.check_in DESC LIMIT 1
  ```
- `:112` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = g.id AND p.organization_id = g.organization_id) as total_stays, (SELECT SUM(r.t
  ```
- `:125` → categories, reservations, units
  ```sql
  FROM reservations r LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN categories c ON u.category_id = c.id JOIN properties p ON p.id = r.property_id WHERE r.guest
  ```
- `:191` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = ? AND p.organization_id = ? 
  ```

**`src/modules/guests/api/gdpr.handlers.ts`** — 5 пар у 5 операторах

- `:40` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = ? AND p.organization_id = ? 
  ```
- `:46` → reservations
  ```sql
  FROM reservation_guests rg JOIN reservations r ON r.id = rg.reservation_id JOIN properties p ON p.id = r.property_id WHERE rg.guest_id = ? AND p.organization_id
  ```
- `:53` → reservations
  ```sql
  FROM guest_registrations gr JOIN reservations r ON r.id = gr.reservation_id JOIN properties p ON p.id = r.property_id WHERE gr.guest_id = ? AND p.organization_i
  ```
- `:110` → reservations
  ```sql
  FROM reservation_guests rg JOIN reservations r ON r.id = rg.reservation_id JOIN properties p ON p.id = r.property_id WHERE rg.guest_id = ? AND r.check_out >= ? 
  ```
- `:144` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE p.organization_id = ? ) 
  ```

**`src/modules/dashboard/api/dashboard.handlers.ts`** — 4 пар у 2 операторах

- `:59` → reservations, units
  ```sql
  FROM reservations r JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id JOIN properties p ON p.id = r.property_id WHERE ${scope('r.')} AND r
  ```
- `:73` → reservations, units
  ```sql
  FROM reservations r JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id JOIN properties p ON p.id = r.property_id WHERE ${scope('r.')} AND r
  ```

**`src/modules/guests/data/guest-portal.repo.ts`** — 4 пар у 1 операторах

- `:68` → categories, reservations, unit_types, units
  ```sql
  FROM reservations r JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN categories c ON u.category_id = c.id LEFT JOIN unit_types
  ```

**`src/modules/guests/data/registration.repo.ts`** — 4 пар у 2 операторах

- `:10` → reservations, unit_types, units
  ```sql
  FROM reservations r JOIN properties p ON r.property_id = p.id JOIN guests g ON r.guest_id = g.id LEFT JOIN units u ON r.unit_id = u.id LEFT JOIN unit_types ut O
  ```
- `:28` → reservations
  ```sql
  FROM reservations r JOIN properties p ON r.property_id = p.id WHERE r.id = ? 
  ```

**`src/modules/tasks/data/projects.repo.ts`** — 4 пар у 2 операторах

- `:17` → task_projects, tasks
  ```sql
  FROM tasks t WHERE t.project_id = tp.id) AS task_count FROM task_projects tp LEFT JOIN properties p ON p.id = tp.property_id WHERE tp.organization_id = ? ORDER 
  ```
- `:33` → task_projects, tasks
  ```sql
  FROM tasks t WHERE t.project_id = tp.id) AS task_count FROM task_projects tp LEFT JOIN properties p ON p.id = tp.property_id WHERE tp.id = ? AND tp.organization
  ```

**`src/modules/tasks/data/tasks.repo.ts`** — 4 пар у 2 операторах

- `:93` → task_projects, tasks
  ```sql
  FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count, (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id AND sub.status = 'done') AS subtask_done
  ```
- `:129` → task_projects, tasks
  ```sql
  FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count, (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id AND sub.status = 'done') AS subtask_done
  ```

**`src/modules/guests/data/registry.repo.ts`** — 3 пар у 2 операторах

- `:84` → reservations, units
  ```sql
  from their passport came out as a -- foreigner in the Evidenční kniha — the register the police read. CASE WHEN rg.nationality IS NOT NULL AND UPPER(rg.national
  ```
- `:155` → reservations
  ```sql
  FROM reservation_guests rg JOIN reservations r ON rg.reservation_id = r.id JOIN properties p ON r.property_id = p.id WHERE ${ORG_SCOPE} AND r.check_in >= ? AND r
  ```

**`src/app/api/booking-sites/[id]/listings/route.ts`** — 2 пар у 2 операторах

- `:76` → units
  ```sql
  FROM units u JOIN properties p ON u.property_id = p.id WHERE u.id = ? AND p.organization_id = ?
  ```
- `:83` → unit_types
  ```sql
  FROM unit_types ut JOIN properties p ON ut.property_id = p.id WHERE ut.id = ? AND p.organization_id = ?
  ```

**`src/app/api/booking-sites/[id]/services/route.ts`** — 2 пар у 2 операторах

- `:18` → additional_services
  ```sql
  FROM additional_services s JOIN properties p ON s.property_id = p.id LEFT JOIN site_services ss ON ss.service_id = s.id AND ss.site_id = ? WHERE s.is_active = T
  ```
- `:58` → additional_services
  ```sql
  FROM additional_services s JOIN properties p ON s.property_id = p.id WHERE s.id = ? AND s.is_active = TRUE AND p.organization_id = ?
  ```

**`src/modules/guests/data/meldeschein.repo.ts`** — 2 пар у 1 операторах

- `:50` → reservations, units
  ```sql
  FROM reservations r LEFT JOIN units u ON u.id = r.unit_id LEFT JOIN properties p ON p.id = r.property_id LEFT JOIN guests g ON g.id = r.guest_id WHERE r.id = ? 
  ```

**`src/app/api/booking/drafts-count/route.ts`** — 1 пар у 1 операторах

- `:31` → reservations
  ```sql
  FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN properties p ON p.id = r.property_id WHERE p.organization_id = ? AND r.status = 'draft' AND LOWER(g.
  ```

**`src/app/api/gift-cards/[id]/activate/route.ts`** — 1 пар у 1 операторах

- `:45` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = ? AND p.organization_id = ? 
  ```

**`src/app/api/gift-cards/route.ts`** — 1 пар у 1 операторах

- `:112` → booking_sites
  ```sql
  FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = ? AND p.organization_id = ? 
  ```

**`src/modules/guests/data/guests-export.repo.ts`** — 1 пар у 1 операторах

- `:55` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE p.organization_id = ? AND r.company_id IS NOT NULL
  ```

## спільний файл міграцій — 11 пар у 1 файлах

**`src/lib/db.ts`** — 11 пар у 10 операторах

- `:1290` → extra_occupancy_rules, rate_plans
  ```sql
  FROM rate_plans rp JOIN properties p ON p.id = rp.property_id WHERE rp.child_extra_gross IS NOT NULL AND NOT EXISTS (SELECT 1 FROM extra_occupancy_rules r WHERE
  ```
- `:2450` → reservations
  ```sql
  FROM payments p JOIN reservations r ON p.reservation_id = r.id JOIN properties prop ON r.property_id = prop.id 
  ```
- `:2505` → reservations
  ```sql
  FROM income) + (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM transfers) + (SELECT COUNT(*) FROM payments p JOIN reservations r ON p.reservation_id = r
  ```
- `:2518` → reservations
  ```sql
  FROM income) + (SELECT COALESCE(SUM(amount), 0) FROM expenses) + (SELECT COALESCE(SUM(amount), 0) FROM transfers) + (SELECT COALESCE(SUM(p.amount), 0) FROM paym
  ```
- `:3612` → reservations
  ```sql
  FROM invoices_old i JOIN reservations r ON r.id = i.reservation_id JOIN properties p ON p.id = r.property_id 
  ```
- `:5425` → units
  ```sql
  FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = availability_blocks.unit_id) WHERE organization_id IS NULL
  ```
- `:5429` → booking_sites
  ```sql
  FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = gift_card_bundles.site_id) WHERE organization_id IS NULL
  ```
- `:5431` → booking_sites
  ```sql
  FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = gift_card_automation_rules.site_id) WHERE organization_id IS NULL
  ```
- `:5440` → reservations
  ```sql
  FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = booking_activity_log.reservation_id) WHERE organization_id IS NULL AND reservation_id
  ```
- `:5623` → booking_sites
  ```sql
  FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = coupons.site_id) WHERE organization_id IS NULL AND site_id IS NOT NULL
  ```

