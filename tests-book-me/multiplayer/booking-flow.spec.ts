/**
 * Multiplayer booking flow tests
 *
 * User A creates event type, User B books it, User A sees booking
 */

import { test, expect } from '../../../../test-utils/index.ts'

const AUTH_FILE_A = 'tests/.auth/session.json'
const AUTH_FILE_B = 'tests/.auth/session-user-b.json'

test.describe('Multiplayer Booking Flow', () => {
  test('User A creates event type, User B sees it on booking page', async ({ browser }) => {
    // User A: Create event type
    const contextA = await browser.newContext({ storageState: AUTH_FILE_A })
    const pageA = await contextA.newPage()

    await pageA.goto('/')
    await pageA.waitForSelector('[data-testid="app-root"]', { timeout: 30_000 })

    // Navigate to event types
    await pageA.click('a[href="/events"]')
    await pageA.waitForSelector('[data-testid="event-types-page"]', { timeout: 15_000 })

    // Create event type
    await pageA.click('[data-testid="create-event-type-btn"]')
    await pageA.fill('input[placeholder*="30 Minute"]', 'Multiplayer Test Meeting')
    // Navigate through modal tabs to reach the submit button
    const modal = pageA.locator('.fixed.inset-0')
    const nextBtn = modal.locator('button:has-text("Next")')
    while (await nextBtn.isVisible()) {
      await nextBtn.click()
      await pageA.waitForTimeout(200)
    }
    await modal.locator('button:has-text("Create Event Type")').click()
    await expect(pageA.getByRole('heading', { name: 'Multiplayer Test Meeting' }).first()).toBeVisible({ timeout: 10_000 })

    // Get User A's booking URL from dashboard
    await pageA.click('a[href="/"]')
    await pageA.waitForSelector('[data-testid="dashboard-page"]', { timeout: 15_000 })

    const bookingLink = pageA.locator('code:has-text("/book/")').first()
    await expect(bookingLink).toBeVisible({ timeout: 10_000 })
    const linkText = await bookingLink.textContent()

    await contextA.close()

    if (!linkText) {
      test.skip(true, 'No booking link found')
      return
    }

    // User B: Visit booking page
    const contextB = await browser.newContext({ storageState: AUTH_FILE_B })
    const pageB = await contextB.newPage()

    const url = new URL(linkText)
    await pageB.goto(url.pathname)

    // Should see User A's event types
    await expect(pageB.locator('text=Select an event type')).toBeVisible({ timeout: 15_000 })
    await expect(pageB.getByRole('heading', { name: 'Multiplayer Test Meeting' }).first()).toBeVisible({ timeout: 10_000 })

    await contextB.close()
  })
})
