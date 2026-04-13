/**
 * Test helpers for BookMe Playwright tests
 *
 * Every helper logs what it does. If something fails, you see exactly
 * what happened — no guessing.
 */

import type { Page } from '@playwright/test'

const APP_SCOPE = 'app:bookme'

// ─── Core infrastructure ─────────────────────────────────────────────────────

/** Query records from a scope via the debug SQL endpoint.
 *  Includes a 10s fetch timeout so it never hangs silently. */
export async function debugQuery(
  page: Page,
  scopeId: string,
  sql: string,
): Promise<any[]> {
  const result = await page.evaluate(
    async ({ scopeId, sql }) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(
          `/platform/api/debug/sql?scopeId=${encodeURIComponent(scopeId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql }),
            signal: controller.signal,
          },
        )
        clearTimeout(timer)
        const body = await res.json() as any
        if (!res.ok) {
          return { _error: true, status: res.status, body }
        }
        return { _error: false, rows: body.rows ?? body.results ?? [] }
      } catch (err: any) {
        clearTimeout(timer)
        return { _error: true, status: 0, body: { message: err?.message ?? 'fetch failed (timeout or network)' } }
      }
    },
    { scopeId, sql },
  )
  if ((result as any)._error) {
    console.error(`[debugQuery] FAILED scopeId=${scopeId} sql="${sql}"`, (result as any).body)
    return []
  }
  return (result as any).rows
}

/** Get current user's ID from Clerk session. */
export async function getCurrentUserId(page: Page): Promise<string> {
  const userId = await page.evaluate(() => {
    const Clerk = (window as any).Clerk
    return Clerk?.user?.id ?? ''
  })
  console.log(`[helpers] getCurrentUserId → ${userId || '(empty!)'}`)
  return userId
}

// ─── App readiness ───────────────────────────────────────────────────────────

/** Wait for the app to be fully loaded (app-root visible). */
export async function waitForAppReady(page: Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 30_000 })
}

/** Navigate to a page and wait for it to load. */
export async function navigateTo(page: Page, path: string, testId: string) {
  await page.goto(path)
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15_000 })
}

// ─── Availability (the #1 thing that breaks tests) ──────────────────────────

/**
 * Verify that availability exists for the current user in the DB.
 * If it doesn't exist, FAIL LOUDLY with diagnostic info.
 *
 * This is a precondition check, not a fix. If availability is missing,
 * the test should fail here with a clear message instead of failing
 * later in schedule-event with a cryptic error.
 */
export async function verifyAvailabilityExists(page: Page, userId: string): Promise<boolean> {
  console.log(`[helpers] Checking availability for user ${userId}...`)

  const rows = await debugQuery(page, APP_SCOPE,
    `SELECT record_id, data FROM records WHERE collection = 'availability' ORDER BY created_at DESC LIMIT 10`,
  )
  console.log(`[helpers] Availability records in DB: ${rows.length}`)

  const userRow = rows.find((r: any) => {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    return data.userId === userId
  })

  if (userRow) {
    const data = typeof userRow.data === 'string' ? JSON.parse(userRow.data) : userRow.data
    console.log(`[helpers] ✓ Availability found for ${userId}: monday=${JSON.stringify(data.monday)}, timeGap=${data.timeGap}`)
    return true
  }

  console.error(`[helpers] ✗ NO availability for ${userId}!`)
  console.error(`[helpers]   All availability records:`, JSON.stringify(rows.map((r: any) => {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    return { recordId: r.record_id, userId: data.userId }
  })))
  return false
}

/**
 * Wait for availability to appear in the DB (auto-created by useAvailability hook).
 * Polls every 500ms up to maxWaitMs.
 * Returns true if found, false if timed out.
 */
export async function waitForAvailability(page: Page, userId: string, maxWaitMs = 10_000): Promise<boolean> {
  console.log(`[helpers] Waiting for availability to be auto-created for ${userId} (max ${maxWaitMs}ms)...`)
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const exists = await verifyAvailabilityExists(page, userId)
    if (exists) return true
    await page.waitForTimeout(500)
  }
  console.error(`[helpers] ✗ Availability NEVER appeared after ${maxWaitMs}ms`)
  return false
}

// ─── Event types ─────────────────────────────────────────────────────────────

/** Create an event type via the UI. */
export async function createEventType(
  page: Page,
  data: { title: string; description?: string; duration?: string }
) {
  console.log(`[helpers] Creating event type: "${data.title}"`)

  await page.click('a[href="/events"]')
  await page.waitForSelector('[data-testid="event-types-page"]', { timeout: 15_000 })

  await page.click('[data-testid="create-event-type-btn"]')
  await page.waitForSelector('input[placeholder*="Enter event title"]', { timeout: 5_000 })

  await page.fill('input[placeholder*="Enter event title"]', data.title)
  if (data.description) {
    await page.fill('textarea[placeholder*="What is this meeting"]', data.description)
  }
  if (data.duration) {
    await page.selectOption('select', { label: data.duration })
  }

  // Navigate through tabs (Basics → Settings → Notifications) to reach Create Event Type button
  const nextBtn = page.locator('button:has-text("Next")')
  while (await nextBtn.isVisible()) {
    await nextBtn.click()
    await page.waitForTimeout(200)
  }

  await page.click('[data-testid="create-event-type-submit-btn"]')
  console.log(`[helpers] ✓ Event type "${data.title}" created`)
}

/** Find an event type by title in the DB. Returns { record_id, data } or null. */
export async function findEventTypeByTitle(
  page: Page,
  title: string,
): Promise<{ record_id: string; data: any } | null> {
  const rows = await debugQuery(page, APP_SCOPE,
    `SELECT record_id, data FROM records WHERE collection = 'event-types' ORDER BY created_at DESC LIMIT 20`,
  )
  console.log(`[helpers] findEventTypeByTitle("${title}"): ${rows.length} event types in DB`)

  for (const r of rows) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    if (data.title === title) {
      console.log(`[helpers] ✓ Found event type "${title}" → record_id=${r.record_id}`)
      return { record_id: r.record_id, data }
    }
  }

  console.error(`[helpers] ✗ Event type "${title}" NOT FOUND in DB`)
  console.error(`[helpers]   Available titles:`, rows.map((r: any) => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    return d.title
  }))
  return null
}

// ─── Schedule event (the core action) ────────────────────────────────────────

/**
 * Call schedule-event action. Logs EVERYTHING: request params, response, errors.
 * If it fails, also logs the precondition state (availability, bookings).
 */
export async function callScheduleEvent(
  page: Page,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: any; error?: string }> {
  console.log(`[helpers] Calling schedule-event with:`, JSON.stringify(params, null, 2))

  const result = await page.evaluate(async (params) => {
    const Clerk = (window as any).Clerk
    let token: string | null = null
    if (Clerk?.session) {
      token = await Clerk.session.getToken()
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch('/api/actions/schedule-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const body = await res.json() as any
      return { httpStatus: res.status, ...body }
    } catch (err: any) {
      clearTimeout(timer)
      return { httpStatus: 0, success: false, error: `Fetch failed: ${err?.message ?? 'timeout or network error'}` }
    }
  }, params)

  const { httpStatus, ...apiResult } = result as any

  if (apiResult.success) {
    console.log(`[helpers] ✓ schedule-event succeeded (HTTP ${httpStatus})`)
    console.log(`[helpers]   bookingId=${apiResult.data?.bookingId}`)
    console.log(`[helpers]   eventType toggles:`, apiResult.data?.eventType)
  } else {
    console.error(`[helpers] ✗ schedule-event FAILED (HTTP ${httpStatus})`)
    console.error(`[helpers]   error: "${apiResult.error}"`)
    console.error(`[helpers]   params were:`, JSON.stringify(params))

    // Diagnostic: dump availability and booking state
    const hostUserId = params.hostUserId as string
    if (hostUserId) {
      console.error(`[helpers]   --- DIAGNOSTICS ---`)
      await verifyAvailabilityExists(page, hostUserId)
      const bookings = await debugQuery(page, APP_SCOPE,
        `SELECT record_id, data FROM records WHERE collection = 'bookings' ORDER BY created_at DESC LIMIT 5`,
      )
      console.error(`[helpers]   Recent bookings: ${bookings.length}`)
      for (const b of bookings.slice(0, 3)) {
        const d = typeof b.data === 'string' ? JSON.parse(b.data) : b.data
        console.error(`[helpers]     ${d.startTime} → ${d.endTime} (${d.status}) guest=${d.guestName}`)
      }
    }
  }

  return apiResult
}

// ─── Calendar events (table-mode storage) ────────────────────────────────────

/** Query calendar events from a user's c_events table. */
export async function queryCalendarEvents(
  page: Page,
  userScopeId: string,
): Promise<Array<{
  _row_id: string
  col_title: string
  col_description: string
  col_starttime: string
  col_endtime: string
  col_sourceref: string
  col_metadata: string
  _created_at: string
}>> {
  console.log(`[helpers] Querying calendar events in ${userScopeId}...`)
  const rows = await debugQuery(page, userScopeId,
    `SELECT _row_id, col_title, col_description, col_starttime, col_endtime, col_sourceref, col_metadata, _created_at FROM c_events ORDER BY _created_at DESC LIMIT 10`,
  )
  console.log(`[helpers]   Found ${rows.length} calendar events`)
  for (const r of rows) {
    console.log(`[helpers]   - "${r.col_title}" @ ${r.col_starttime} (source=${r.col_sourceref})`)
  }
  return rows
}

// ─── Booking page navigation ────────────────────────────────────────────────

/** Navigate to dashboard, get booking link. */
export async function getBookingBasePath(page: Page): Promise<string | null> {
  await page.click('a[href="/"]')
  const dashboard = page.locator('[data-testid="dashboard-page"]')
  await dashboard.waitFor({ state: 'visible', timeout: 10_000 })

  const bookingLinkEl = page.locator('code:has-text("/book/")').first()
  try {
    await bookingLinkEl.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    console.error('[helpers] No booking link found on dashboard')
    return null
  }
  const linkText = await bookingLinkEl.textContent()
  if (!linkText) return null
  const path = new URL(linkText).pathname
  console.log(`[helpers] Booking base path: ${path}`)
  return path
}

/** Pick a far-future date and time slot on the booking page. */
export async function pickFreshDateAndTime(page: Page) {
  const nextMonthBtn = page.locator('h3:has-text("202") + button')
  await nextMonthBtn.waitFor({ state: 'visible', timeout: 5_000 })
  await nextMonthBtn.click()
  await page.waitForTimeout(300)
  await nextMonthBtn.click()
  await page.waitForTimeout(300)

  const calendarBtns = page
    .locator('.grid.grid-cols-7').nth(1)
    .locator('button:not([disabled])')
  const count = await calendarBtns.count()
  console.log(`[helpers] pickFreshDateAndTime: ${count} available dates`)
  await calendarBtns.nth(Math.max(0, count - 1)).click()

  await page.locator('text=Select a Time').waitFor({ state: 'visible', timeout: 5_000 })
  // Time slots display in 12h format (e.g., "9:00 AM", "2:30 PM") or 24h format (e.g., "09:00")
  const timeSlots = page.locator('button').filter({ hasText: /^\d{1,2}:\d{2}(\s?(AM|PM))?$/ })
  const slotCount = await timeSlots.count()
  console.log(`[helpers] pickFreshDateAndTime: ${slotCount} time slots`)
  await timeSlots.nth(Math.max(0, slotCount - 1)).click()
}

// ─── Time slot generation ───────────────────────────────────────────────────

/**
 * Generate a unique future weekday date+time.
 * Each call uses Date.now() so consecutive calls within the same test
 * get different minutes. dayOffset spreads tests across different dates.
 *
 * Uses LOCAL hours (10-15) because the availability window (09:00-17:00)
 * is stored in the host's local timezone. The server converts the ISO
 * string to the host's timezone before checking.
 */
export function uniqueFutureSlot(dayOffset: number): Date {
  const now = Date.now()
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  // Use current ms to pick hour (10-15 local, safely within 09:00-17:00)
  const hour = 10 + (now % 6)
  const minute = Math.floor((now / 6) % 60)
  d.setHours(hour, minute, 0, 0)
  return d
}

// ─── Data clearing ──────────────────────────────────────────────────────────

/** Clear bookings (and optionally event-types) from the DB so tests don't collide. */
export async function clearBookings(page: Page, options?: { clearEventTypes?: boolean }) {
  console.log('[helpers] Clearing bookings from DB...')
  await debugQuery(page, APP_SCOPE, `DELETE FROM records WHERE collection = 'bookings'`)
  console.log('[helpers] ✓ Bookings cleared')

  if (options?.clearEventTypes) {
    console.log('[helpers] Clearing event-types from DB...')
    await debugQuery(page, APP_SCOPE, `DELETE FROM records WHERE collection = 'event-types'`)
    console.log('[helpers] ✓ Event types cleared')
  }
}

// ─── Set availability ───────────────────────────────────────────────────────

export async function setAvailability(
  page: Page,
  options?: { resetFirst?: boolean }
) {
  await page.click('a[href="/availability"]')
  await page.waitForSelector('[data-testid="availability-page"]', { timeout: 15_000 })
  if (options?.resetFirst) {
    await page.click('button:has-text("Reset to Default")')
  }
}
