/**
 * Том, чия точка монтування не існує в образі.
 *
 *   node scripts/check-volume-dirs.mjs [--strict]
 *
 * ── Що сталося ──────────────────────────────────────────────────────────────
 *
 * 10.09.2026 зʼявився третій том — `winhotel-snapshots` на `/app/data/winhotel`.
 * Dockerfile створював і віддавав користувачеві `nextjs` дві теки: `/app/data`
 * і `/app/public/uploads`. Третьої в тому списку не було, і 18.09.2026 на
 * живому сервері готелю кожне завантаження знімка відповідало
 *
 *   EACCES: permission denied, mkdir '/app/data/winhotel/org_…'
 *
 * Том створено 10.09 о 19:23 і від того дня він стояв порожній — вісім діб.
 *
 * ── Чому саме так, а не «права загубились» ──────────────────────────────────
 *
 * Docker переносить власника з ОБРАЗУ на свіжий іменований том лише тоді, коли
 * точка монтування в образі **вже існує**. Немає теки — Docker створює її сам,
 * від root, і непривілейований користувач контейнера туди не пише. Тобто два
 * томи з трьох працювали не тому, що так налаштовано, а тому, що їхні теки
 * випадково були в `mkdir -p`; третій відрізнявся лише цим.
 *
 * `mkdir -p /app/data` ДИТИНИ не створює. Саме тому властивість нижче вимагає
 * ТОЧНОГО згадування шляху в `mkdir`, а не покриття предком:
 *
 *   mkdir  — точний шлях, бо предок не створює дитину;
 *   chown  — точний шлях АБО предок під `-R`, бо рекурсивна зміна власника
 *            після `mkdir` дитину вже накриває.
 *
 * ── Що стверджується ────────────────────────────────────────────────────────
 *
 * Для кожного сервісу compose, який ми САМІ збираємо (`build:`), кожна точка
 * монтування ІМЕНОВАНОГО тому названа в Dockerfile цього сервісу в `mkdir` —
 * точно — і накрита `chown` — точно або рекурсивним предком.
 *
 * Прив'язані теки (`./x:/y`) не рахуються: там власник приходить з хоста, і
 * образ на нього не впливає. Сервіси без `build:` теж ні — чужий образ не наш,
 * і `postgres` сам розбирається зі своїм `/var/lib/postgresql/data`.
 *
 * Клас — «написане не доїхало до працюючої системи» (INC-050): том оголошено,
 * шлях названо, застосунок у нього пише, документація його описує — і в образі
 * теки немає. Жоден інший гейт цього не бачить за побудовою: `docker build`
 * успішний, контейнер піднімається, `/api/health` каже `ok`, і ламається лише
 * той один маршрут, який туди пише.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');

const COMPOSE_FILES = ['deploy/docker-compose.yml', 'docker-compose.yml'];

/**
 * Дуже вузький розбір compose: нам треба лише `services.<name>.{build,volumes}`
 * і перелік іменованих томів верхнього рівня. Повного YAML тут не беремо
 * навмисно — `yaml` у дереві лише транзитивно, а гейт, який зникає разом із
 * чужою залежністю, це гейт, який одного дня мовчки не побіжить.
 */
function parseCompose(text) {
  const lines = text.split(/\r?\n/);
  const services = new Map();
  const namedVolumes = new Set();

  let section = null;          // 'services' | 'volumes' | null
  let service = null;          // поточний сервіс
  let key = null;              // ключ усередині сервісу: 'build' | 'volumes' | …

  const indentOf = (l) => l.length - l.trimStart().length;

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const body = line.trim();

    if (indent === 0) {
      section = body === 'services:' ? 'services' : body === 'volumes:' ? 'volumes' : null;
      service = null;
      key = null;
      continue;
    }

    if (section === 'volumes' && indent === 2) {
      namedVolumes.add(body.replace(/:.*$/, '').trim());
      continue;
    }

    if (section !== 'services') continue;

    if (indent === 2) {
      service = body.replace(/:$/, '').trim();
      services.set(service, { build: {}, volumes: [] });
      key = null;
      continue;
    }
    if (!service) continue;

    if (indent === 4) {
      key = body.replace(/:.*$/, '').trim();
      // `build: .` в один рядок — контекст без окремого Dockerfile.
      const inline = body.slice(key.length + 1).trim();
      if (key === 'build' && inline) services.get(service).build.context = unquote(inline);
      continue;
    }

    if (indent >= 6 && key === 'build') {
      const m = /^([a-z_]+):\s*(.+)$/.exec(body);
      if (m) services.get(service).build[m[1]] = unquote(m[2]);
      continue;
    }

    if (indent >= 6 && key === 'volumes' && body.startsWith('- ')) {
      services.get(service).volumes.push(unquote(body.slice(2).trim()));
    }
  }

  return { services, namedVolumes };
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Цілі `mkdir` і `chown` у Dockerfile. Рядки склеюються по `\`, далі
 * розбиваються по `&&` і `;` — тобто читається КОМАНДА, а не рядок: інакше
 * `mkdir -p a \` + `b` порахувався б за одну ціль.
 */
function dockerfileDirs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const joined = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
    .replace(/\\\n/g, ' ');

  const mkdir = new Set();
  const chownExact = new Set();
  const chownRecursive = new Set();

  for (const command of joined.split(/&&|;|\n/)) {
    const words = command.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const start = words[0] === 'RUN' ? 1 : 0;
    const name = words[start];
    const args = words.slice(start + 1).map(unquote);

    if (name === 'mkdir') {
      for (const a of args) if (!a.startsWith('-')) mkdir.add(normalize(a));
    } else if (name === 'chown') {
      const recursive = args.some((a) => a === '-R' || a === '--recursive' || /^-[a-zA-Z]*R[a-zA-Z]*$/.test(a));
      const rest = args.filter((a) => !a.startsWith('-'));
      // Перший непрапорцевий аргумент — власник (`user:group`), решта — шляхи.
      for (const p of rest.slice(1)) (recursive ? chownRecursive : chownExact).add(normalize(p));
    }
  }

  return { mkdir, chownExact, chownRecursive };
}

const normalize = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

const problems = [];
let checked = 0;

for (const composeFile of COMPOSE_FILES) {
  if (!fs.existsSync(composeFile)) continue;
  const composeDir = path.dirname(composeFile);
  const { services, namedVolumes } = parseCompose(fs.readFileSync(composeFile, 'utf8'));

  for (const [name, service] of services) {
    const { build, volumes } = service;
    // Чужий образ — не наша справа: ми його не збираємо і теку в ньому не
    // створимо. Власник `/var/lib/postgresql/data` — турбота postgres.
    if (!build || (!build.context && !build.dockerfile)) continue;

    const dockerfile = path.resolve(composeDir, build.context || '.', build.dockerfile || 'Dockerfile');
    if (!fs.existsSync(dockerfile)) {
      problems.push({
        where: `${composeFile} → ${name}`,
        what: `Dockerfile не знайдено: ${path.relative(process.cwd(), dockerfile)}`,
        fix: 'перевірте build.context і build.dockerfile',
      });
      continue;
    }

    const dirs = dockerfileDirs(dockerfile);
    const rel = path.relative(process.cwd(), dockerfile);

    for (const entry of volumes) {
      const parts = entry.split(':');
      if (parts.length < 2) continue;
      const [source, target] = parts;
      // Прив'язана тека хоста — власник приходить звідти, не з образу.
      if (!namedVolumes.has(source)) continue;

      const mount = normalize(target);
      checked++;

      if (!dirs.mkdir.has(mount)) {
        problems.push({
          where: `${composeFile} → ${name}`,
          what: `том \`${source}\` монтується в \`${mount}\`, а в ${rel} цієї теки не створює жоден mkdir`,
          fix: `допишіть \`${mount}\` у mkdir -p (саме цей шлях: предок дитини не створює)`,
        });
      }

      const chowned =
        dirs.chownExact.has(mount) ||
        [...dirs.chownRecursive].some((p) => mount === p || mount.startsWith(p + '/'));
      if (!chowned) {
        problems.push({
          where: `${composeFile} → ${name}`,
          what: `том \`${source}\` монтується в \`${mount}\`, а в ${rel} цю теку не віддає користувачеві жоден chown`,
          fix: `допишіть \`${mount}\` у chown (або накрийте предком під -R)`,
        });
      }
    }
  }
}

console.log('check-volume-dirs');
if (problems.length === 0) {
  console.log(`  чисто — ${checked} точок монтування іменованих томів створені й віддані в образі`);
  process.exit(0);
}

for (const p of problems) {
  console.log(`  ✗ ${p.where}`);
  console.log(`      ${p.what}`);
  console.log(`      → ${p.fix}`);
}
console.log(`\n  ${problems.length} — том, чия тека не існує в образі, Docker створює від root:`);
console.log('  застосунок відповідає EACCES на кожен запис, а контейнер при цьому здоровий.');
process.exit(strict ? 1 : 0);
