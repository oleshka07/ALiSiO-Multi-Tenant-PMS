# Properties Module

Управління фізичною структурою готелю: об'єкти, категорії, будівлі, типи номерів, номери.

## Публічне API

```ts
import { listProperties, getProperty, createProperty, ... } from '@properties'
import type { Property, Unit, UnitType, Building, Category } from '@properties'
```

| Функція | Опис |
|---|---|
| `listProperties()` | Список об'єктів з агрегованими кількостями |
| `createProperty(req)` | Створити об'єкт |
| `getProperty(req, ctx)` | Об'єкт з вкладеною структурою (categories, buildings, unitTypes, units) |
| `updateProperty(req, ctx)` | Оновити поля об'єкту |
| `deleteProperty(req, ctx)` | Видалити (захист: не останній об'єкт) |
| `listUnits(req)` | Список номерів з joins |
| `createUnit(req)` | Одиничне або bulk-створення номерів (до 200) |
| `updateUnit(req, ctx)` | Оновити номер |
| `deleteUnit(req, ctx)` | Видалити (захист: активні бронювання) |
| `listUnitTypes(req)` | Список типів номерів |
| `createUnitType(req)` | Створити тип |
| `updateUnitType(req, ctx)` | Оновити тип |
| `deleteUnitType(req, ctx)` | Видалити (захист: існуючі номери) |
| `listBuildings(req)` | Список будівель |
| `createBuilding(req)` | Створити будівлю |
| `updateBuilding(req, ctx)` | Оновити будівлю |
| `deleteBuilding(req, ctx)` | Видалити (захист: прив'язані номери) |
| `listCategories()` | Список категорій |
| `createCategory(req)` | Створити категорію (glamping/resort/camping) |
| `updateCategory(req, ctx)` | Оновити категорію |
| `deleteCategory(req, ctx)` | Видалити (захист: існуючі номери) |

## Залежності

- `@core/db` — підключення до SQLite
- Не залежить від інших модулів

## Події

**Може емітити** (не підключено):
- `property.created`, `unit.created`, `unit.status_changed`

**Не слухає нічого.**

## Схема даних

**Таблиці:** `properties`, `categories`, `buildings`, `unit_types`, `units`

**Ієрархія:** `organizations` → `properties` → `categories` → `buildings` + `unit_types` → `units`

## Структура файлів

```
properties/
  api/
    index.ts                 ← єдина точка імпорту (@properties)
    properties.handlers.ts   ← HTTP handlers для /api/properties
    units.handlers.ts        ← HTTP handlers для /api/units
    unit-types.handlers.ts   ← HTTP handlers для /api/unit-types
    buildings.handlers.ts    ← HTTP handlers для /api/buildings
    categories.handlers.ts   ← HTTP handlers для /api/categories
  domain/
    types.ts                 ← Property, Unit, UnitType, Building, Category types
  data/
    properties.repo.ts       ← SQL для properties
    units.repo.ts            ← SQL для units (включно bulk-create)
    unit-types.repo.ts       ← SQL для unit_types
    buildings.repo.ts        ← SQL для buildings
    categories.repo.ts       ← SQL для categories + validateCategoryType()
  events/
    published.ts             ← типи подій модуля
  README.md
```

## Точки розширення

- Новий тип номера → `data/unit-types.repo.ts` + `domain/types.ts`
- Нова категорія → `data/categories.repo.ts` (VALID_TYPES constant)
- Нові поля об'єкту → `data/properties.repo.ts` (allowed fields list)
