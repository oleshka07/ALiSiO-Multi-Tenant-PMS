import { expect, test } from '@playwright/test';

/**
 * The public site is a port of a design that drives its interactions through
 * `data-*` markers rather than React state (see src/app/(marketing)). Those
 * markers are the contract between the generated markup and the runtime, so
 * these tests assert on behaviour the runtime is responsible for — everything
 * that would silently die if a marker were renamed or the runtime failed to
 * re-run after a client-side navigation.
 */

const PAGES = [
  '/',
  '/product',
  '/agents',
  '/modules/calendar',
  '/modules/channels',
  '/modules/finance',
  '/modules/guest-portal',
  '/modules/crm',
  '/modules/compliance',
  '/modules/housekeeping',
  '/solutions',
  '/integrations',
  '/cases',
  '/blog',
  '/blog/goppar-uplift',
  '/blog/autonomy-levels',
  '/about',
  '/demo',
];

test.describe('public marketing site', () => {
  for (const path of PAGES) {
    test(`${path} is public and renders its content`, async ({ page }) => {
      // The webfonts come from Google, so 'load' is not worth waiting on.
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${path} should not redirect to login`).toBe(200);
      expect(new URL(page.url()).pathname, `${path} should stay put`).toBe(path);

      // Reveal animations start at opacity 0 and are switched on by the
      // runtime once it hydrates. Content below the fold is meant to wait for
      // a scroll, but anything already on screen must end up visible or the
      // visitor lands on a blank page.
      await expect
        .poll(
          () =>
            page.$$eval(
              '[data-reveal]',
              (els) =>
                els.filter((el) => {
                  const rect = el.getBoundingClientRect();
                  const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
                  return onScreen && getComputedStyle(el).opacity === '0';
                }).length,
            ),
          { message: `${path} left sections blank`, timeout: 8000 },
        )
        .toBe(0);
    });
  }

  test('the dashboard is still behind the login gate', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('header navigates, and the dropdown opens', async ({ page }) => {
    await page.goto('/');
    await page.hover('[data-drop="product"]');
    await expect(page.locator('[data-drop-panel="product"]')).toBeVisible();

    await page.click('[data-drop-panel="product"] a[href="/modules/finance"]');
    await expect(page).toHaveURL(/\/modules\/finance$/);
  });

  test('the decision ledger keeps playing five rows', async ({ page }) => {
    await page.goto('/');
    const top = page.locator('[data-ledger] > div').first();
    const before = await top.textContent();
    await expect(async () => {
      expect(await top.textContent()).not.toBe(before);
    }).toPass({ timeout: 8000 });
    await expect(page.locator('[data-ledger] > div')).toHaveCount(5);
  });

  test('counters run when scrolled into view', async ({ page }) => {
    await page.goto('/');
    const counter = page.locator('[data-count-to]').first();
    await counter.scrollIntoViewIfNeeded();
    const target = await counter.getAttribute('data-count-to');
    await expect(counter).toHaveText(String(target), { timeout: 5000 });
  });

  test('the autonomy dial is not frozen by React', async ({ page }) => {
    // The design ships `value="3"` on the range input. Passed to React as
    // `value` it becomes a controlled field with no onChange, and the slider
    // stops moving — it has to be `defaultValue`.
    await page.goto('/');
    await page.locator('[data-dial]').fill('5');
    await page.dispatchEvent('[data-dial]', 'input');
    await expect(page.locator('[data-dial-level]')).toHaveText('L5');
    await expect(page.locator('[data-dial-name]')).toHaveText('Owns the KPI');
  });

  test('booking tape reveals the reservation behind a cell', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-cell]').first().click();
    await expect(page.locator('[data-booking-detail]')).not.toHaveText('');
  });

  test('the chosen language survives a navigation', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-lang-btn]');
    await page.click('[data-lang-opt="uk"]');
    await expect(page.locator('h1[data-i18n="hero_h1"]')).toContainText('Подивіться');

    // The header is rendered by the layout and never remounts, so a naive
    // implementation both loses the choice and captures translated copy as
    // the "original" English.
    await page.hover('[data-drop="product"]');
    await page.click('[data-drop-panel="product"] a[href="/product"]');
    await expect(page).toHaveURL(/\/product$/);
    await expect(page.locator('[data-lang-current]')).toHaveText('UK');
    await expect(page.locator('[data-nav] nav a[href="/agents"]')).toHaveText('AI-екіпаж');
  });

  test('FAQ accordions open on the demo page', async ({ page }) => {
    await page.goto('/demo');
    const body = page.locator('[data-acc]').first().locator('[data-acc-body]');
    await expect(body).toBeHidden();
    await page.locator('[data-acc-head]').first().click();
    await expect(body).toBeVisible();
  });

  test('the phone layout swaps the nav for a burger menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-burger]')).toBeVisible();
    await expect(page.locator('[data-nav] nav')).toBeHidden();
    await page.click('[data-burger]');
    await expect(page.locator('[data-mobile-menu]')).toBeVisible();
  });
});
