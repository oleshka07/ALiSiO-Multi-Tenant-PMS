/**
 * Експорт списку гостей у CSV — простий і розширений (Блок 4 §2.5).
 *
 * Це операторський файл, а не документ гостя чи юрисдикції: заголовки —
 * мовою продукту, без `t()` (інваріант 19 і `check-i18n-leak`: перекладач у
 * шлях експорту не імпортується — так само, як в експорті броней).
 *
 * Два набори колонок, бо це два різні запитання:
 *   `simple`   — кому подзвонити: імʼя, контакти, країна;
 *   `extended` — те саме плюс документ, адреса, історія проживань і
 *                компанії-платники, тобто все, що готель про гостя знає.
 *
 * Персональні дані: розширений набір несе номер документа й дату
 * народження, тож маршрут стоїть під `manage_guests`, а не під переглядом.
 */
import { getSql } from '@core/db/async';
import { companyNames } from '@companies/kernel';
import type { GuestFilters } from './guests.repo';
import { listGuests } from './guests.repo';
import { propertyScopeFilter, ALL_PROPERTIES } from '@core/property-scope';

export type ExportFormat = 'simple' | 'extended';

const SIMPLE_HEADERS = ['Прізвище', 'Ім\'я', 'Email', 'Телефон', 'Країна', 'Місто'] as const;
const EXTENDED_HEADERS = [
  ...SIMPLE_HEADERS,
  'Адреса', 'Дата народження', 'Тип документа', 'Номер документа', 'Громадянство',
  'Проживань', 'Виторг', 'Останній заїзд', 'Компанії', 'Нотатки', 'Створено',
] as const;

/** Одне поле CSV: лапки подвоюються, роздільник і перенос ховаються в лапки. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * BOM попереду: без нього Excel читає UTF-8 як cp1251 і показує «ÐŸÑ€Ð¾»
 * замість прізвища. CRLF — з тієї ж причини.
 */
export function csvDocument(headers: readonly string[], rows: readonly unknown[][]): string {
  return `﻿${[headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n')}\r\n`;
}

/**
 * Компанії-платники кожного гостя — назвами.
 *
 * Двома кроками навмисно: хто за кого платив — це броні (спільна
 * лексика), а як компанія називається — довідник, і його таблицю читає
 * лише свій модуль (`@companies/kernel`, `check-boundaries`).
 */
/**
 * Компанії-платники — по РАХУНКУ, і це сказано (Д52). Список гостей належить
 * компанії, тож і компанії, які за них платили, читаються по всіх обʼєктах:
 * звуження зробило б CSV вужчим за екран, з якого його натиснули.
 */
const ACROSS_PROPERTIES = propertyScopeFilter(ALL_PROPERTIES, 'r');

async function companiesByGuest(organizationId: string): Promise<Map<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links = await getSql().rows<any>(
    `SELECT DISTINCT r.guest_id, r.company_id
       FROM reservations r
       JOIN properties p ON p.id = r.property_id
      WHERE p.organization_id = ? AND ${ACROSS_PROPERTIES.sql} AND r.company_id IS NOT NULL`,
    [organizationId]);
  const names = await companyNames(organizationId, links.map((r: any) => String(r.company_id)));
  const out = new Map<string, string>();
  for (const link of links) {
    const name = names.get(String(link.company_id));
    if (!name) continue;
    const key = String(link.guest_id);
    const seen = out.get(key);
    out.set(key, seen ? [...new Set([...seen.split('; '), name])].sort().join('; ') : name);
  }
  return out;
}

/**
 * Той самий список, що на екрані, — тими самими фільтрами. Експорт, який
 * віддає не те, що видно, це другий список: оператор звіряє його з екраном
 * і не сходиться.
 */
export async function exportGuestsCsv(organizationId: string, filters: GuestFilters, format: ExportFormat): Promise<string> {
  // Ліміт великий навмисно: експорт — це «весь список», а не сторінка.
  const { data } = await listGuests(organizationId, filters, 1, 10_000);
  if (format === 'simple') {
    return csvDocument(SIMPLE_HEADERS, data.map((g: Record<string, unknown>) => [
      g.last_name, g.first_name, g.email, g.phone, g.country, g.city,
    ]));
  }
  const companies = await companiesByGuest(organizationId);
  return csvDocument(EXTENDED_HEADERS, data.map((g: Record<string, unknown>) => [
    g.last_name, g.first_name, g.email, g.phone, g.country, g.city,
    g.address, g.date_of_birth, g.document_type, g.document_number, g.nationality,
    g.total_stays ?? 0, g.total_revenue ?? 0, g.last_check_in,
    companies.get(String(g.id)) ?? '', g.notes, String(g.created_at ?? '').slice(0, 10),
  ]));
}
