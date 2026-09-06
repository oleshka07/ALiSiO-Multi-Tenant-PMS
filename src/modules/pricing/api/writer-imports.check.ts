/**
 * Ланцюжок ПИСАЧІВ не потребує `next/server` — як у продакшн-образі.
 *
 *   node src/modules/pricing/api/writer-imports.check.ts
 *
 * Next збирає standalone і вирізає з `node_modules` усе, чого не просить
 * рантайм застосунку: `node_modules/next/server.js` у прод-образі відсутній.
 * Локально він є завжди, тому імпорт, який його тягне, на стенді невидимий —
 * і проявляється лише на сервері, після деплою.
 *
 * Саме так це й проявилось 06.09.2026, двічі поспіль. `deploy.sh` піднімає
 * контейнер, ганяє дим (усі чотири відповіді правильні) і ТІЛЬКИ ПОТІМ
 * звіряє готельні файли: `docker exec … node scripts/apply-hotel.mjs --all`.
 * Скрипт імпортує писачі, ті — `@channels/outbox`, а `outbox-notes.ts` тягнув
 * повний фасад `@pricing` разом із HTTP-обробниками. Деплой звітував «не
 * пройшов», хоча бета вже працювала на новому коміті: червоним був крок після
 * підняття. Помилка виглядала як «готель не збігається зі своїм файлом» —
 * тобто вказувала на дані клієнта, а зламаний був імпорт.
 *
 * Гейт вантажить ті самі модулі, що й `apply-hotel.mjs`, з гачком, який
 * відмовляє на `next/*` так само, як прод-образ. Це не аналіз тексту: якщо
 * ланцюжок десь знову захопить обробники, тут упаде імпорт.
 */
import assert from 'node:assert';
import { registerHooks } from 'node:module';
import '../../../../scripts/lib/module-aliases.mjs';

// Прод-образ: `next/server` не резолвиться. Відтворюємо це, а не вгадуємо.
const forbidden: string[] = [];
registerHooks({
  resolve(spec: string, ctx: any, next: any) {
    if (spec === 'next/server' || spec.startsWith('next/server/')) {
      forbidden.push(`${spec} ← ${ctx.parentURL ?? '?'}`);
      throw new Error(`next/server у ланцюжку писача: ${spec} ← ${ctx.parentURL ?? '?'}`);
    }
    return next(spec, ctx);
  },
});

// Рівно те, що імпортує `scripts/apply-hotel.mjs` після деплою.
await import('../../properties/data/properties.repo.ts');
await import('../../properties/data/categories.repo.ts');
await import('../../properties/data/unit-types.repo.ts');
await import('../../properties/data/units.repo.ts');
await import('../data/occupancy-price.repo.ts');
await import('../data/nightly-price.ts');
// І вузькі двері, якими писачі беруть тарифи.
await import('./plans.ts');

assert.deepStrictEqual(forbidden, [],
  `писачі не мають тягнути обробники HTTP — у прод-образі їх залежностей немає:\n  ${forbidden.join('\n  ')}`);

console.log('writer-imports: ланцюжок писачів піднімається без next/server — як у прод-образі');
