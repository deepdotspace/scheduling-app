/**
 * Availability tests — set weekly hours, buffer time
 */

import { test, expect } from '../../../test-utils/index.ts'
import { waitForAppReady } from './helpers'

test.describe('Availability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/availability')
    await waitForAppReady(page)
    await expect(page.locator('[data-testid="availability-page"]')).toBeVisible()
  })

  test('shows availability page with weekly schedule', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Weekly Hours' })).toBeVisible()
    await expect(page.locator('text=Your Timezone')).toBeVisible()
    await expect(page.locator('text=Minimum Notice')).toBeVisible()
  })

  test('shows day names', async ({ page }) => {
    await expect(page.locator('text=Monday')).toBeVisible()
    await expect(page.locator('text=Tuesday')).toBeVisible()
    await expect(page.locator('text=Wednesday')).toBeVisible()
    await expect(page.locator('text=Thursday')).toBeVisible()
    await expect(page.locator('text=Friday')).toBeVisible()
    await expect(page.locator('text=Saturday')).toBeVisible()
    await expect(page.locator('text=Sunday')).toBeVisible()
  })

  test('can reset to default hours', async ({ page }) => {
    await page.click('button:has-text("Reset to Default")')
    // Should show availability summary
    await expect(page.locator('text=Your Availability Summary')).toBeVisible()
  })

  test('can update minimum notice time', async ({ page }) => {
    // The first number input is the Minimum Notice (timeGap) field
    const input = page.locator('input[type="number"]').first()
    await input.fill('30')
    // Value should be updated
    await expect(input).toHaveValue('30')
  })
})
