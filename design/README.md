# Design source for the public site

`alisio-pms.dc.html` is the design export for the Alisio PMS marketing site: one
file holding eighteen pages as `<section data-page="…">`, styled entirely with
inline styles, plus a script that wires up the interactions through `data-*`
markers.

**It is the source of truth for the markup.** `src/app/(marketing)/_design/` is
generated from it and must not be hand-edited.

## Regenerating

```bash
node scripts/port-design.mjs                 # design/ → src/app/(marketing)/_design/
node scripts/port-design.mjs <src> <outdir>  # or point it somewhere else
```

The codemod parses the export and emits:

| Output | What it is |
|---|---|
| `_design/sections/*.tsx` | one server component per page |
| `_design/header-markup.tsx`, `footer-markup.tsx` | the shared chrome |
| `_design/hover.css` | the `style-hover` attributes turned into real CSS |
| `_design/manifest.json` | page id → route → file, for reference |

Along the way it converts inline styles to React style objects, camel-cases SVG
attributes, self-closes void elements, escapes the braces in the JSON sample on
the integrations page, and rewrites `<a data-route="x">` into `next/link`.

Three deliberate deviations from the export, all in `scripts/port-design.mjs`:

- **`value` becomes `defaultValue`** on form fields. The design writes plain
  HTML defaults; handed to React as `value` with no `onChange` they become
  controlled and read-only, which is what froze the autonomy dial.
- **`<button>` gets `type="button"`** so it cannot submit anything.
- **A log-in link is inserted** before the demo CTA. The design offers no way
  into the product, and `/` is no longer a redirect to the dashboard.

## Routes

Page ids map to real routes rather than the export's `#/hash` router:

| Design page | Route |
|---|---|
| `home` | `/` |
| `product` | `/product` |
| `agents` | `/agents` |
| `m-calendar` … `m-ops` | `/modules/calendar` … `/modules/housekeeping` |
| `solutions`, `integrations`, `cases`, `about`, `demo` | same name |
| `blog` | `/blog` |
| `post-goppar`, `post-autonomy` | `/blog/goppar-uplift`, `/blog/autonomy-levels` |

Adding a page to the design means adding it to `ROUTES` and `FILES` in the
codemod, then creating the matching `page.tsx`, and — because the auth gate is
deny-by-default — listing it in `MARKETING_PAGES` or `PUBLIC_PREFIXES` in
`src/proxy.ts`.

## Behaviour

The interactions live in `src/app/(marketing)/_components/design-runtime.tsx`,
a port of the export's script. It stays DOM-driven on purpose: the `data-*`
markers are the contract with the generated markup, so renaming one breaks the
behaviour silently. `tests/e2e/marketing-site.spec.ts` is what catches that.

Not ported: the hash router (real routes now) and the accent-colour prop (the
`--acc` CSS variable in `marketing.css`).

`aura-os-concept.md` is the product concept the site's copy is written from.
