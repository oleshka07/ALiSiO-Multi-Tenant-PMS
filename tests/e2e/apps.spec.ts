import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/**
 * Блок «Застосунки» — приймання §6 (docs/tasks/2026-09-09-block-apps.md).
 *
 * Власник → Налаштування → вкладка «Застосунки» → картка fiskaly зі станом і
 * полями ключів, картки DIRS21/PriceLabs/Unzer зі «скоро» і «хочу» →
 * «хочу» на DIRS21 → «ви позначили» → повторний натиск нічого не змінює →
 * картка Winhotel — live з 10.09.2026 (частина А `winhotel-import`): вимикач,
 * «Створити токен агента», значення показане один раз →
 * у «Здоровʼї» є пошта, fiskaly, менеджер каналів → відмова чужої системи з
 * ТЕКСТОМ на картці → платформна сесія на /app/platform/apps бачить той самий
 * рядок червоним і попит DIRS21 ≥ 1 → «Модулі» показують лише модулі.
 *
 * Відмова симулюється на ПОШТІ, не на fiskaly: клієнт fiskaly живе в
 * `modules/invoicing/data`, і дверей у фасаді для проби немає (звіт блоку,
 * «потрібна зміна в чужій теці»). Пошта — той самий механізм звіту стану
 * (`app_connections`, `reported()`), а відмова справжня: SMTP-сервер
 * `127.0.0.1`, на якому ніхто не слухає, — `ECONNREFUSED` з текстом.
 *
 * Облікові дані — з оточення; типові — ті, що CI заводить через
 * `provision-org.mjs`. Платформна частина пропускається, якщо платформного
 * акаунта не названо (у CI його немає — `platform-user.mjs` лише з оболонки).
 */
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'owner@ci.test';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'ci-password-1234';
const PLATFORM_EMAIL = process.env.E2E_PLATFORM_EMAIL || '';
const PLATFORM_PASSWORD = process.env.E2E_PLATFORM_PASSWORD || '';
const SHOTS = process.env.E2E_SCREENSHOT_DIR || '';
/**
 * Крок «Підключити TSE» — проти підставленого fiskaly (§6: без живого ключа).
 * Сценарій сам піднімає стаб на цьому порту; сервер застосунку мусить бути
 * запущений з `FISKALY_BASE_URL=http://127.0.0.1:<порт>/api/v2`. Порт не
 * заданий — крок пропускається з анотацією (у CI сервер стартує без нього).
 */
const FISKALY_STUB_PORT = Number(process.env.E2E_FISKALY_STUB_PORT || 0);

/** Стаб quickstart: ті самі тіла, що в `apps.check.ts`, — форма документації. */
function startFiskalyStub(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const p = (req.url ?? '').replace('/api/v2', '');
      const body = raw ? JSON.parse(raw) : {};
      const send = (code: number, obj: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (p === '/auth') return send(200, { access_token: 'stub' });
      if (req.method === 'PUT' && /^\/tss\/[0-9a-f-]+$/.test(p)) return send(200, { _id: p.split('/')[2], state: 'CREATED', admin_puk: 'PUK-E2E' });
      if (req.method === 'PATCH' && /^\/tss\/[0-9a-f-]+$/.test(p)) return send(200, { state: body.state });
      if (req.method === 'PATCH' && p.endsWith('/admin')) return send(200, {});
      if (req.method === 'POST' && p.endsWith('/admin/auth')) return send(200, { access_token: 'admin' });
      if (req.method === 'PUT' && /\/client\//.test(p)) return send(200, { serial_number: body.serial_number });
      if (req.method === 'GET' && /^\/tss\/[0-9a-f-]+$/.test(p)) return send(200, { state: 'INITIALIZED', serial_number: 'SER-E2E' });
      send(404, {});
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

async function loginOwner(page: Page): Promise<boolean> {
  const res = await page.request.post('/api/auth/login', { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  return res.ok();
}

/**
 * Виклики API — зсередини сторінки, не `page.request`: кука сесії у збірці
 * `production` — `Secure`, і Node-контекст запитів не шле її на `http://`, тоді
 * як браузер на localhost — шле. Вхід через `page.request` лише КЛАДЕ куку в
 * спільний слоїк.
 */
async function api(page: Page, method: 'POST' | 'PUT', url: string, body?: unknown): Promise<{ ok: boolean; status: number }> {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  }, { method, url, body });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe('Застосунки', () => {
  test('власник бачить вкладку, картки, «хочу» і відмову з текстом; постачальник — усіх', async ({ page }) => {
    // Один сценарій на весь блок: сім екранів і дві справжні відмови мережі.
    test.setTimeout(180_000);
    test.skip(!(await loginOwner(page)), `немає власника ${OWNER_EMAIL} — заведіть готель через provision-org.mjs`);

    // Вкладка в Налаштуваннях (З3).
    await page.goto('/app/settings');
    const tab = page.getByRole('link', { name: /Застосунки|Anwendungen|Aplikace|Apps/ }).first();
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/\/app\/settings\/apps/);
    await expect(page.getByTestId('apps-catalog')).toBeVisible();

    // Картка fiskaly: стан і — після вмикання — поля ключів.
    const fiskaly = page.getByTestId('app-card-fiskaly');
    await expect(fiskaly).toBeVisible();
    await expect(page.getByTestId('app-status-fiskaly')).toBeVisible();
    const fiskalyToggle = fiskaly.getByRole('button', { name: /fiskaly/ });
    if ((await page.getByTestId('app-key-fiskaly-clientId').count()) === 0) {
      await fiskalyToggle.click();
    }
    await expect(page.getByTestId('app-key-fiskaly-clientId')).toBeVisible();
    await expect(page.getByTestId('app-key-fiskaly-clientSecret')).toBeVisible();

    // «Скоро» — три картки з бейджем і кнопкою «хочу» (або «ви позначили»).
    for (const id of ['dirs21', 'pricelabs', 'unzer']) {
      await expect(page.getByTestId(`app-card-${id}`)).toBeVisible();
      await expect(page.getByTestId(`app-status-${id}`)).toHaveText(/скоро|bald|brzy|soon/);
      const wished = await page.getByTestId(`app-wished-${id}`).count();
      if (!wished) await expect(page.getByTestId(`app-wish-${id}`)).toBeVisible();
    }

    // «Хочу» на DIRS21 → «ви позначили»; повтор через API — нічого не змінює.
    if (await page.getByTestId('app-wish-dirs21').count()) {
      await page.getByTestId('app-wish-dirs21').click();
    }
    await expect(page.getByTestId('app-wished-dirs21')).toBeVisible();
    const again = await api(page, 'POST', '/api/settings/apps/dirs21/wish');
    expect(again.ok, `повторний «хочу» відповів ${again.status}`).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('app-wished-dirs21')).toBeVisible();
    await expect(page.getByTestId('app-wish-dirs21')).toHaveCount(0);

    // Winhotel — live: без «хочу», з вимикачем; увімкнений — картка знімків і
    // токен агента, який показується один раз (частина А, §2.4).
    const winhotel = page.getByTestId('app-card-winhotel_import');
    await expect(winhotel).toBeVisible();
    await expect(page.getByTestId('app-wish-winhotel_import')).toHaveCount(0);
    await expect(page.getByTestId('app-status-winhotel_import')).not.toHaveText(/скоро|bald|brzy|soon/);
    if ((await page.getByTestId('winhotel-card').count()) === 0) {
      await winhotel.getByRole('button', { name: /Winhotel/ }).click();
    }
    await expect(page.getByTestId('winhotel-card')).toBeVisible();
    await page.getByTestId('winhotel-token').click();
    const tokenBox = page.getByTestId('winhotel-token-value').locator('input');
    await expect(tokenBox).toBeVisible();
    expect(await tokenBox.inputValue()).toMatch(/^org_[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);

    // Здоровʼя: пошта, fiskaly, менеджер каналів.
    const health = page.getByTestId('apps-health');
    await expect(health).toBeVisible();
    await expect(health.getByTestId('health-smtp').first()).toBeVisible();
    await expect(health.getByTestId('health-fiskaly').first()).toBeVisible();
    await expect(health.getByTestId('health-channel_manager').first()).toBeVisible();

    // Відмова чужої системи з текстом (З7): SMTP на 127.0.0.1, де ніхто не слухає.
    const saved = await api(page, 'PUT', '/api/settings/integration-credentials', {
      channel: 'smtp', values: { clientId: '127.0.0.1', accessToken: 'probe@example.test', clientSecret: 'nobody-listens' },
    });
    expect(saved.ok, `збереження SMTP-ключів відповіло ${saved.status} (потрібен APP_SECRET_KEY на сервері)`).toBeTruthy();
    await page.reload();
    await page.getByTestId('app-probe-smtp').click();
    await expect(page.getByTestId('app-status-smtp')).toHaveText(/помилка|Fehler|chyba|error/, { timeout: 30_000 });
    await expect(page.getByTestId('app-error-smtp').first()).toContainText(/ECONNREFUSED|ETIMEDOUT|ECONN|refused/);
    // «Підключити TSE» (3.8) — проти стаба fiskaly; без порту — пропуск.
    if (FISKALY_STUB_PORT) {
      const stub = await startFiskalyStub(FISKALY_STUB_PORT);
      try {
        const keys = await api(page, 'PUT', '/api/settings/integration-credentials', {
          channel: 'fiskaly', values: { clientId: 'test-api-key', clientSecret: 'test-api-secret' },
        });
        expect(keys.ok, `збереження ключів fiskaly відповіло ${keys.status}`).toBeTruthy();
        await page.reload();
        const select = page.getByTestId('tse-property-select');
        await expect(select).toBeVisible();
        const free = await select.locator('option:not([value=""])').first().getAttribute('value');
        if (free) {
          await select.selectOption(free);
          await page.getByTestId('tse-connect').click();
          await expect(page.getByTestId('tse-result')).toContainText(/TSS …[0-9a-f]{4}/, { timeout: 30_000 });
          await expect(page.getByTestId(`tse-property-${free}`)).toContainText(/TSS …[0-9a-f]{4}/);
          await expect(page.getByTestId('app-status-fiskaly')).toHaveText(/підключено|verbunden|připojeno|connected/);
        } else {
          test.info().annotations.push({ type: 'skipped-part', description: 'TSE вже підключено на всіх обʼєктах цього готелю' });
        }
      } finally {
        await new Promise<void>((r) => stub.close(() => r()));
      }
    } else {
      test.info().annotations.push({ type: 'skipped-part', description: 'крок «Підключити TSE» пропущено: E2E_FISKALY_STUB_PORT не задано' });
    }
    await shot(page, 'settings-apps');

    // «Модулі» — лише модулі, без полів fiskaly.
    await page.goto('/app/settings/features', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('modules-list')).toBeVisible();
    await expect(page.getByTestId('module-tasks')).toBeVisible();
    await expect(page.getByTestId('module-fiscal_de')).toHaveCount(0);
    await expect(page.getByTestId('module-online_payments')).toHaveCount(0);
    await expect(page.locator('[data-testid^="app-key-"]')).toHaveCount(0);

    // Постачальник: той самий рядок червоний, попит Winhotel ≥ 1.
    if (!PLATFORM_EMAIL) {
      test.info().annotations.push({ type: 'skipped-part', description: 'платформну частину пропущено: E2E_PLATFORM_EMAIL не задано' });
      return;
    }
    const platform = await page.request.post('/api/platform/login', { data: { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD } });
    expect(platform.ok(), 'вхід платформи').toBeTruthy();
    await page.goto('/app/platform/apps', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('platform-apps-health')).toBeVisible();
    await expect(page.locator('[data-testid$="-smtp"][data-status="error"]').first()).toBeVisible();
    await expect(page.locator('[data-testid$="-smtp"][data-status="error"]').first()).toContainText(/ECONN|refused|ETIMEDOUT/);
    const demand = await page.getByTestId('platform-wish-count-dirs21').textContent();
    expect(Number(demand)).toBeGreaterThanOrEqual(1);
    await shot(page, 'platform-apps');
  });
});
