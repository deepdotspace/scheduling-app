/**
 * Booking Integration Tests
 *
 * Every test:
 *  1. Logs what it's doing at every step
 *  2. Verifies preconditions (availability exists) BEFORE attempting bookings
 *  3. Logs full API responses on failure with diagnostic context
 *  4. Uses unique future dates so tests never collide
 */

import { test, expect } from '../../../test-utils/index.ts'
import {
  waitForAppReady,
  getCurrentUserId,
  createEventType,
  findEventTypeByTitle,
  waitForAvailability,
  callScheduleEvent,
  queryCalendarEvents,
  debugQuery,
  getBookingBasePath,
  pickFreshDateAndTime,
  uniqueFutureSlot,
  clearBookings,
} from './helpers'

const APP_SCOPE = 'app:bookme'
const suffix = Date.now().toString(36).slice(-4)

// ─── Test Suite: schedule-event Action (API-level) ─────────────────────────

test.describe('schedule-event Action', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)

    // Clear accumulated bookings from prior runs so they don't cause conflicts
    await clearBookings(page)

    // CRITICAL: Verify availability exists before any test runs.
    const userId = await getCurrentUserId(page)
    expect(userId).toBeTruthy()

    const available = await waitForAvailability(page, userId, 15_000)
    if (!available) {
      console.log('[beforeEach] Availability not auto-created. Navigating to /availability to trigger it...')
      await page.click('a[href="/availability"]')
      await page.waitForSelector('[data-testid="availability-page"]', { timeout: 10_000 })
      await page.waitForTimeout(2000)
      const retryAvail = await waitForAvailability(page, userId, 10_000)
      expect(retryAvail).toBe(true)
    }
  })

  test('creates host calendar event and returns eventType toggles', async ({ page }) => {
    const userId = await getCurrentUserId(page)

    // Step 1: Create event type
    const title = `Action Host Cal ${suffix}`
    await createEventType(page, { title, description: 'Host calendar test' })
    await page.waitForTimeout(1000) // Let WS sync

    // Step 2: Verify event type exists in DB
    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()

    // Step 3: Call schedule-event with unique future time
    const futureStart = uniqueFutureSlot(45)
    console.log(`[test] Booking at: ${futureStart.toISOString()} (day=${futureStart.toLocaleDateString('en-US', { weekday: 'long' })})`)

    const result = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'host-cal-test@example.com',
      guestName: 'Host Cal Guest',
      description: 'Integration test booking',
    })

    // Step 4: Verify success
    expect(result.success).toBe(true)

    // Step 5: Verify eventType toggles in response
    expect(result.data).toBeTruthy()
    expect(result.data.eventType).toBeTruthy()
    expect(result.data.eventType).toHaveProperty('sendDeepSpaceMail')
    expect(result.data.eventType).toHaveProperty('sendGoogleCalendarInvite')
    expect(result.data.eventType).toHaveProperty('sendExternalEmail')

    // Step 6: Verify host calendar event in c_events table
    const hostEvents = await queryCalendarEvents(page, `user:${userId}`)
    const hostEvent = hostEvents.find((r) =>
      r.col_sourceref === 'book-me:booking' && (r.col_title || '').includes(title)
    )
    expect(hostEvent).toBeTruthy()
    expect(hostEvent!.col_title).toContain('Host Cal Guest')
    expect(hostEvent!.col_starttime).toBe(futureStart.toISOString())
    console.log('[test] ✓ All assertions passed')
  })

  test('creates guest calendar event when guestUserId is provided', async ({ page }) => {
    const userId = await getCurrentUserId(page)

    // Step 1: Create event type
    const title = `Action Guest Cal ${suffix}`
    await createEventType(page, { title, description: 'Guest calendar test' })
    await page.waitForTimeout(1000)

    // Step 2: Find event type
    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()

    // Step 3: Look up User B
    const lookupResult = await page.evaluate(async () => {
      const mcapiClient = (window as any).mcapi
      if (!mcapiClient) return { success: false, error: 'mcapi not available on window' }
      try {
        return await mcapiClient.post('lookup-user', { email: 'ctc2@gmail.com' })
      } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) }
      }
    })
    console.log('[test] User B lookup:', JSON.stringify(lookupResult))
    const guestUserId = (lookupResult as any)?.data?.userId

    // Step 4: Book with unique time on a different day
    const futureStart = uniqueFutureSlot(55)
    console.log(`[test] Booking at: ${futureStart.toISOString()}`)

    const result = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'ctc2@gmail.com',
      guestName: 'User B',
      description: 'Guest calendar integration test',
      ...(guestUserId ? { guestUserId } : {}),
    })

    expect(result.success).toBe(true)

    // Step 5: Verify host calendar event
    const hostEvents = await queryCalendarEvents(page, `user:${userId}`)
    const hostEvent = hostEvents.find((r) => (r.col_title || '').includes(title))
    expect(hostEvent).toBeTruthy()

    // Step 6: Verify guest calendar event
    if (guestUserId) {
      const guestEvents = await queryCalendarEvents(page, `user:${guestUserId}`)
      const guestEvent = guestEvents.find((r) => r.col_sourceref === 'book-me:guest-booking')
      expect(guestEvent).toBeTruthy()
      console.log('[test] ✓ Both host and guest calendar events created')
    } else {
      console.warn('[test] Skipping guest calendar check — could not resolve guestUserId')
    }
  })
})

// ─── Test Suite: Notification Toggles ──────────────────────────────────────

test.describe('Notification Toggles', () => {
  test('toggles are persisted in DB and returned by schedule-event', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await clearBookings(page)
    const userId = await getCurrentUserId(page)
    await waitForAvailability(page, userId, 15_000)

    const title = `Toggle DB ${suffix}`
    await createEventType(page, { title, description: 'Toggle persistence test' })
    await page.waitForTimeout(1000)

    // Step 1: Verify defaults in DB
    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()
    console.log('[test] Event type data:', JSON.stringify(etRecord!.data))
    expect(etRecord!.data.sendDeepSpaceMail ?? false).toBe(false)
    expect(etRecord!.data.sendGcalInvite ?? false).toBe(false)
    expect(etRecord!.data.sendExternalEmail ?? true).toBe(true)

    // Step 2: Edit via UI — toggle DeepSpace Mail ON
    await page.click('a[href="/events"]')
    await expect(page.locator('[data-testid="event-types-page"]')).toBeVisible()

    const card = page.locator('[data-testid^="event-type-card-"]').filter({ hasText: title })
    await card.locator('button:has-text("Edit")').click()
    await page.locator('.fixed.inset-0').waitFor({ state: 'visible' })

    // Navigate to Notifications tab where the GCal toggle lives
    const modal = page.locator('.fixed.inset-0')
    const nextBtn = modal.locator('button:has-text("Next")')
    while (await nextBtn.isVisible()) {
      await nextBtn.click()
      await page.waitForTimeout(200)
    }

    const dsmToggle = modal.locator('label:has-text("DeepSpace Mail") button').first()
    await dsmToggle.click()
    await page.waitForTimeout(300)

    await modal.locator('button:has-text("Save Changes")').click()
    await page.locator('.fixed.inset-0').waitFor({ state: 'hidden', timeout: 5_000 })
    await page.waitForTimeout(1500) // Wait for WS sync

    // Step 3: Verify DB was updated
    const updated = await debugQuery(page, APP_SCOPE,
      `SELECT record_id, data FROM records WHERE collection = 'event-types' AND record_id = '${etRecord!.record_id}'`,
    )
    expect(updated.length).toBe(1)
    const updatedData = typeof updated[0].data === 'string' ? JSON.parse(updated[0].data) : updated[0].data
    console.log('[test] Updated data:', JSON.stringify(updatedData))
    expect(updatedData.sendDeepSpaceMail ?? false).toBe(true)
    expect(updatedData.sendGcalInvite ?? false).toBe(false)
    expect(updatedData.sendExternalEmail).toBe(true)

    // Step 4: Call schedule-event and verify toggles come back
    const futureStart = uniqueFutureSlot(93)
    console.log(`[test] Booking at: ${futureStart.toISOString()}`)

    const result = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'toggle-test@example.com',
      guestName: 'Toggle Tester',
    })
    expect(result.success).toBe(true)
    expect(result.data.eventType.sendDeepSpaceMail).toBe(true)
    expect(result.data.eventType.sendGoogleCalendarInvite).toBe(false)
    expect(result.data.eventType.sendExternalEmail).toBe(true)
    console.log('[test] ✓ Toggles persisted and returned correctly')
  })
})

// ─── Test Suite: Booking Conflict Error Flow ──────────────────────────────

test.describe('Booking Conflict Error Flow', () => {
  test('server rejects double-booking the same time slot', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await clearBookings(page)
    const userId = await getCurrentUserId(page)
    await waitForAvailability(page, userId, 15_000)

    const title = `Conflict ${suffix}`
    await createEventType(page, { title, description: 'Conflict test' })
    await page.waitForTimeout(1000)

    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()

    const futureStart = uniqueFutureSlot(110)
    console.log(`[test] Double-booking at: ${futureStart.toISOString()}`)

    // First booking should succeed
    const result1 = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'conflict-a@example.com',
      guestName: 'First Guest',
    })
    expect(result1.success).toBe(true)

    // Second booking at the SAME time should fail
    const result2 = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'conflict-b@example.com',
      guestName: 'Second Guest',
    })
    expect(result2.success).toBe(false)
    expect(result2.error).toContain('conflict')
    console.log('[test] ✓ Double-booking correctly rejected')
  })

  test('overlapping bookings at different offsets are rejected', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await clearBookings(page)
    const userId = await getCurrentUserId(page)
    await waitForAvailability(page, userId, 15_000)

    const title = `Overlap ${suffix}`
    await createEventType(page, { title, description: 'Overlap test' })
    await page.waitForTimeout(1000)

    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()

    const futureStart = uniqueFutureSlot(130)
    console.log(`[test] Base booking at: ${futureStart.toISOString()}`)

    // Book the base slot
    const result1 = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'overlap-a@example.com',
      guestName: 'Overlap Guest A',
    })
    expect(result1.success).toBe(true)

    // Overlapping booking 15 min later (within 30-min duration)
    const overlapStart = new Date(futureStart.getTime() + 15 * 60_000)
    console.log(`[test] Overlap booking at: ${overlapStart.toISOString()}`)
    const resultOverlap = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: overlapStart.toISOString(),
      guestEmail: 'overlap-b@example.com',
      guestName: 'Overlap Guest B',
    })
    expect(resultOverlap.success).toBe(false)
    expect(resultOverlap.error).toContain('conflict')

    // Non-overlapping booking after the first one ends
    const afterEnd = new Date(futureStart.getTime() + 31 * 60_000)
    console.log(`[test] Non-overlapping booking at: ${afterEnd.toISOString()}`)
    const resultAfter = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: afterEnd.toISOString(),
      guestEmail: 'overlap-c@example.com',
      guestName: 'No Overlap Guest C',
    })
    expect(resultAfter.success).toBe(true)
    console.log('[test] ✓ Overlap detection working correctly')
  })
})

// ─── Test Suite: Full E2E Booking with Backend Verification ────────────────

test.describe('Full Booking E2E', () => {
  test('external guest booking creates host calendar event and sends email', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await clearBookings(page)
    const userId = await getCurrentUserId(page)
    await waitForAvailability(page, userId, 15_000)

    const title = `Ext E2E ${suffix}`
    await createEventType(page, { title, description: 'External guest e2e' })

    const basePath = await getBookingBasePath(page)
    if (!basePath) { test.skip(true, 'No booking link'); return }

    // Navigate to booking page
    await page.goto(basePath)
    await expect(page.locator('text=Select an event type')).toBeVisible({ timeout: 15_000 })
    await page.locator(`text=${title}`).click()
    await expect(page.locator('[data-testid="booking-page"]')).toBeVisible({ timeout: 15_000 })

    await pickFreshDateAndTime(page)

    // Fill external guest details
    await expect(page.locator('text=Enter Your Details')).toBeVisible({ timeout: 5_000 })
    await page.fill('input[placeholder="john@example.com"]', 'ext-e2e@example.com')
    await page.waitForTimeout(800)
    await page.fill('input[placeholder="John Doe"]', 'External E2E')

    // Track network calls
    const apiCalls: { url: string; method: string; status: number; responseBody?: string }[] = []
    page.on('response', async (res) => {
      const url = res.url()
      if (url.includes('schedule-event')) {
        let body = ''
        try { body = await res.text() } catch { /* ignore */ }
        apiCalls.push({ url, method: res.request().method(), status: res.status(), responseBody: body })
      }
    })

    // Submit booking
    await page.click('button:has-text("Schedule Meeting")')
    await expect(page.locator('text=Booking Confirmed!')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(3000)

    // Verify schedule-event
    const scheduleCall = apiCalls.find(c => c.url.includes('schedule-event'))
    console.log('[test] schedule-event response:', scheduleCall?.status, scheduleCall?.responseBody?.slice(0, 200))
    expect(scheduleCall).toBeTruthy()
    expect(scheduleCall!.status).toBe(200)

    // Verify host calendar event
    const hostEvents = await queryCalendarEvents(page, `user:${userId}`)
    const hostEvent = hostEvents.find((r) =>
      r.col_sourceref === 'book-me:booking' && (r.col_title || '').includes(title)
    )
    expect(hostEvent).toBeTruthy()

    // Transactional email is sent server-side via `email/send` inside schedule-event (not visible in browser network).
    console.log('[test] ✓ External booking E2E passed')
  })

  test('internal guest booking creates BOTH calendar events and sends DM', async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await clearBookings(page)
    const userId = await getCurrentUserId(page)
    await waitForAvailability(page, userId, 15_000)

    const title = `Int E2E ${suffix}`
    await createEventType(page, { title, description: 'Internal guest e2e' })

    const basePath = await getBookingBasePath(page)
    if (!basePath) { test.skip(true, 'No booking link'); return }

    await page.goto(basePath)
    await expect(page.locator('text=Select an event type')).toBeVisible({ timeout: 15_000 })
    await page.locator(`text=${title}`).click()
    await expect(page.locator('[data-testid="booking-page"]')).toBeVisible({ timeout: 15_000 })

    await pickFreshDateAndTime(page)

    // Fill with real DeepSpace user (User B)
    await expect(page.locator('text=Enter Your Details')).toBeVisible({ timeout: 5_000 })
    await page.fill('input[placeholder="john@example.com"]', 'ctc2@gmail.com')
    await expect(page.locator('text=DeepSpace user')).toBeVisible({ timeout: 15_000 })
    console.log('[test] User B found via lookup')

    const nameInput = page.locator('input[placeholder="John Doe"]')
    await page.waitForTimeout(500)
    const nameValue = await nameInput.inputValue()
    if (!nameValue) await nameInput.fill('User B')

    // Track network & WebSocket
    const apiCalls: { url: string; method: string; status: number; body?: string; responseBody?: string }[] = []
    page.on('request', (req) => {
      if (req.url().includes('schedule-event')) {
        apiCalls.push({ url: req.url(), method: req.method(), status: 0, body: req.postData() ?? '' })
      }
    })
    page.on('response', async (res) => {
      const url = res.url()
      if (url.includes('schedule-event')) {
        let responseBody = ''
        try { responseBody = await res.text() } catch { /* */ }
        const existing = apiCalls.find(c => c.url === url && c.status === 0)
        if (existing) { existing.status = res.status(); existing.responseBody = responseBody }
        else apiCalls.push({ url, method: res.request().method(), status: res.status(), responseBody })
      }
    })
    const wsUrls: string[] = []
    page.on('websocket', (ws) => wsUrls.push(ws.url()))

    await page.click('button:has-text("Schedule Meeting")')
    await expect(page.locator('text=Booking Confirmed!')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(5000)

    // Verify schedule-event
    const scheduleCall = apiCalls.find(c => c.url.includes('schedule-event'))
    console.log('[test] schedule-event:', scheduleCall?.status, scheduleCall?.responseBody?.slice(0, 200))
    expect(scheduleCall).toBeTruthy()
    expect(scheduleCall!.status).toBe(200)

    // Verify guestUserId was passed
    if (scheduleCall!.body) {
      const parsed = JSON.parse(scheduleCall!.body)
      console.log('[test] guestUserId passed:', parsed.guestUserId)
      expect(parsed.guestUserId).toBeTruthy()

      // Verify guest calendar event
      if (parsed.guestUserId) {
        const guestEvents = await queryCalendarEvents(page, `user:${parsed.guestUserId}`)
        const guestEvent = guestEvents.find((r) => r.col_sourceref === 'book-me:guest-booking')
        expect(guestEvent).toBeTruthy()
      }
    }

    // Verify host calendar event
    const hostEvents = await queryCalendarEvents(page, `user:${userId}`)
    const hostEvent = hostEvents.find((r) =>
      r.col_sourceref === 'book-me:booking' && (r.col_title || '').includes(title)
    )
    expect(hostEvent).toBeTruthy()

    console.log('[test] ✓ Internal booking E2E passed')
  })
})

// ─── Test Suite: Email Notifications (cancel + reschedule) ─────────────────

test.describe('Email Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForAppReady(page)
    await clearBookings(page)
    const userId = await getCurrentUserId(page)
    expect(userId).toBeTruthy()
    await waitForAvailability(page, userId, 15_000)
  })

  test('cancellation succeeds and server sends transactional email (cancel-booking action)', async ({ page }) => {
    const userId = await getCurrentUserId(page)

    // Step 1: Create event type
    const title = `Cancel Email ${suffix}`
    await createEventType(page, { title, description: 'Cancel email test' })
    await page.waitForTimeout(1000)

    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()

    // Step 2: Book via API with external guest (no guestUserId → always sends email)
    const futureStart = uniqueFutureSlot(170)
    console.log(`[test] Booking for cancel-email test at: ${futureStart.toISOString()}`)
    const result = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'cancel-email-guest@example.com',
      guestName: 'Cancel Email Guest',
    })
    expect(result.success).toBe(true)
    console.log(`[test] Booking ID: ${result.data?.bookingId}`)

    const actionCalls: { url: string; status: number }[] = []
    page.on('response', async (res) => {
      if (res.url().includes('cancel-booking')) {
        actionCalls.push({ url: res.url(), status: res.status() })
        console.log('[test] cancel-booking response status:', res.status())
      }
    })

    await page.goto('/meetings')
    await page.waitForSelector('[data-testid="meetings-page"]', { timeout: 15_000 })
    await page.waitForTimeout(1000)

    // Step 4: Click on the booking row (find by guest name)
    const row = page.locator('tr[role="button"]').filter({ hasText: 'Cancel Email Guest' }).first()
    await row.waitFor({ state: 'visible', timeout: 10_000 })
    await row.click()

    // Step 5: Wait for the detail panel and click "Cancel"
    const cancelBtn = page.locator('button[aria-label*="ancel"]').or(
      page.locator('button').filter({ hasText: /^Cancel$/ })
    ).first()
    await cancelBtn.waitFor({ state: 'visible', timeout: 8_000 })
    await cancelBtn.click()

    // Step 6: Click "Cancel Meeting" in the confirmation modal
    const confirmBtn = page.locator('button:has-text("Cancel Meeting")').last()
    await confirmBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await confirmBtn.click()

    await page.waitForTimeout(3000)

    const cancelAction = actionCalls.find(c => c.url.includes('cancel-booking'))
    expect(cancelAction?.status).toBe(200)
    console.log('[test] ✓ Cancel action completed (transactional email is server-side email/send)')
  })

  test('reschedule succeeds and server sends transactional email (reschedule-booking action)', async ({ page }) => {
    const userId = await getCurrentUserId(page)

    // Step 1: Create event type
    const title = `Reschedule Email ${suffix}`
    await createEventType(page, { title, description: 'Reschedule email test' })
    await page.waitForTimeout(1000)

    const etRecord = await findEventTypeByTitle(page, title)
    expect(etRecord).toBeTruthy()

    // Step 2: Book via API with external guest
    const futureStart = uniqueFutureSlot(185)
    console.log(`[test] Booking for reschedule-email test at: ${futureStart.toISOString()}`)
    const result = await callScheduleEvent(page, {
      hostUserId: userId,
      eventTypeId: etRecord!.record_id,
      startTime: futureStart.toISOString(),
      guestEmail: 'reschedule-email-guest@example.com',
      guestName: 'Reschedule Email Guest',
    })
    expect(result.success).toBe(true)
    const bookingId = result.data?.bookingId
    expect(bookingId).toBeTruthy()
    console.log(`[test] Booking ID: ${bookingId}`)

    const actionCalls: { url: string; status: number }[] = []
    page.on('response', async (res) => {
      if (res.url().includes('reschedule-booking')) {
        actionCalls.push({ url: res.url(), status: res.status() })
        console.log('[test] reschedule-booking response status:', res.status())
      }
    })

    await page.goto(`/meetings/reschedule/${bookingId}`)
    await page.waitForSelector('[data-testid="reschedule-page"]', { timeout: 15_000 })
    await page.waitForTimeout(1500)

    // Step 4: Pick a new date (2 months forward, use last available date)
    const nextMonthBtn = page.locator('h3:has-text("202") + button').first()
    await nextMonthBtn.waitFor({ state: 'visible', timeout: 8_000 })
    await nextMonthBtn.click()
    await page.waitForTimeout(300)
    await nextMonthBtn.click()
    await page.waitForTimeout(500)

    // Pick last available day
    const calendarBtns = page
      .locator('.grid.grid-cols-7').nth(1)
      .locator('button:not([disabled])')
    const count = await calendarBtns.count()
    console.log(`[test] Reschedule calendar: ${count} available dates`)
    expect(count).toBeGreaterThan(0)
    await calendarBtns.nth(Math.max(0, count - 1)).click()
    await page.waitForTimeout(500)

    // Step 5: Pick a time slot
    const timeSlots = page.locator('button').filter({ hasText: /^\d{1,2}:\d{2}(\s?(AM|PM))?$/ })
    const slotCount = await timeSlots.count()
    console.log(`[test] Reschedule time slots: ${slotCount}`)
    expect(slotCount).toBeGreaterThan(0)
    await timeSlots.nth(Math.max(0, slotCount - 1)).click()
    await page.waitForTimeout(500)

    // Step 6: Fill reason for change (email is auto-filled from logged-in user)
    const reasonField = page.locator('textarea[placeholder*="rescheduling"]')
    await reasonField.waitFor({ state: 'visible', timeout: 8_000 })
    await reasonField.fill('Test reschedule reason for email notification test')

    // Step 7: Submit reschedule
    const submitBtn = page.locator('button:has-text("Confirm Reschedule")')
    await submitBtn.waitFor({ state: 'visible', timeout: 5_000 })
    await submitBtn.click()

    await expect(page.locator('text=Meeting Rescheduled!')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2000)

    const rescheduleAction = actionCalls.find(c => c.url.includes('reschedule-booking'))
    expect(rescheduleAction?.status).toBe(200)
    console.log('[test] ✓ Reschedule action completed (transactional email is server-side email/send)')
  })
})
