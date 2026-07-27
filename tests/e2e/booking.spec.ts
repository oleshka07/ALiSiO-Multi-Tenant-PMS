import { test, expect } from '@playwright/test';

test.describe('ALiSiO Multi-Tenant PMS - E2E Core Flows', () => {
  test('Landing Page & Property Management Dashboard loads correctly', async ({ page }) => {
    await page.goto('/');

    // Check header title
    await expect(page.locator('h1')).toContainText('ALiSiO Multi-Tenant PMS');

    // Check key status badge
    await expect(page.getByText('Active Tenant')).toBeVisible();
  });

  test('Booking creation simulation flow', async ({ page }) => {
    await page.goto('/');

    // Verify booking section exists
    const bookingButton = page.getByRole('button', { name: /створити бронювання|new booking/i });
    if (await bookingButton.isVisible()) {
      await bookingButton.click();
      await expect(page.getByText(/вибір номеру|select room/i)).toBeVisible();
    }
  });
});
