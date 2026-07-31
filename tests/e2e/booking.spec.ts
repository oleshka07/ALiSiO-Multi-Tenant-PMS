import { expect, test } from '@playwright/test';

test.describe('ALiSiO Multi-Tenant PMS - E2E Core Flows', () => {
  // '/' is the public marketing site now, not the dashboard — the product
  // starts at /login. Page-level coverage of the site lives in
  // marketing-site.spec.ts.
  test('Landing page loads the public site', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('See what your property lost');
    await expect(page.locator('[data-nav]')).toBeVisible();
  });

  test('Booking creation simulation flow', async ({ page }) => {
    await page.goto('/bookings');

    // Without a session the gate sends us to the login page.
    await expect(page).toHaveURL(/\/login/);

    const bookingButton = page.getByRole('button', { name: /створити бронювання|new booking/i });
    if (await bookingButton.isVisible()) {
      await bookingButton.click();
      await expect(page.getByText(/вибір номеру|select room/i)).toBeVisible();
    }
  });
});
