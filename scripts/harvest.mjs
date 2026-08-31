#!/usr/bin/env node
/**
 * harvest.mjs — знімок автентифікованого SPA: екрани, форми, мережа, дизайн-токени.
 *
 * Призначення: зібрати структуру чужого продукту для аналізу — які є налаштування,
 * як вони згруповані, які поля у формах, які JSON віддає їхній API (= форма їхніх даних).
 *
 *   npm i -D playwright        (або вже стоїть)
 *
 *   # 1. один раз: логін руками, сесія збережеться
 *   node scripts/harvest.mjs --base https://admin.hoteliera.com --login --channel chrome
 *
 *   # 2. збір (можна лишити без нагляду)
 *   node scripts/harvest.mjs --base https://admin.hoteliera.com --run --channel chrome
 *
 * Читає список маршрутів із research/<host>.json (вихід bundle-map.mjs), якщо є.
 * Персональні дані вирізаються на льоту — у файли потрапляє структура, не вміст.
 */

import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

// ─────────────────────────── args ───────────────────────────

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1] }
const has = (n) => argv.includes('--' + n)

const BASE = (arg('base') || '').replace(/\/+$/, '')
const OUT = arg('out', 'harvest')
const RESEARCH = arg('research', 'research')
const CHANNEL = arg('channel', null)
const EXEC = arg('exec', null)
const launchOpts = { channel: CHANNEL || undefined, executablePath: EXEC || undefined }
const MAX = parseInt(arg('max', '250'), 10)
const WAIT = parseInt(arg('wait', '2600'), 10)
const HASH = !has('no-hash')

if (!BASE || (!has('login') && !has('run') && !has('walk'))) {
  console.error(`
harvest.mjs

  --base <url>     обов'язково, напр. https://admin.hoteliera.com
  --login          відкрити браузер для ручного входу і зберегти сесію
  --run            зібрати дані
  --channel chrome використати встановлений Chrome замість збірки Playwright
  --max N          межа кількості екранів (типово 250)
  --wait ms        пауза після переходу (типово 2600)
  --no-hash        якщо застосунок НЕ використовує #/ маршрути
  --walk           записати живу «прогулянку»: ви клікаєте, скрипт знімає кожен крок
  --exec <path>    явний шлях до браузера
  --out dir        тека результату (типово harvest)
`)
  process.exit(1)
}

const HOST = new URL(BASE).host.replace(/[^a-z0-9.]/gi, '_')
const STATE = join(OUT, `${HOST}.session.json`)
const log = (...a) => console.log('·', ...a)

// ─────────────────── знеособлення ───────────────────
// У файли має потрапити СТРУКТУРА, а не чужі персональні дані.

const PII_KEYS = /^(name|surname|first_?name|last_?name|full_?name|guest_?name|email|mail|phone|mobile|tel|address|street|city|zip|postal|passport|document_?number|iban|card_?number|cardholder|cvv|birth|dob|notes?|comment|signature|ip|lat|lng|latitude|longitude)$/i
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/
const digitsIn = (s) => (s.match(/\d/g) || []).length
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g

function redactValue(v) {
  if (typeof v !== 'string') return v
  // Дати не мають потрапляти під «телефон» — вони структурно важливі.
  return v
    .replace(EMAIL_RE, '«email»')
    .replace(CARD_RE, (m) => (digitsIn(m) >= 13 ? '«card»' : m))
    .replace(PHONE_RE, (m) => (ISO_DATE_RE.test(m.trim()) || digitsIn(m) < 9 ? m : '«phone»'))
}

function redact(node, depth = 0) {
  if (depth > 12) return '«deep»'
  if (Array.isArray(node)) return node.slice(0, 25).map((x) => redact(x, depth + 1))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (PII_KEYS.test(k)) {
        out[k] = v === null ? null : `«${typeof v}»`      // тип лишаємо, вміст ні
      } else {
        out[k] = redact(v, depth + 1)
      }
    }
    return out
  }
  return redactValue(node)
}

/** Схема JSON: імена полів і типи, без значень. Саме це нам і потрібно. */
function shape(node, depth = 0) {
  if (depth > 8) return '…'
  if (Array.isArray(node)) return node.length ? [shape(node[0], depth + 1)] : []
  if (node === null) return 'null'
  if (typeof node === 'object') {
    const o = {}
    for (const [k, v] of Object.entries(node)) o[k] = shape(v, depth + 1)
    return o
  }
  if (typeof node === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(node)) return 'datetime'
    if (/^\d{4}-\d{2}-\d{2}$/.test(node)) return 'date'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(node)) return 'uuid'
    if (/^-?\d+(\.\d+)?$/.test(node)) return 'numeric-string'
    return 'string'
  }
  return typeof node
}

const slug = (s) => (s.replace(/^[#/]+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root').slice(0, 70)

// ─────────────────── маршрути ───────────────────

const FALLBACK_ROUTES = [
  '/', '/reservations', '/guests', '/invoice', '/housekeeping', '/messages',
  '/statistics', '/statistics-reservations', '/meal-plans-report', '/mainteinance',
  '/planner-v2', '/pages',
]

async function loadRoutes() {
  const f = join(RESEARCH, `${HOST}.json`)
  if (existsSync(f)) {
    try {
      const r = JSON.parse(await readFile(f, 'utf8'))
      const routes = (r.routes || []).filter((p) => p && !p.includes(':') && !/login|register|reset|logout/i.test(p))
      if (routes.length) { log(`Маршрути з ${f}: ${routes.length}`); return routes }
    } catch { /* ignore */ }
  }
  log('research-JSON не знайдено — беру базовий список. Спершу краще прогнати bundle-map.mjs')
  return FALLBACK_ROUTES
}

// ─────────────────── збирачі в сторінці ───────────────────

const FORM_SCRIPT = `(() => {
  const label = (el) => {
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.innerText.trim(); }
    const w = el.closest('label'); if (w) return w.innerText.trim();
    const grp = el.closest('.form-group,.field,[class*="form"],[class*="field"]');
    if (grp) { const l = grp.querySelector('label,.label,legend'); if (l) return l.innerText.trim(); }
    return null;
  };
  const ctl = [...document.querySelectorAll('input,select,textarea,[role="switch"],[role="combobox"]')]
    .filter(el => el.offsetParent !== null || el.type === 'hidden')
    .slice(0, 400)
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || el.getAttribute('role') || null,
      name: el.getAttribute('name') || el.getAttribute('id') || null,
      label: label(el),
      placeholder: el.getAttribute('placeholder') || null,
      required: el.hasAttribute('required') || null,
      disabled: el.disabled || null,
      testId: el.getAttribute('test-id') || el.getAttribute('data-test') || null,
      options: el.tagName === 'SELECT'
        ? [...el.options].slice(0, 40).map(o => ({ value: o.value, text: o.text.trim() }))
        : null,
    }));
  const sections = [...document.querySelectorAll('h1,h2,h3,h4,legend,.card-header,[class*="section"] > .title')]
    .slice(0, 120).map(h => ({ tag: h.tagName.toLowerCase(), text: h.innerText.trim().slice(0, 120) }))
    .filter(h => h.text);
  const tabs = [...document.querySelectorAll('[role="tab"],.nav-tabs a,.nav-tabs button,[class*="tab"] > a')]
    .slice(0, 60).map(t => t.innerText.trim()).filter(Boolean);
  const buttons = [...document.querySelectorAll('button,a.btn,[role="button"]')]
    .slice(0, 120).map(b => b.innerText.trim()).filter(Boolean);
  const tables = [...document.querySelectorAll('table')].slice(0, 10).map(t => ({
    columns: [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()).filter(Boolean),
    rows: t.querySelectorAll('tbody tr').length,
  }));
  const links = [...document.querySelectorAll('a[href]')]
    .map(a => a.getAttribute('href')).filter(h => h && (h.startsWith('#/') || h.startsWith('/')));
  return { controls: ctl, sections, tabs, buttons, tables, links: [...new Set(links)].slice(0, 300) };
})()`

const DESIGN_SCRIPT = `(() => {
  const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const s = getComputedStyle(e);
    return { sel, color: s.color, background: s.backgroundColor, border: s.borderColor,
             radius: s.borderRadius, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight,
             padding: s.padding, shadow: s.boxShadow }; };
  const tally = {};
  document.querySelectorAll('*').forEach(e => {
    const s = getComputedStyle(e);
    for (const k of ['color','backgroundColor','borderColor']) {
      const v = s[k];
      if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') tally[v] = (tally[v]||0)+1;
    }
  });
  const colors = Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,30);
  const fonts = [...new Set(
    [...document.querySelectorAll('h1,h2,h3,body,button,input,table')].map(e => getComputedStyle(e).fontFamily)
  )].slice(0,8);
  return { colors, fonts, samples: ['body','h1','h2','button','.btn-primary','input','table th','.card','.modal-content','nav'].map(pick).filter(Boolean) };
})()`

// ─────────────────── login ───────────────────

async function doLogin() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: false, ...launchOpts })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  console.log('\n  Увійдіть у відкритому вікні, доведіть до головного екрана.')
  console.log('  Потім поверніться сюди й натисніть Enter.\n')
  await new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('  Готово? Enter → ', () => { rl.close(); res() })
  })
  await ctx.storageState({ path: STATE })
  await browser.close()
  log(`Сесію збережено: ${STATE}`)
  log('Далі: node scripts/harvest.mjs --base ' + BASE + ' --run' + (CHANNEL ? ' --channel ' + CHANNEL : ''))
}

// ─────────────────── run ───────────────────

async function doRun() {
  if (!existsSync(STATE)) {
    console.error(`Немає збереженої сесії (${STATE}). Спершу запустіть із --login`)
    process.exit(2)
  }
  const routes = (await loadRoutes()).slice(0, MAX)
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true, ...launchOpts })
  const ctx = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  })

  // ── перехоплення API ──
  const apiByRoute = new Map()
  let current = 'boot'
  ctx.on('response', async (res) => {
    try {
      const url = res.url()
      if (!/\/api\//.test(url)) return
      const ct = res.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      let body = null
      try { body = await res.json() } catch { return }
      const rec = {
        method: res.request().method(),
        url: url.replace(BASE, '').split('?')[0],
        query: new URL(url).search || null,
        status: res.status(),
        shape: shape(body),
        sample: redact(body),
      }
      const s = JSON.stringify(rec.sample)
      if (s && s.length > 60000) rec.sample = '«великий обсяг — лишено тільки схему»'
      if (!apiByRoute.has(current)) apiByRoute.set(current, [])
      apiByRoute.get(current).push(rec)
    } catch { /* ignore */ }
  })

  const page = await ctx.newPage()
  const index = []
  const allEndpoints = new Map()

  for (const [i, route] of routes.entries()) {
    const name = slug(route)
    current = name
    const url = HASH ? `${BASE}/#${route}` : `${BASE}${route}`
    process.stdout.write(`  [${i + 1}/${routes.length}] ${route} … `)
    const dir = join(OUT, name)
    try {
      await mkdir(dir, { recursive: true })
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      // хеш-маршрути не тригерять повне завантаження — перезавантажуємо для чистоти
      if (HASH && i > 0) { await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }) }
      await page.waitForTimeout(WAIT)
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}

      await page.screenshot({ path: join(dir, 'page.png'), fullPage: true })
      const struct = await page.evaluate(FORM_SCRIPT)
      const text = (await page.evaluate('document.body.innerText')).slice(0, 20000)

      await writeFile(join(dir, 'structure.json'), JSON.stringify(struct, null, 2), 'utf8')
      await writeFile(join(dir, 'text.txt'), redactValue(text), 'utf8')

      const api = apiByRoute.get(name) || []
      if (api.length) {
        await writeFile(join(dir, 'api.json'), JSON.stringify(api, null, 2), 'utf8')
        for (const r of api) {
          const key = `${r.method} ${r.url}`
          if (!allEndpoints.has(key)) allEndpoints.set(key, r.shape)
        }
      }

      index.push({
        route, name,
        title: await page.title(),
        controls: struct.controls.length,
        tabs: struct.tabs.length,
        sections: struct.sections.length,
        tables: struct.tables.length,
        apiCalls: api.length,
      })
      console.log(`ок — ${struct.controls.length} полів, ${api.length} запитів`)
    } catch (e) {
      console.log('помилка:', e.message.split('\n')[0])
      index.push({ route, name, error: e.message.split('\n')[0] })
    }
  }

  // дизайн-токени — один раз, з головного екрана
  try {
    await page.goto(HASH ? BASE + '/#/' : BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(WAIT)
    const design = await page.evaluate(DESIGN_SCRIPT)
    await writeFile(join(OUT, '_design.json'), JSON.stringify(design, null, 2), 'utf8')
  } catch (e) { log('дизайн-токени не зняв:', e.message.split('\n')[0]) }

  await writeFile(join(OUT, '_index.json'), JSON.stringify(index, null, 2), 'utf8')
  await writeFile(
    join(OUT, '_api-schema.json'),
    JSON.stringify(Object.fromEntries([...allEndpoints.entries()].sort()), null, 2),
    'utf8'
  )

  await browser.close()

  const ok = index.filter((x) => !x.error).length
  console.log('')
  log(`Зібрано ${ok}/${index.length} екранів`)
  log(`  ${join(OUT, '_index.json')}       ← карта екранів`)
  log(`  ${join(OUT, '_api-schema.json')}  ← ЇХНЯ МОДЕЛЬ ДАНИХ, зведена з усіх відповідей`)
  log(`  ${join(OUT, '_design.json')}      ← кольори, шрифти, радіуси`)
  log(`  ${join(OUT, '<екран>/')}          ← скріншот, форми, мережа, текст`)
  console.log('')
  log('Персональні дані знеособлені: у файлах структура, не вміст.')
}


// ─────────────────── walk: жива прогулянка ───────────────────
// Headless-обхід не бачить тултіпів, поповерів і покрокових майстрів —
// вони існують лише в реальній взаємодії. Тут ви клікаєте самі,
// а скрипт знімає кожен крок: скріншот, що саме натиснуто, що спливло, які запити пішли.

const WALK_INIT = () => {
  const OVERLAY =
    '[role="dialog"],[role="tooltip"],[role="alertdialog"],.modal,.popover,.tooltip,.toast,' +
    '[class*="tooltip"],[class*="popover"],[class*="modal"],[class*="toast"],[class*="drawer"],[class*="dropdown-menu"]'
  const send = (n) => { try { window.__hvNote(n) } catch (e) {} }
  const desc = (t) => ({
    tag: t.tagName,
    text: (t.innerText || t.value || t.getAttribute?.('aria-label') || '').trim().slice(0, 90),
    testId: t.getAttribute?.('test-id') || t.getAttribute?.('data-test') || null,
    href: t.getAttribute?.('href') || null,
    cls: (t.className && t.className.toString ? t.className.toString() : '').slice(0, 120),
  })
  addEventListener('click', (e) => {
    const t = e.target.closest('button,a,[role="button"],input,select,label,[class*="btn"]') || e.target
    send({ kind: 'click', at: Date.now(), target: desc(t), hash: location.hash })
  }, true)
  const seen = new WeakSet()
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue
        const el = n.matches && n.matches(OVERLAY) ? n : (n.querySelector && n.querySelector(OVERLAY))
        if (!el || seen.has(el)) continue
        seen.add(el)
        const text = (el.innerText || '').trim()
        if (!text) continue
        send({ kind: 'overlay', at: Date.now(), cls: (el.className || '').toString().slice(0, 140), text: text.slice(0, 800), hash: location.hash })
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true })
  let lastHash = location.hash
  setInterval(() => {
    if (location.hash !== lastHash) { lastHash = location.hash; send({ kind: 'route', at: Date.now(), hash: location.hash }) }
  }, 400)
}

async function doWalk() {
  if (!existsSync(STATE)) {
    console.error(`Немає збереженої сесії (${STATE}). Спершу запустіть із --login`)
    process.exit(2)
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
  const dir = join(OUT, '_walk-' + stamp)   // кожна прогулянка — своя тека, нічого не перезаписується
  await mkdir(dir, { recursive: true })

  const browser = await chromium.launch({ headless: false, ...launchOpts })
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 950 } })

  const net = []
  ctx.on('response', async (res) => {
    try {
      const url = res.url()
      if (!/\/api\//.test(url)) return
      if (!(res.headers()['content-type'] || '').includes('json')) return
      let body = null
      try { body = await res.json() } catch { return }
      net.push({ at: Date.now(), method: res.request().method(), url: url.replace(BASE, '').split('?')[0], status: res.status(), shape: shape(body) })
    } catch {}
  })

  const page = await ctx.newPage()
  const steps = []
  let pending = []
  let n = 0

  await page.exposeBinding('__hvNote', async (_src, note) => { pending.push(note) })
  await page.addInitScript(WALK_INIT)
  await page.goto(HASH ? BASE + '/#/' : BASE, { waitUntil: 'domcontentloaded' })

  console.log('\n  Вікно відкрито. Проходьте онбординг / налаштування як звичайний користувач.')
  console.log('  Кожен клік, кожне спливаюче вікно і кожен запит записуються.')
  console.log('  Коли завершите — поверніться сюди й натисніть Enter.\n')

  let stop = false
  const stopper = new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('  Записую… Enter щоб зупинити → ', () => { rl.close(); stop = true; res() })
  })

  const loop = (async () => {
    while (!stop) {
      await new Promise((r) => setTimeout(r, 700))
      if (!pending.length) continue
      const batch = pending; pending = []
      const note = batch.find((x) => x.kind === 'overlay') || batch[batch.length - 1]
      n += 1
      const label = slug(
        (note.kind === 'click' ? note.target?.text : note.kind === 'overlay' ? note.text.slice(0, 40) : note.hash) || note.kind
      )
      const file = `${String(n).padStart(3, '0')}-${note.kind}-${label}.png`
      try {
        await page.waitForTimeout(450)
        await page.screenshot({ path: join(dir, file), fullPage: false })
        const visible = await page.evaluate('document.body.innerText').catch(() => '')
        steps.push({
          n, file,
          kind: note.kind,
          hash: note.hash || null,
          clicked: note.target || null,
          overlay: note.kind === 'overlay' ? note.text : null,
          alsoInBatch: batch.length > 1 ? batch.map((b) => b.kind) : undefined,
          visibleText: redactValue(String(visible).slice(0, 1500)),
        })
        process.stdout.write(`\r  крок ${n}: ${note.kind} ${label.slice(0, 40)}`.padEnd(78))
      } catch {}
    }
  })()

  await stopper
  await loop
  await writeFile(join(dir, 'walk.json'), JSON.stringify(steps, null, 2), 'utf8')
  await writeFile(join(dir, 'walk-network.json'), JSON.stringify(net, null, 2), 'utf8')

  const md = ['# Прогулянка: записані кроки', '', `Кроків: ${steps.length} · запитів до API: ${net.length}`, '']
  for (const s2 of steps) {
    md.push(`## ${s2.n}. ${s2.kind}${s2.hash ? ' · ' + s2.hash : ''}`)
    if (s2.clicked) md.push(`**Натиснуто:** ${s2.clicked.tag} «${s2.clicked.text}»${s2.clicked.testId ? ' · test-id: `' + s2.clicked.testId + '`' : ''}`)
    if (s2.overlay) { md.push('', '**Спливло:**', '', '```', s2.overlay, '```') }
    md.push('', `![крок ${s2.n}](./${s2.file})`, '')
  }
  await writeFile(join(dir, 'walk.md'), md.join('\n'), 'utf8')

  await browser.close()
  console.log('')
  log(`Записано ${steps.length} кроків і ${net.length} запитів`)
  log(`  ${join(dir, 'walk.md')}   ← читати це, картинки поруч`)
  log(`  ${join(dir, 'walk.json')} ← структуровано`)
}

await mkdir(OUT, { recursive: true })
if (has('login')) await doLogin()
if (has('walk')) await doWalk()
if (has('run')) await doRun()
