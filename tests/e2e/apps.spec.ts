import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Блок «Застосунки» — приймання §6 (docs/tasks/2026-09-09-block-apps.md).
 *
 * Власник → Налаштування → вкладка «Застосунки» → картка fiskaly зі станом і
 * полями ключів, картки Winhotel/DIRS21/PriceLabs/Unzer зі «скоро» і «хочу» →
 * «хочу» на Winhotel → «ви позначили» → повторний натиск нічого не змінює →
 * у «Здоровʼї» є пошта, fiskaly, менеджер каналів → відмова чужої системи з
 * ТЕКСТОМ на картці → платформна сесія на /app/platform/apps бачить той самий
 * рядок червоним і попит Winhotel ≥ 1 → «Модулі» показують лише модулі.
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

    // «Скоро» — чотири картки з бейджем і кнопкою «хочу» (або «ви позначили»).
    for (const id of ['winhotel_import', 'dirs21', 'pricelabs', 'unzer']) {
      await expect(page.getByTestId(`app-card-${id}`)).toBeVisible();
      await expect(page.getByTestId(`app-status-${id}`)).toHaveText(/скоро|bald|brzy|soon/);
      const wished = await page.getByTestId(`app-wished-${id}`).count();
      if (!wished) await expect(page.getByTestId(`app-wish-${id}`)).toBeVisible();
    }

    // «Хочу» на Winhotel → «ви позначили»; повтор через API — нічого не змінює.
    if (await page.getByTestId('app-wish-winhotel_import').count()) {
      await page.getByTestId('app-wish-winhotel_import').click();
    }
    await expect(page.getByTestId('app-wished-winhotel_import')).toBeVisible();
    const again = await api(page, 'POST', '/api/settings/apps/winhotel_import/wish');
    expect(again.ok, `повторний «хочу» відповів ${again.status}`).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('app-wished-winhotel_import')).toBeVisible();
    await expect(page.getByTestId('app-wish-winhotel_import')).toHaveCount(0);

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
    const demand = await page.getByTestId('platform-wish-count-winhotel_import').textContent();
    expect(Number(demand)).toBeGreaterThanOrEqual(1);
    await shot(page, 'platform-apps');
  });
});
