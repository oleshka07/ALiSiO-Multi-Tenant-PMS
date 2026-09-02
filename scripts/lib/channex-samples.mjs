/**
 * Зразки живих відповідей вендора — для інваріанта 28.
 *
 *   const { recordVendorResponses } = await import('@channels');
 *   recordVendorResponses(sampleRecorder());
 *
 * Кожна відповідь (успішна чи ні) лягає файлом у `docs/vendor/channex/live/`:
 * `<METHOD>__<шаблон шляху>__<HTTP-код>.json`. Ідентифікатори в шляху
 * замінені на `:id`, рядок запиту відкинутий. Значення під ключами секретів
 * і персональних даних вирізані (`<redacted>`), СТРУКТУРА збережена — гейт
 * `check-live-fields` перевіряє наявність полів, а не їхні значення.
 *
 * Зразок перезаписується щоразу: правда — це остання жива відповідь, а не
 * перша. Історія — у git.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SAMPLES_DIR = 'docs/vendor/channex/live';

const SECRET_KEY = /token|secret|api.?key|password|authorization|signature/i;
const PII_KEY = /^(customer|guest|guests|mail|email|phone|first_name|last_name|surname|full_name|address|zip|card|payment_collect|meta_customer)$/i;

function redact(value, keyName = '') {
  if (Array.isArray(value)) return value.map((v) => redact(v, keyName));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) out[k] = typeof v === 'object' && v !== null ? redact(v, k) : '<redacted>';
      else if (PII_KEY.test(k)) out[k] = redact(v, k);
      else out[k] = redact(v, PII_KEY.test(keyName) ? keyName : '');
    }
    return out;
  }
  if (PII_KEY.test(keyName) && (typeof value === 'string' || typeof value === 'number')) return '<redacted>';
  return value;
}

const ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,}/gi;
const KEY_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2})$/i;
const KEEP_KEYS = 3;

/**
 * Зразок — це форма, не дані: мапа, індексована ідентифікаторами або
 * датами (календар `GET /restrictions` — опції × дні), обрізається до
 * перших трьох ключів із позначкою, скільки прибрано. Інакше один прохід на
 * два місяці кладе в документацію 130 КБ однакових клітинок.
 */
function trim(value) {
  if (Array.isArray(value)) return value.map(trim);
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  const indexed = keys.length > KEEP_KEYS && keys.every((k) => KEY_ID_RE.test(k));
  const out = {};
  for (const k of indexed ? keys.slice(0, KEEP_KEYS) : keys) out[k] = trim(value[k]);
  if (indexed) out['…'] = `${keys.length - KEEP_KEYS} more keys trimmed (sample keeps the shape, not the data)`;
  return out;
}

/** `/webhooks/5d39…?x=1` → `/webhooks/:id`. */
export function pathTemplate(p) {
  return p.split('?')[0].replace(ID_RE, ':id');
}

export function sampleFileName(method, template, status) {
  const slug = template.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return `${method}__${slug}__${status}.json`;
}

/** Записувач для `recordVendorResponses()`. Повертає й перелік того, що записав. */
export function sampleRecorder({ dir = SAMPLES_DIR, log = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const written = new Set();
  const sink = ({ method, path: p, status, payload }) => {
    const template = pathTemplate(p);
    const file = path.join(dir, sampleFileName(method, template, status));
    const sample = {
      endpoint: `${method} ${template}`,
      status,
      captured_at: new Date().toISOString().slice(0, 10),
      payload: trim(redact(payload)),
    };
    fs.writeFileSync(file, JSON.stringify(sample, null, 2) + '\n');
    written.add(file);
    log(file);
  };
  sink.written = written;
  return sink;
}
