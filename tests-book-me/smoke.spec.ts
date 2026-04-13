/**
 * Smoke tests — app loads, health endpoints, page reload survival
 */

import { test, expect } from '../../../test-utils/index.ts'
import { waitForAppReady } from './helpers'

test.describe('Smoke tests', () => {
  test('app loads and shows dashboard', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  test('survives page reload', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible()

    await page.reload()
    await waitForAppReady(page)
    await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible()
  })

  test('navigation works between all pages', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)

    // Navigate to Event Types
    await page.click('a[href="/events"]')
    await expect(page.locator('[data-testid="event-types-page"]')).toBeVisible()

    // Navigate to Availability
    await page.click('a[href="/availability"]')
    await expect(page.locator('[data-testid="availability-page"]')).toBeVisible()

    // Navigate to Meetings
    await page.click('a[href="/meetings"]')
    await expect(page.locator('[data-testid="meetings-page"]')).toBeVisible()

    // Navigate back to Dashboard
    await page.click('a[href="/"]')
    await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible()
  })
})
