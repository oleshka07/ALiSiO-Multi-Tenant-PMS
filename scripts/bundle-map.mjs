#!/usr/bin/env node
/**
 * bundle-map.mjs — карта SPA з її ж бандлів.
 *
 * Дістає з публічних JS/CSS застосунку повну карту продукту:
 * маршрути, API-ендпоінти, ключі локалізації (= перелік екранів і налаштувань),
 * дозволи, фіче-флаги, env-змінні, сторонні бібліотеки та вендорів.
 *
 * Логін НЕ потрібен: бандли віддаються як статика.
 * Залежностей немає. Node 18+ (глобальний fetch). Працює на Windows.
 *
 *   node scripts/bundle-map.mjs --base https://admin.hoteliera.com --out research
 *   node scripts/bundle-map.mjs --base https://reporting.hoteliera.com --out research
 *   node scripts/bundle-map.mjs --base https://guest.hoteliera.com --out research
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// ─────────────────────────── args ───────────────────────────

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? def : argv[i + 1]
}
const BASE = (arg('base') || '').replace(/\/+$/, '')
const OUT = arg('out', 'research')
const KEEP = argv.includes('--keep-raw')

if (!BASE) {
  console.error('Вкажіть --base, напр.: node scripts/bundle-map.mjs --base https://admin.hoteliera.com')
  process.exit(1)
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const log = (...a) => console.log('·', ...a)

// ─────────────────────────── fetch ───────────────────────────

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ← ${url}`)
  return { text: await res.text(), headers: Object.fromEntries(res.headers) }
}

// ─────────────────────────── helpers ───────────────────────────

const uniq = (a) => [...new Set(a)]
const collect = (str, re, group = 0) => {
  const out = []
  let m
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  while ((m = r.exec(str))) out.push(m[group])
  return out
}
const countOf = (str, needle) => str.split(needle).length - 1

// ─────────────────────────── extractors ───────────────────────────

function extractRoutes(js) {
  // vue-router / next: path:"/..."  та  to:"/..."
  const paths = [
    ...collect(js, /path\s*:\s*"(\/[^"]{0,120})"/, 1),
    ...collect(js, /path\s*:\s*'(\/[^']{0,120})'/, 1),
    ...collect(js, /\bto\s*:\s*"(\/[^"]{0,120})"/, 1),
  ]
  return uniq(paths).sort()
}

function extractEndpoints(js) {
  // рядки і шаблонні літерали, що починаються з /api/ або /admin/
  const raw = [
    ...collect(js, /["'`](\/(?:api|admin|v\d)\/[^"'`\s]{0,160})["'`]/, 1),
  ]
  // нормалізуємо ${...} у :param, щоб згорнути дублікати
  const norm = raw.map((u) =>
    u
      .replace(/\$\{[^}]*\}/g, ':id')
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/+$/, '')
  )
  const byMethodHint = {}
  for (const u of norm) byMethodHint[u] = (byMethodHint[u] || 0) + 1
  return {
    unique: uniq(norm).sort(),
    total: raw.length,
    frequency: Object.fromEntries(
      Object.entries(byMethodHint).sort((a, b) => b[1] - a[1]).slice(0, 60)
    ),
  }
}

function extractI18nKeys(js) {
  // виклики t("a.b.c") / $t('a.b.c') / e.t("a.b.c")
  const keys = uniq([
    ...collect(js, /\$?\bt\(\s*"([a-z0-9_]+(?:\.[a-z0-9_]+)+)"/i, 1),
    ...collect(js, /\$?\bt\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/i, 1),
  ]).sort()

  // дерево: namespace → section → [leaf...]
  const tree = {}
  for (const k of keys) {
    const [ns, sec, ...rest] = k.split('.')
    tree[ns] ??= {}
    const bucket = rest.length ? (tree[ns][sec] ??= []) : (tree[ns]._ ??= [])
    const leaf = rest.length ? rest.join('.') : sec
    if (leaf && !bucket.includes(leaf)) bucket.push(leaf)
  }
  return { keys, tree, namespaces: Object.keys(tree).sort() }
}

function extractPermissions(js) {
  return uniq([
    ...collect(js, /requiresPermission\s*:\s*"([^"]{1,80})"/, 1),
    ...collect(js, /permission\s*:\s*"([^"]{1,80})"/, 1),
    ...collect(js, /"(can_[a-z0-9_]{2,60})"/, 1),
    ...collect(js, /"(view_[a-z0-9_]{2,60})"/, 1),
    ...collect(js, /"(manage_[a-z0-9_]{2,60})"/, 1),
  ]).sort()
}

function extractFlags(js) {
  return uniq([
    ...collect(js, /"(extra_settings_[a-z0-9_]{2,60})"/, 1),
    ...collect(js, /"([a-z0-9_]{2,40}_enabled)"/, 1),
    ...collect(js, /"(feature_[a-z0-9_]{2,60})"/, 1),
    ...collect(js, /"(is_[a-z0-9_]{2,50}_active)"/, 1),
  ]).sort()
}

function extractEnv(js) {
  const pairs = {}
  for (const m of js.matchAll(/((?:VUE_APP|NEXT_PUBLIC|REACT_APP)_[A-Z0-9_]+)\s*:\s*"([^"]{0,200})"/g)) {
    pairs[m[1]] ??= m[2]
  }
  return pairs
}

function extractHosts(js) {
  const hosts = collect(js, /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i, 1)
  const tally = {}
  for (const h of hosts) tally[h] = (tally[h] || 0) + 1
  return Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]))
}

const LIB_PROBES = [
  'vue-router','vuex','pinia','axios','moment','dayjs','luxon','lodash','bootstrap-vue',
  'vee-validate','vue-i18n','vue-multiselect','tiptap','ProseMirror','quill','sortablejs',
  'vuedraggable','laravel-echo','pusher','socket.io','firebase','sentry','portal-vue',
  'sweetalert','maska','signature_pad','papaparse','xlsx','jspdf','html2canvas','stripe',
  'ag-grid','handsontable','fullcalendar','dhtmlx','vis-timeline','flatpickr','chart.js',
  'apexcharts','echarts','d3','leaflet','mapbox','iconify','headlessui','radix','reka',
  'tailwind','react','next','nuxt','svelte','angular','zod','valibot','ofetch','trpc','graphql',
]

const VENDOR_PROBES = [
  'zodomus','channex','nuitee','siteminder','cubilis','myallocator','beds24','wubook',
  'stripe','adyen','mobilpay','netopia','paypal','liqpay','fondy','wayforpay','monobank',
  'anaf','efactura','e-factura','hepos','oblio','smartbill','checkbox','vchasno',
  'cloudinary','uploadcare','imgix','crisp','intercom','zendesk','hubspot','mixpanel',
  'hotjar','clarity','posthog','amplitude','segment','googletagmanager','facebook.net',
  'pricelabs','roompricegenie','wheelhouse','beyond',
  'booking.com','airbnb','expedia','agoda','travelminit','szallas','hostelworld','despegar',
]

// Короткі токени (zod, d3, vue) дають хибні збіги всередині довших слів —
// для них рахуємо тільки по межах слова.
const SHORT = new Set(['zod', 'd3', 'vue', 'next', 'nuxt', 'react', 'ws'])

function probe(js, list) {
  const lower = js.toLowerCase()
  const found = {}
  for (const p of list) {
    let n
    if (SHORT.has(p)) {
      const re = new RegExp('(^|[^a-z0-9_-])' + p + '($|[^a-z0-9_-])', 'g')
      n = (lower.match(re) || []).length
    } else {
      n = countOf(lower, p.toLowerCase())
    }
    if (n) found[p] = n
  }
  return Object.fromEntries(Object.entries(found).sort((a, b) => b[1] - a[1]))
}

function extractComponents(js) {
  return uniq(collect(js, /resolveComponent\(\s*"([A-Z][A-Za-z0-9_]{2,60})"/, 1)).sort()
}

// ─────────────────────────── report ───────────────────────────

function md(base, r) {
  const L = []
  const p = (s = '') => L.push(s)
  const host = new URL(base).host

  p(`# Карта бандла: ${host}`)
  p()
  p(`**Знято:** ${new Date().toISOString()}`)
  p(`**Джерело:** публічні статичні бандли, без автентифікації.`)
  p()
  p('| | |')
  p('|---|---|')
  p(`| Файлів JS | ${r.assets.js.length} |`)
  p(`| Файлів CSS | ${r.assets.css.length} |`)
  p(`| Розмір JS (розпаковано) | ${(r.totals.jsBytes / 1048576).toFixed(2)} МБ |`)
  p(`| Маршрутів | ${r.routes.length} |`)
  p(`| Унікальних ендпоінтів | ${r.endpoints.unique.length} |`)
  p(`| Ключів локалізації | ${r.i18n.keys.length} |`)
  p(`| Namespace'ів (модулів) | ${r.i18n.namespaces.length} |`)
  p()

  p('## Модулі продукту')
  p()
  p('Namespace локалізації = модуль. Це найповніший перелік функціональності.')
  p()
  for (const ns of r.i18n.namespaces) {
    const secs = Object.keys(r.i18n.tree[ns]).filter((s) => s !== '_')
    p(`- **${ns}** — ${secs.length ? secs.slice(0, 18).join(', ') : '—'}${secs.length > 18 ? ', …' : ''}`)
  }
  p()

  p('## Маршрути')
  p()
  p('```')
  r.routes.forEach((x) => p(x))
  p('```')
  p()

  p('## API-ендпоінти')
  p()
  p('```')
  r.endpoints.unique.forEach((x) => p(x))
  p('```')
  p()

  if (r.flags.length) {
    p('## Фіче-флаги')
    p()
    p('```')
    r.flags.forEach((x) => p(x))
    p('```')
    p()
  }

  if (r.permissions.length) {
    p('## Дозволи')
    p()
    p('```')
    r.permissions.forEach((x) => p(x))
    p('```')
    p()
  }

  p('## Сторонні вендори й інтеграції')
  p()
  p('| Вендор | Згадок |')
  p('|---|---|')
  for (const [k, v] of Object.entries(r.vendors)) p(`| ${k} | ${v} |`)
  p()

  p('## Бібліотеки')
  p()
  p('| Бібліотека | Згадок |')
  p('|---|---|')
  for (const [k, v] of Object.entries(r.libs)) p(`| ${k} | ${v} |`)
  p()

  if (Object.keys(r.env).length) {
    p('## Env-змінні в білді')
    p()
    p('> Усе тут доступне будь-кому, хто відкриє сайт. Якщо серед них є секрет — це витік.')
    p()
    p('| Змінна | Значення |')
    p('|---|---|')
    for (const [k, v] of Object.entries(r.env)) p(`| \`${k}\` | \`${v.slice(0, 90)}\` |`)
    p()
  }

  p('## Зовнішні хости')
  p()
  p('| Хост | Згадок |')
  p('|---|---|')
  for (const [k, v] of Object.entries(r.hosts).slice(0, 50)) p(`| ${k} | ${v} |`)
  p()

  if (r.components.length) {
    p('## Vue-компоненти (за іменами в resolveComponent)')
    p()
    p('```')
    r.components.forEach((x) => p(x))
    p('```')
    p()
  }

  p('---')
  p()
  p('_Згенеровано `bundle-map.mjs`. Дані отримано з публічних статичних файлів; доступу до чужого коду, інфраструктури чи даних не було._')
  return L.join('\n')
}

// ─────────────────────────── main ───────────────────────────

const t0 = Date.now()
log('Читаю', BASE)

const index = await get(BASE + '/')
const html = index.text

const abs = (u) => (u.startsWith('http') ? u : new URL(u, BASE + '/').href)
const sameOrigin = (u) => {
  try { return new URL(abs(u)).host === new URL(BASE).host } catch { return false }
}

const jsUrls = uniq(collect(html, /<script[^>]+src="([^"]+)"/i, 1).map(abs).filter(sameOrigin))
const cssUrls = uniq(collect(html, /<link[^>]+href="([^"]+\.css[^"]*)"/i, 1).map(abs).filter(sameOrigin))

if (!jsUrls.length) {
  console.error('Не знайшов жодного власного JS у HTML. Перевірте --base (можливо, потрібен інший піддомен).')
  process.exit(2)
}

log(`Знайдено ${jsUrls.length} JS та ${cssUrls.length} CSS`)

let js = ''
const assetsJs = []
for (const u of jsUrls) {
  try {
    const { text } = await get(u)
    js += '\n' + text
    assetsJs.push({ url: u, bytes: text.length })
    log(`  ${u.split('/').pop()} — ${(text.length / 1048576).toFixed(2)} МБ`)
  } catch (e) {
    log('  !', e.message)
  }
}

let css = ''
const assetsCss = []
for (const u of cssUrls) {
  try {
    const { text } = await get(u)
    css += '\n' + text
    assetsCss.push({ url: u, bytes: text.length })
  } catch (e) {
    log('  !', e.message)
  }
}

log('Розбираю…')

const i18n = extractI18nKeys(js)
const report = {
  base: BASE,
  takenAt: new Date().toISOString(),
  serverHeaders: index.headers,
  assets: { js: assetsJs, css: assetsCss },
  totals: { jsBytes: js.length, cssBytes: css.length },
  routes: extractRoutes(js),
  endpoints: extractEndpoints(js),
  i18n,
  permissions: extractPermissions(js),
  flags: extractFlags(js),
  env: extractEnv(js),
  hosts: extractHosts(js),
  libs: probe(js, LIB_PROBES),
  vendors: probe(js, VENDOR_PROBES),
  components: extractComponents(js),
}

const host = new URL(BASE).host.replace(/[^a-z0-9.]/gi, '_')
await mkdir(OUT, { recursive: true })
await writeFile(join(OUT, `${host}.json`), JSON.stringify(report, null, 2), 'utf8')
await writeFile(join(OUT, `${host}.md`), md(BASE, report), 'utf8')
if (KEEP) await writeFile(join(OUT, `${host}.bundle.js`), js, 'utf8')

log('')
log(`Готово за ${((Date.now() - t0) / 1000).toFixed(1)} с`)
log(`  ${join(OUT, host + '.md')}   ← читати це`)
log(`  ${join(OUT, host + '.json')} ← для дифів між прогонами`)
log('')
log(`Маршрутів: ${report.routes.length} · ендпоінтів: ${report.endpoints.unique.length} · модулів: ${i18n.namespaces.length} · ключів i18n: ${i18n.keys.length}`)
