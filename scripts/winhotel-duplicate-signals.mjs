/**
 * Скільки пар дає КОЖНА ознака дублікатів окремо — на справжньому витягу.
 *
 *   node scripts/winhotel-duplicate-signals.mjs <addresses.jsonl>
 *   node scripts/winhotel-duplicate-signals.mjs --self-test
 *
 * ── Навіщо скрипт, а не число в звіті ───────────────────────────────────
 *
 * Задача просила виміряти на `extract-out/`, «і саме воно вирішує форму, а не
 * смак». Виміряти НЕМА НА ЧОМУ: у репозиторії лежать лічильники, DDL і зразки
 * ДОВІДНИКІВ, а рядків адрес немає навмисно («лише довідники, без гостей,
 * адрес, фактур»), і обидва `.fbk` видалені з контейнера після витягання.
 * Синтетична фікстура (`Gast Eins`, `Musterweg 1`) для вимірювання не годиться
 * за побудовою: у ній немає ні справжніх поштових скупчень, ні справжніх
 * однофамільців.
 *
 * Тому тут — не вигадане число, а інструмент, який дає справжнє за одну
 * хвилину, щойно зʼявиться свіжий витяг. Це рівно те, чого вимагає AGENTS §5:
 * немає скрипта — спершу створюється скрипт.
 *
 * ── Що друкує ───────────────────────────────────────────────────────────
 *
 * Для кожної ознаки: скільки ГРУП, скільки ПАР, і — головне — скільки пар
 * ознака дає ПОНАД сильнішу за неї. Останнє й відповідає на питання «скільки
 * хибних збігів»: пари, які дає лише пошта і не підтверджує імʼя, — це
 * здебільшого сімʼї, і їх видно числом.
 */
import fs from 'node:fs';

const NAME_FOLD = [[/Ä/g, 'AE'], [/Ö/g, 'OE'], [/Ü/g, 'UE'], [/ß/g, 'SS']];

export function searchName(name1, name2) {
  let s = `${name1 ?? ''} ${name2 ?? ''}`.toUpperCase();
  for (const [from, to] of NAME_FOLD) s = s.replace(from, to);
  return s.replace(/[^A-Z0-9]+/g, ' ').trim();
}

const clean = (v) => (v ?? '').toString().trim().toLowerCase();
const digits = (v) => (v ?? '').toString().replace(/\D/g, '');

/** Ознаки — від найсильнішої до найслабшої; порядок і є ранг. */
const SIGNALS = [
  ['документ', (a) => (clean(a.id_nr) ? `doc#${clean(a.id_nr)}` : null)],
  ['пошта + імʼя', (a) => (clean(a.e_mail) && searchName(a.name1, a.name2)
    ? `em#${clean(a.e_mail)}#${searchName(a.name1, a.name2)}` : null)],
  ['телефон + імʼя', (a) => (digits(a.tele1).length >= 6 && searchName(a.name1, a.name2)
    ? `ph#${digits(a.tele1)}#${searchName(a.name1, a.name2)}` : null)],
  ['імʼя + індекс + дата', (a) => (searchName(a.name1, a.name2) && clean(a.plz) && clean(a.gebdat)
    ? `nzd#${searchName(a.name1, a.name2)}#${clean(a.plz)}#${clean(a.gebdat)}` : null)],
  ['імʼя + індекс', (a) => (searchName(a.name1, a.name2) && clean(a.plz)
    ? `nz#${searchName(a.name1, a.name2)}#${clean(a.plz)}` : null)],
  ['ПОШТА САМА (правило IMPORT-PLAN §2.7)', (a) => (clean(a.e_mail) ? `e#${clean(a.e_mail)}` : null)],
  ['саме лише імʼя', (a) => searchName(a.name1, a.name2) || null],
];

export function measure(rows) {
  const seen = new Set();
  const out = [];
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const [label, key] of SIGNALS) {
    const buckets = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      (buckets.get(k) ?? buckets.set(k, []).get(k)).push(r);
    }
    let groups = 0; let pairs = 0; let fresh = 0;
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      groups += 1;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          pairs += 1;
          const pk = pairKey(list[i].lnr, list[j].lnr);
          if (!seen.has(pk)) { seen.add(pk); fresh += 1; }
        }
      }
    }
    out.push({ label, groups, pairs, fresh });
  }
  return out;
}

// ── Самоперевірка: арифметика доводиться на фікстурі, де відповідь відома ───
//
// Числа тут — з побудови, а не з даних: сімʼя з трьох під однією поштою дає
// рівно 3 пари за «поштою самою» і НУЛЬ за «поштою + імʼям».
if (process.argv.includes('--self-test')) {
  const rows = [
    { lnr: 1, name1: 'Weber', name2: 'Klaus', e_mail: 'w@e.com' },
    { lnr: 2, name1: 'Weber', name2: 'Petra', e_mail: 'w@e.com' },
    { lnr: 3, name1: 'Weber', name2: 'Lena', e_mail: 'w@e.com' },
    { lnr: 4, name1: 'Müller-Stub', name2: 'Jörg', e_mail: 'jm@e.com' },
    { lnr: 5, name1: 'Mueller-Stub', name2: 'Jörg', e_mail: 'JM@e.com' },
  ];
  const m = measure(rows);
  const by = (l) => m.find((x) => x.label.startsWith(l));
  const fail = [];
  const ok = (cond, what) => { console.log(`  ${cond ? 'ok  ' : 'ЧЕРВОНЕ  '}${what}`); if (!cond) fail.push(what); };
  ok(by('пошта + імʼя').pairs === 1, 'пошта+імʼя: рівно 1 пара — та сама людина двома написаннями');
  ok(by('ПОШТА САМА').pairs === 4, 'пошта сама: 4 пари — 3 сімейні плюс та сама одна');
  ok(by('ПОШТА САМА').fresh === 3, 'із них НОВИХ 3 — рівно сімʼя, якої сильніша ознака не бачить');
  // Число тут спершу було поставлене 4 — і самоперевірка його завалила, чим і
  // виправдала своє існування. Ознака групує ПОВНЕ імʼя, а троє Weber мають
  // різні імена (Klaus/Petra/Lena), тож сімʼя не дає жодної пари; пара рівно
  // одна — той самий Jörg двома написаннями. Саме прізвище дало б 3 пари, і
  // саме тому ознакою є повне імʼя, а не прізвище.
  ok(by('саме лише імʼя').pairs === 1, 'саме лише повне імʼя: 1 пара — сімʼя Weber сюди НЕ потрапляє');
  ok(by('саме лише імʼя').fresh === 0, 'і вона не нова: її вже знайшла сильніша ознака');
  if (fail.length) { console.error('\nсамоперевірка не пройшла'); process.exit(1); }
  console.log('winhotel-duplicate-signals: арифметика доведена на фікстурі; числа — лише зі справжнього витягу');
  process.exit(0);
}

const file = process.argv[2];
if (!file) {
  console.error('Вкажіть addresses.jsonl зі свіжого витягу (або --self-test).');
  console.error('У репозиторії рядків адрес НЕМАЄ навмисно — див. шапку.');
  process.exit(2);
}
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`адрес прочитано: ${rows.length}\n`);
console.log('ознака                                    груп     пар   з них нових');
for (const r of measure(rows)) {
  console.log(`${r.label.padEnd(40)} ${String(r.groups).padStart(6)} ${String(r.pairs).padStart(7)} ${String(r.fresh).padStart(13)}`);
}
console.log('\n«з них нових» — пари, яких не дала жодна сильніша ознака. Для «ПОШТА САМА»');
console.log('це і є ціна правила IMPORT-PLAN §2.7: здебільшого сімʼї під однією поштою.');
