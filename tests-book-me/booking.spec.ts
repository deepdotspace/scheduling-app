/**
 * Booking flow tests — create event type, navigate to booking page, pick date/time, fill form, confirm
 */

import { test, expect } from '../../../test-utils/index.ts'
import { waitForAppReady, createEventType, getBookingBasePath } from './helpers'

const suffix = Date.now().toString(36).slice(-4)

test.describe('Booking Flow', () => {
  test('can create event type and see booking link', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)

    await createEventType(page, {
      title: 'Test Meeting',
      description: 'A test meeting for booking flow',
    })

    await expect(page.getByRole('heading', { name: 'Test Meeting' }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button:has-text("Copy Link")').first()).toBeVisible({ timeout: 5_000 })
  })

  test('booking page shows host profile and event types', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)

    await createEventType(page, {
      title: 'Booking Page Test',
      description: 'For testing the booking page',
    })

    const basePath = await getBookingBasePath(page)
    if (basePath) {
      await page.goto(basePath)
      await expect(page.locator('text=Select an event type')).toBeVisible({ timeout: 15_000 })
    }
  })
})

/** Helper: pick a future date and time slot on the booking page. */
async function pickDateAndTime(page: import('@playwright/test').Page) {
  const nextMonthBtn = page.locator('[data-testid="calendar"] button[aria-label="Next month"]')
  await expect(nextMonthBtn).toBeVisible({ timeout: 5_000 })
  await nextMonthBtn.click()
  await page.waitForTimeout(300)

  const calendarBtn = page
    .locator('[data-testid="calendar"] [role="grid"]')
    .locator('button:not([disabled]):not([aria-disabled="true"])')
    .first()
  await expect(calendarBtn).toBeVisible({ timeout: 5_000 })
  await calendarBtn.click()

  await expect(page.locator('text=Select a Time')).toBeVisible({ timeout: 5_000 })
  const timeSlot = page.locator('button').filter({ hasText: /^\d{1,2}:\d{2}(\s?(AM|PM))?$/ }).first()
  await expect(timeSlot).toBeVisible({ timeout: 5_000 })
  await timeSlot.click()
}

test.describe('Booking Confirmation', () => {
  test('completed booking shows DeepSpace video call link', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    const title = `Video Call E2E ${suffix}`
    await createEventType(page, { title, description: 'Video call link test' })

    const basePath = await getBookingBasePath(page)
    if (!basePath) {
      test.skip(true, 'No booking link — user has no profile username')
      return
    }

    await page.goto(basePath)
    await expect(page.locator('text=Select an event type')).toBeVisible({ timeout: 15_000 })
    await page.locator(`text=${title}`).click()
    await expect(page.locator('[data-testid="booking-page"]')).toBeVisible({ timeout: 15_000 })

    await pickDateAndTime(page)

    await expect(page.locator('text=Enter Your Details')).toBeVisible({ timeout: 5_000 })
    await page.fill('input[placeholder="John Doe"]', 'E2E Test Guest')
    await page.fill('input[placeholder="john@example.com"]', 'e2e-test@example.com')

    await page.click('button:has-text("Schedule Meeting")')

    await expect(page.locator('text=Booking Confirmed!')).toBeVisible({ timeout: 30_000 })

    const meetingLink = page.locator('a[href*="video-call.app.space/call/"]')
    await expect(meetingLink).toBeVisible({ timeout: 5_000 })

    const href = await meetingLink.getAttribute('href')
    expect(href).toMatch(/^https:\/\/video-call\.app\.space\/call\/[a-z0-9]{4}-[a-z0-9]{4}$/)

    const linkText = await meetingLink.textContent()
    expect(linkText).toBe(href)

    await expect(page.locator(`text=${title}`)).toBeVisible()
  })

  test('internal booking triggers DM WebSocket to deepspace-mail', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    const title = `DM Notify E2E ${suffix}`
    await createEventType(page, { title, description: 'DM notification test' })

    const basePath = await getBookingBasePath(page)
    if (!basePath) {
      test.skip(true, 'No booking link')
      return
    }

    await page.goto(basePath)
    await expect(page.locator('text=Select an event type')).toBeVisible({ timeout: 15_000 })
    await page.locator(`text=${title}`).click()
    await expect(page.locator('[data-testid="booking-page"]')).toBeVisible({ timeout: 15_000 })

    await pickDateAndTime(page)

    await page.fill('input[placeholder="john@example.com"]', 'ctc2@gmail.com')
    await expect(page.locator('text=DeepSpace user')).toBeVisible({ timeout: 10_000 })

    const nameInput = page.locator('input[placeholder="John Doe"]')
    const nameValue = await nameInput.inputValue()
    if (!nameValue) {
      await nameInput.fill('User B')
    }

    const wsUrls: string[] = []
    page.on('websocket', (ws) => {
      wsUrls.push(ws.url())
    })

    await page.click('button:has-text("Schedule Meeting")')
    await expect(page.locator('text=Booking Confirmed!')).toBeVisible({ timeout: 30_000 })

    const dmWs = wsUrls.find((u) => u.includes('app:mail'))
    expect(dmWs).toBeTruthy()
  })
})
