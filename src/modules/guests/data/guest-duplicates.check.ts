/**
 * Сімʼя під однією поштою — не одна людина (INC-303).
 *
 *   DB_DRIVER=postgres DATABASE_URL=… node src/modules/guests/data/guest-duplicates.check.ts
 *
 * ── Головне твердження, і воно суперечить плану імпорту ─────────────────
 *
 * `IMPORT-PLAN.md` §2.7 каже «однаковий E_MAIL → один гість». Готель у Ґрайці
 * приймає СІМʼЇ, і подружжя з дітьми живуть під однією поштою. За правилом
 * плану вони стали б однією людиною — незворотно, і виявилось би це на видачі
 * чужої фактури. Тому пошта тут працює лише В ПАРІ з іменем.
 *
 * ── Пари (§26) ──────────────────────────────────────────────────────────
 *
 * На кожну ознаку — рядок, який МУСИТЬ збігтись, і рядок, який мусить НЕ
 * збігтись. Інакше твердження зелене й на шукачі, який не знаходить нічого
 * (або знаходить усе).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-guest-dups-'));
if (process.env.DB_DRIVER !== 'postgres') process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { guestDuplicateCandidates, searchName, STRONG_TIERS } = await import('./guest-duplicates.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(ORG, fn);

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const guest = (id: string, first: string, last: string, extra: Record<string, string | null> = {}) =>
  inOurs(() => sql.run(
    `INSERT INTO guests (id, organization_id, first_name, last_name, email, phone,
                         date_of_birth, document_type, document_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ORG, first, last, extra.email ?? null, extra.phone ?? null,
      extra.dob ?? null, extra.docType ?? null, extra.docNo ?? null]));

// ── СІМʼЯ: одна пошта, різні люди ───────────────────────────────────────────
await guest('dup_dad', 'Klaus', 'Weber', { email: 'weber@example.com' });
await guest('dup_mum', 'Petra', 'Weber', { email: 'weber@example.com' });
await guest('dup_kid', 'Lena', 'Weber', { email: 'weber@example.com' });

// ── ТА САМА людина двома рядками: пошта + імʼя ──────────────────────────────
await guest('dup_same_a', 'Jörg', 'Müller-Stub', { email: 'jm@example.com' });
await guest('dup_same_b', 'Jörg', 'Mueller-Stub', { email: 'JM@example.com' });

// ── Та сама людина за документом, імена записані по-різному ─────────────────
await guest('dup_doc_a', 'Anna', 'Schmidt', { docType: 'passport', docNo: 'X123' });
await guest('dup_doc_b', 'A.', 'Schmidt-Neu', { docType: 'passport', docNo: 'X123' });

// ── Однофамільці без жодної іншої ознаки ────────────────────────────────────
await guest('dup_ns_a', 'Hans', 'Bauer');
await guest('dup_ns_b', 'Hans', 'Bauer');

const found = await inOurs(() => guestDuplicateCandidates(ORG));
const pair = (a: string, b: string) => found.find(
  (c) => (c.keepId === a && c.dropId === b) || (c.keepId === b && c.dropId === a));

say(searchName('Jörg', 'Müller-Stub') === searchName('Jörg', 'Mueller-Stub'),
  'умлаут згортається так само, як це робить саме джерело (MUELLER-STUB)');

say(pair('dup_same_a', 'dup_same_b')?.tier === 'email_and_name',
  'та сама людина двома написаннями — знайдена за поштою І імʼям');

say(pair('dup_doc_a', 'dup_doc_b')?.tier === 'document',
  'той самий номер документа переважає різні написання імені');

// Головна пара: сімʼя.
const family = [pair('dup_dad', 'dup_mum'), pair('dup_dad', 'dup_kid'), pair('dup_mum', 'dup_kid')];
say(family.every((c) => c === undefined),
  'СІМʼЯ під однією поштою — НЕ кандидати: жодної пари з трьох');

const namesOnly = pair('dup_ns_a', 'dup_ns_b');
say(namesOnly?.tier === 'name_only',
  'однофамільці знайдені, але найслабшим родом — рішення за людиною');
say(!STRONG_TIERS.includes(namesOnly!.tier),
  'і саме лише імʼя НЕ входить у «майже напевно» — однофамільці бувають');

// Шукач не пише.
const before = await inOurs(async () => Number((await sql.row<{ n: number }>(
  'SELECT COUNT(*) AS n FROM guests WHERE merged_into IS NOT NULL AND organization_id = ?', [ORG]))?.n ?? 0));
await inOurs(() => guestDuplicateCandidates(ORG));
const after = await inOurs(async () => Number((await sql.row<{ n: number }>(
  'SELECT COUNT(*) AS n FROM guests WHERE merged_into IS NOT NULL AND organization_id = ?', [ORG]))?.n ?? 0));
say(before === after, 'шукач нічого не злив — він пропонує, а не вирішує');

if (process.env.DB_DRIVER !== 'postgres') fs.rmSync(tmp, { recursive: true, force: true });
assert.deepStrictEqual(fails, [], `не виконано: ${fails.join('; ')}`);
console.log('guest-duplicates: пошта в парі з імʼям, документ найсильніший, сімʼя не зливається');
