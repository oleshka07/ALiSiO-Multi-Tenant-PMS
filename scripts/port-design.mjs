/**
 * Converts the Alisio PMS design export (a single-file dc.html) into TSX that
 * the Next.js app can render as real routes.
 *
 * The design is machine-generated and well-formed, so a small tokenizer is
 * enough — and it is far more predictable than a pile of regexes over 1400
 * lines of nested markup.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] ?? 'design/alisio-pms.dc.html';
const OUT = process.argv[3] ?? 'src/app/(marketing)/_design';

// ─── route map: design page id → real URL ────────────────────────────────────
const ROUTES = {
  home: '/',
  product: '/product',
  agents: '/agents',
  'm-calendar': '/modules/calendar',
  'm-channels': '/modules/channels',
  'm-finance': '/modules/finance',
  'm-guest': '/modules/guest-portal',
  'm-crm': '/modules/crm',
  'm-compliance': '/modules/compliance',
  'm-ops': '/modules/housekeeping',
  solutions: '/solutions',
  integrations: '/integrations',
  cases: '/cases',
  blog: '/blog',
  'post-goppar': '/blog/goppar-uplift',
  'post-autonomy': '/blog/autonomy-levels',
  about: '/about',
  demo: '/demo',
};

// file name for each generated section component
const FILES = {
  home: 'home',
  product: 'product',
  agents: 'agents',
  'm-calendar': 'module-calendar',
  'm-channels': 'module-channels',
  'm-finance': 'module-finance',
  'm-guest': 'module-guest-portal',
  'm-crm': 'module-crm',
  'm-compliance': 'module-compliance',
  'm-ops': 'module-housekeeping',
  solutions: 'solutions',
  integrations: 'integrations',
  cases: 'cases',
  blog: 'blog',
  'post-goppar': 'post-goppar-uplift',
  'post-autonomy': 'post-autonomy-levels',
  about: 'about',
  demo: 'demo',
};

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// attributes React types as numbers — a string here fails the typecheck
const NUMERIC_ATTRS = new Set(['rows', 'cols', 'size', 'span', 'start', 'maxLength', 'tabIndex']);

const ATTR_MAP = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  maxlength: 'maxLength',
  autocomplete: 'autoComplete',
  readonly: 'readOnly',
  contenteditable: 'contentEditable',
  srcset: 'srcSet',
  usemap: 'useMap',
  novalidate: 'noValidate',
  enctype: 'encType',
  accesskey: 'accessKey',
  crossorigin: 'crossOrigin',
};

// ─── tokenizer ───────────────────────────────────────────────────────────────
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;

  const push = (node) => stack[stack.length - 1].children.push(node);

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      addText(push, html.slice(i));
      break;
    }
    if (lt > i) addText(push, html.slice(i, lt));

    // comment
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    // closing tag
    if (html[lt + 1] === '/') {
      const gt = html.indexOf('>', lt);
      const name = html
        .slice(lt + 2, gt)
        .trim()
        .toLowerCase();
      // unwind to the matching open tag; ignores strays instead of dying
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    // opening tag
    const gt = findTagEnd(html, lt);
    const raw = html.slice(lt + 1, gt);
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([a-zA-Z0-9:-]+)/.exec(body);
    if (!m) {
      i = gt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    const node = { tag, attrs: parseAttrs(body.slice(m[1].length)), children: [] };
    push(node);
    if (!selfClosing && !VOID.has(tag)) stack.push(node);
    i = gt + 1;
  }
  return root;
}

/** Finds the '>' that closes a tag, skipping any inside quoted attribute values. */
function findTagEnd(html, start) {
  let quote = null;
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return html.length;
}

function addText(push, text) {
  if (!text.trim()) {
    // collapse pure whitespace, but keep a single space so inline runs
    // ("word <b>word</b>") do not glue together
    if (text.includes('\n') || text === '') return;
    push({ tag: '#text', text: ' ' });
    return;
  }
  push({ tag: '#text', text });
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([a-zA-Z0-9:_.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const m of str.matchAll(re)) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4];
    // the design emits duplicate `style` attributes on a couple of elements;
    // the browser keeps the first, so we do too
    if (name in attrs) continue;
    attrs[name] = value === undefined ? true : value;
  }
  return attrs;
}

// ─── style handling ──────────────────────────────────────────────────────────
/** Splits "a:b;c:d(e;f)" on top-level semicolons only. */
function splitDecls(css) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const c of css) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ';' && depth === 0) {
      out.push(buf);
      buf = '';
    } else buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

function cssPropToJs(prop) {
  if (prop.startsWith('--')) return prop; // custom properties keep their name
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function styleToObject(css) {
  const pairs = [];
  for (const decl of splitDecls(css)) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop) continue;
    const key = cssPropToJs(prop);
    const quotedKey = /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) ? key : `'${key}'`;
    pairs.push(`${quotedKey}: ${JSON.stringify(value)}`);
  }
  return pairs.length ? `{{ ${pairs.join(', ')} }}` : null;
}

// ─── hover styles → generated CSS classes ────────────────────────────────────
const hoverClasses = new Map(); // css text -> class name

function hoverClass(css) {
  if (hoverClasses.has(css)) return hoverClasses.get(css);
  const name = `dcx-h${hoverClasses.size + 1}`;
  hoverClasses.set(css, name);
  return name;
}

function hoverCss() {
  const rules = [];
  for (const [css, name] of hoverClasses) {
    // inline styles beat stylesheet rules, so the hover state has to shout
    const decls = splitDecls(css)
      .map((d) => `${d.trim()} !important`)
      .join('; ');
    rules.push(
      `.${name}{transition:border-color .25s ease,transform .25s ease,background .25s ease,color .25s ease,filter .25s ease}\n.${name}:hover{${decls}}`,
    );
  }
  return rules.join('\n');
}

// ─── serializer ──────────────────────────────────────────────────────────────
function jsxAttrName(name) {
  if (ATTR_MAP[name]) return ATTR_MAP[name];
  if (name.startsWith('data-') || name.startsWith('aria-')) return name;
  if (name.includes(':')) return null; // xlink:href and friends — dropped
  if (name.includes('-')) return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return name;
}

function escapeText(text) {
  // JSX treats braces as expression delimiters; the design has a JSON sample
  return text.replace(/[{}]/g, (c) => `{'${c}'}`);
}

function serialize(node, indent, usedLink) {
  const pad = '  '.repeat(indent);

  if (node.tag === '#text') {
    const t = escapeText(node.text);
    return t.trim() ? `${pad}${t.trim()}` : null;
  }

  const attrs = { ...node.attrs };
  let tag = node.tag;

  // <a data-route="x"> becomes a real client-side <Link>
  const route = attrs['data-route'];
  if (tag === 'a' && route && ROUTES[route]) {
    tag = 'Link';
    attrs.href = ROUTES[route];
    usedLink.value = true;
  }

  // style-hover is a design-tool invention — turn it into a real CSS class
  if (attrs['style-hover']) {
    attrs.className = hoverClass(attrs['style-hover']);
    attrs['style-hover'] = undefined;
  }

  // A <button> with no type submits, which is never what this markup wants.
  if (tag === 'button' && !attrs.type) attrs.type = 'button';

  // The design writes plain HTML form defaults. Handing those to React as
  // `value`/`checked` makes a controlled field with no onChange — React then
  // pins it read-only, which is how the autonomy dial stopped moving.
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    if (attrs.value !== undefined) {
      attrs.defaultValue = attrs.value;
      attrs.value = undefined;
    }
    if (attrs.checked !== undefined) {
      attrs.defaultChecked = attrs.checked;
      attrs.checked = undefined;
    }
  }

  // Every icon in the design is decorative and sits next to its own label.
  if (tag === 'svg' && !node.children.some((c) => c.tag === 'title')) {
    attrs['aria-hidden'] = 'true';
    attrs.focusable = 'false';
  }

  const parts = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue; // rewritten above, e.g. value → defaultValue
    if (name === 'style') {
      const obj = styleToObject(String(value));
      if (obj) parts.push(`style=${obj}`);
      continue;
    }
    const jsxName = jsxAttrName(name);
    if (!jsxName) continue;
    if (value === true) {
      parts.push(`${jsxName}={true}`);
      continue;
    }
    if (NUMERIC_ATTRS.has(jsxName) && /^\d+$/.test(String(value))) {
      parts.push(`${jsxName}={${Number(value)}}`);
      continue;
    }
    parts.push(`${jsxName}=${JSON.stringify(String(value))}`);
  }

  const attrStr = parts.length ? ` ${parts.join(' ')}` : '';

  if (VOID.has(node.tag) || (!node.children.length && node.tag !== 'textarea')) {
    return `${pad}<${tag}${attrStr} />`;
  }

  const children = node.children.map((c) => serialize(c, indent + 1, usedLink)).filter(Boolean);

  if (!children.length) return `${pad}<${tag}${attrStr} />`;

  // keep short text-only elements on one line — the output stays readable
  if (children.length === 1 && node.children[0].tag === '#text' && children[0].length < 90) {
    return `${pad}<${tag}${attrStr}>${children[0].trim()}</${tag}>`;
  }

  return `${pad}<${tag}${attrStr}>\n${children.join('\n')}\n${pad}</${tag}>`;
}

function serializeChildren(node, indent) {
  const usedLink = { value: false };
  const body = node.children
    .map((c) => serialize(c, indent, usedLink))
    .filter(Boolean)
    .join('\n');
  return { body, usedLink: usedLink.value };
}

// ─── find nodes ──────────────────────────────────────────────────────────────
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

function findAll(node, predicate, acc = []) {
  if (predicate(node)) acc.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, acc);
  return acc;
}

// ─── run ─────────────────────────────────────────────────────────────────────
const html = fs.readFileSync(SRC, 'utf8');
const start = html.indexOf('</helmet>') + '</helmet>'.length;
const end = html.indexOf('</x-dc>');
const template = html.slice(start, end);

const tree = parse(template);

const sections = findAll(tree, (n) => n.tag === 'section' && n.attrs?.['data-page']);
const header = find(tree, (n) => n.tag === 'header');
const footer = find(tree, (n) => n.tag === 'footer');

fs.mkdirSync(path.join(OUT, 'sections'), { recursive: true });

const banner = `/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
`;

const manifest = [];

for (const section of sections) {
  const id = section.attrs['data-page'];
  const file = FILES[id];
  if (!file) {
    console.warn(`! no file mapping for page "${id}"`);
    continue;
  }
  const { body, usedLink } = serializeChildren(section, 3);
  const component = `Section${file
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('')}`;

  const code = `${banner}${usedLink ? "import Link from 'next/link';\n\n" : '\n'}export default function ${component}() {
  return (
    <>
${body}
    </>
  );
}
`;
  fs.writeFileSync(path.join(OUT, 'sections', `${file}.tsx`), code);
  manifest.push({ id, file, component, route: ROUTES[id] });
}

/**
 * The design has no way into the product — it only offers "Book a demo".
 * A live deployment needs one, because `/` no longer redirects to the
 * dashboard, so the header gets a log-in link ahead of the demo button.
 */
const LOGIN_LINK = `<Link href="/app/login" style={{ color: "#B6BCC3", fontSize: "14px", padding: "9px 13px", borderRadius: "9px" }} className="dcx-login">Log in</Link>`;

function withLoginLink(body) {
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => l.includes('data-nav-cta'));
  if (idx === -1) {
    console.warn('! could not place the log-in link: data-nav-cta not found');
    return body;
  }
  const indent = lines[idx].match(/^\s*/)[0];
  lines.splice(idx, 0, indent + LOGIN_LINK);
  return lines.join('\n');
}

// header / footer markup
for (const [name, node] of [
  ['header', header],
  ['footer', footer],
]) {
  let { body, usedLink } = serializeChildren(node, 2);
  if (name === 'header') {
    body = withLoginLink(body);
    usedLink = true;
  }
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => {
      if (k === 'style') return `style=${styleToObject(String(v))}`;
      return `${jsxAttrName(k)}=${JSON.stringify(String(v))}`;
    })
    .join(' ');
  const component = name === 'header' ? 'SiteHeaderMarkup' : 'SiteFooterMarkup';
  const code = `${banner}${usedLink ? "import Link from 'next/link';\n\n" : '\n'}export default function ${component}() {
  return (
    <${node.tag} ${attrs}>
${body}
    </${node.tag}>
  );
}
`;
  fs.writeFileSync(path.join(OUT, `${name}-markup.tsx`), code);
}

fs.writeFileSync(
  path.join(OUT, 'hover.css'),
  `/* Generated from style-hover attributes in the design export. */\n${hoverCss()}\n`,
);
fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ pages: manifest, hoverClasses: hoverClasses.size }, null, 2),
);

console.log(`sections: ${manifest.length}, hover classes: ${hoverClasses.size}`);
for (const p of manifest) console.log(`  ${p.id.padEnd(14)} → ${p.route.padEnd(24)} ${p.file}.tsx`);
