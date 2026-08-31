#!/usr/bin/env node
/** Зводить усі прогони (--run + прогулянки) в один довідник API та каталог форм. */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const H = 'harvest', OUT = 'docs/research'
const j = async (p) => JSON.parse(await readFile(p, 'utf8'))
const merge = (dst, key, shape, src) => {
  if (!dst[key]) dst[key] = { shape, seenIn: [src] }
  else { dst[key].seenIn.includes(src) || dst[key].seenIn.push(src)
         if (JSON.stringify(shape).length > JSON.stringify(dst[key].shape).length) dst[key].shape = shape }
}

const api = {}
if (existsSync(join(H, '_api-schema.json')))
  for (const [k, v] of Object.entries(await j(join(H, '_api-schema.json')))) merge(api, k, v, 'run')
for (const d of ['walk-01-onboarding', 'walk-02-settings'])
  if (existsSync(join(H, d, 'walk-network.json')))
    for (const r of await j(join(H, d, 'walk-network.json')))
      if (!/sentry|clarity|hotjar|mixpanel|google|facebook/.test(r.url)) merge(api, `${r.method} ${r.url}`, r.shape, d)

const forms = []
for (const d of await readdir(H, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('_') || d.name.startsWith('walk-')) continue
  const p = join(H, d.name, 'structure.json')
  if (!existsSync(p)) continue
  const s = await j(p)
  forms.push({ screen: d.name, sections: s.sections.map(x => x.text), tabs: s.tabs,
    tables: s.tables.filter(t => t.columns.length), buttons: [...new Set(s.buttons)].slice(0, 20),
    controls: s.controls.filter(c => c.label || c.name).map(c => ({
      label: c.label, name: c.name, tag: c.tag, type: c.type, required: c.required,
      options: c.options?.map(o => o.text || o.value).slice(0, 12) })) })
}

await writeFile(join(OUT, 'api-schema-full.json'), JSON.stringify(api, null, 2))
const lines = ['# Довідник API Hoteliera (зведено з усіх прогонів)', '',
  `Ендпоінтів: **${Object.keys(api).length}**`, '']
for (const k of Object.keys(api).sort()) {
  lines.push(`## \`${k}\``, '', '```json', JSON.stringify(api[k].shape, null, 1).slice(0, 3000), '```', '')
}
await writeFile(join(OUT, 'api-schema-full.md'), lines.join('\n'))

const fl = ['# Каталог екранів і форм Hoteliera', '', `Екранів: **${forms.length}**`, '']
for (const f of forms.sort((a, b) => b.controls.length - a.controls.length)) {
  fl.push(`## ${f.screen}  — ${f.controls.length} полів`)
  if (f.sections.length) fl.push('', '**Секції:** ' + f.sections.slice(0, 20).join(' · '))
  if (f.tabs.length) fl.push('', '**Вкладки:** ' + f.tabs.join(' · '))
  for (const t of f.tables) fl.push('', '**Таблиця:** ' + t.columns.join(' | '))
  if (f.controls.length) { fl.push('', '| Поле | name | тип | варіанти |', '|---|---|---|---|')
    for (const c of f.controls) fl.push(`| ${(c.label||'—').replace(/\|/g,'/').slice(0,70)} | \`${c.name||''}\` | ${c.tag}${c.type?':'+c.type:''} | ${c.options?c.options.join(' · ').slice(0,80):''} |`) }
  if (f.buttons.length) fl.push('', '**Кнопки:** ' + f.buttons.join(' · '))
  fl.push('')
}
await writeFile(join(OUT, 'settings-catalogue.md'), fl.join('\n'))
console.log('ендпоінтів:', Object.keys(api).length, '| екранів:', forms.length)
