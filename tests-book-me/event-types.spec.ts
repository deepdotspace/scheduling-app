/**
 * Event Types tests — create, edit, toggle, delete event types
 */

import { test, expect } from '../../../test-utils/index.ts'
import { waitForAppReady } from './helpers'

/** Navigate through panel tabs (Basics → Settings → Notifications) and click the final button */
async function submitPanel(page: import('@playwright/test').Page, buttonText: string) {
  const nextBtn = page.locator('button:has-text("Next")')
  while (await nextBtn.isVisible()) {
    await nextBtn.click()
    await page.waitForTimeout(200)
  }
  await page.locator(`button:has-text("${buttonText}")`).click()
}

/** Find event type card by title text */
function findCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid^="event-type-card-"]').filter({ hasText: title })
}

/** Create an event type via the New Event Type modal (two-block layout with tabs) and wait for it to appear */
async function createViaForm(page: import('@playwright/test').Page, title: string, description?: string) {
  await page.click('[data-testid="create-event-type-btn"]')
  await page.waitForSelector('input[placeholder*="Enter event title"]', { timeout: 5_000 })
  await page.fill('input[placeholder*="Enter event title"]', title)
  if (description) {
    await page.fill('textarea[placeholder*="What is this meeting"]', description)
  }
  // Navigate through tabs (Basics → Settings → Notifications) to reach Create Event Type button
  const nextBtn = page.locator('button:has-text("Next")')
  while (await nextBtn.isVisible()) {
    await nextBtn.click()
    await page.waitForTimeout(200)
  }
  await page.click('[data-testid="create-event-type-submit-btn"]')
  await expect(findCard(page, title)).toBeVisible({ timeout: 10_000 })
}

// Use unique suffixes to avoid conflicts with leftover data from previous runs
const suffix = Date.now().toString(36).slice(-4)

test.describe('Event Types', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events')
    await waitForAppReady(page)
    await expect(page.locator('[data-testid="event-types-page"]')).toBeVisible()
  })

  test('can create a new event type', async ({ page }) => {
    const title = `Quick Chat ${suffix}`
    await createViaForm(page, title, 'A quick 15 minute chat')
    await expect(findCard(page, title)).toBeVisible()
  })

  test('can edit an event type', async ({ page }) => {
    const title = `Edit Me ${suffix}`
    await createViaForm(page, title)

    // Click the card — opens Edit panel
    await findCard(page, title).click()
    await page.waitForSelector('input[placeholder*="Enter event title"]', { timeout: 5_000 })

    // Update title in panel
    const editedTitle = `Edited ${suffix}`
    await page.fill('input[placeholder*="Enter event title"]', editedTitle)
    await submitPanel(page, 'Save Changes')

    // Verify update
    await expect(findCard(page, editedTitle)).toBeVisible({ timeout: 10_000 })
  })

  test('can toggle event type active/inactive', async ({ page }) => {
    const title = `Toggle Me ${suffix}`
    await createViaForm(page, title)

    // Hover over the card to reveal the deactivate icon, then click it
    const card = findCard(page, title)
    await card.hover()
    await card.locator('button[aria-label="Deactivate"]').click()

    // Card should show reduced opacity (inactive state)
    await page.waitForTimeout(500)
  })

  test('can delete an event type', async ({ page }) => {
    const title = `Delete Me ${suffix}`
    await createViaForm(page, title)

    // Click the card to open the edit panel, then click Delete in the panel footer
    await findCard(page, title).click()
    await page.waitForSelector('button:has-text("Delete")', { timeout: 5_000 })
    await page.locator('button:has-text("Delete")').first().click()

    // Confirm deletion in the ConfirmDialog modal
    const confirmDialog = page.locator('.fixed.inset-0').last()
    await confirmDialog.locator('button:has-text("Delete")').click()

    // Verify it's gone
    await expect(findCard(page, title)).not.toBeVisible({ timeout: 10_000 })
  })
})
