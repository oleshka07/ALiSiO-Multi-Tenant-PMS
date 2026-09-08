/**
 * Класифікатор відмов бази розрізняє «об'єкта немає» і «сталося щось інше».
 *
 * Гейт на самий гейт, і він потрібен: попередня версія перевіряла ТЕКСТ
 * (`/does not exist/`), а `does not exist` у Postgres буває не лише про
 * relation і column. Три форми, на яких текстовий класифікатор давав тверде
 * червоне з ВИГАДАНОЮ причиною «гейт прибирає те, чого немає»:
 *
 *   * `role … does not exist` — роль не заведена на стенді;
 *   * `database … does not exist` — не та база в DATABASE_URL;
 *   * `prepared statement … does not exist` — класика під пулером.
 *
 * Останні дві не гіпотетичні: застаріла локальна база вже валила `check:pg`
 * (114 таблиць проти 121), і з текстовим класифікатором живий гейт назвав би
 * причину неправильно.
 *
 *   node scripts/lib/db-names.check.mjs
 */
import assert from 'node:assert';
import { isUnresolvedObject } from './db-names.mjs';

let n = 0;
const claim = (what, got, want) => {
  assert.strictEqual(got, want, `${what}: дало ${got}, треба ${want}`);
  console.log(`  ok  ${what}`);
  n += 1;
};

// Фікстура не вироджена по осі, про яку твердження стверджує (інваріант 26):
// на осі «це про об'єкт» є обидва значення, і по три випадки з кожного боку.
claim('Postgres 42P01 — таблиці немає',
  isUnresolvedObject({ code: '42P01', message: 'relation "invoice_items" does not exist' }), true);
claim('Postgres 42703 — колонки немає',
  isUnresolvedObject({ code: '42703', message: 'column "reservation_id" does not exist' }), true);
claim('SQLite — таблиці немає',
  isUnresolvedObject({ message: 'no such table: invoice_items' }), true);
claim('SQLite — колонки немає',
  isUnresolvedObject({ message: 'no such column: reservation_id' }), true);

claim('роль, якої немає, — це НЕ відсутній об\'єкт схеми',
  isUnresolvedObject({ code: '42704', message: 'role "alisio_app" does not exist' }), false);
claim('база, якої немає, — теж ні',
  isUnresolvedObject({ code: '3D000', message: 'database "alisio_local" does not exist' }), false);
claim('prepared statement під пулером — тим паче ні',
  isUnresolvedObject({ code: '26000', message: 'prepared statement "S_1" does not exist' }), false);

// Відмова без коду й без знайомого тексту не вигадує собі роду.
claim('незнайома відмова не видає себе за відсутній об\'єкт',
  isUnresolvedObject({ message: 'connection terminated unexpectedly' }), false);
claim('порожня відмова не падає',
  isUnresolvedObject(undefined), false);

console.log(`db-names: класифікатор розрізняє рід відмови за кодом, а не за текстом (${n} тверджень)`);
