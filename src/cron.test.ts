/**
 * Blast-radius tests for the send-reminders cron task.
 *
 * These exist because of what arming the cron room means: the task has never
 * run in production, so the first tick is the first time every confirmed
 * booking in the app is examined. The question that has to have a provable
 * answer is "how many emails leave on that tick", and the three things that
 * bound it — skip already-started bookings, absolute reminder windows, and the
 * `remindersSent` idempotence marker — are what these tests pin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CronContext } from 'deepspace/worker'
import { sendReminders } from './cron'

interface BookingRow {
  recordId: string
  data: Record<string, unknown>
}

/**
 * A CronContext over an in-memory bookings table. `emails` records every
 * email/send that actually left, so a test can assert an exact count rather
 * than a vague "it did not blast".
 */
function fakeCtx(rows: BookingRow[], opts: { emailFails?: boolean } = {}) {
  const emails: Array<{ to: string; subject: string }> = []
  const updates: Array<{ recordId: string; data: Record<string, unknown> }> = []

  const ctx = {
    ownerUserId: 'owner',
    records: {
      query: vi.fn(async (collection: string, q?: { where?: Record<string, unknown> }) => {
        expect(collection).toBe('bookings')
        const want = q?.where?.status
        return rows
          .filter((r) => want === undefined || r.data.status === want)
          .map((r) => ({ recordId: r.recordId, data: { ...r.data } }))
      }),
      update: vi.fn(async (_collection: string, recordId: string, data: Record<string, unknown>) => {
        updates.push({ recordId, data })
        const row = rows.find((r) => r.recordId === recordId)
        if (row) Object.assign(row.data, data)
        return {}
      }),
      create: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    integrations: {
      call: vi.fn(async (endpoint: string, params?: Record<string, unknown>) => {
        expect(endpoint).toBe('email/send')
        if (opts.emailFails) return { error: 'sender domain not verified' }
        emails.push({ to: String(params?.to), subject: String(params?.subject) })
        return { id: 'msg_1' }
      }),
    },
  } as unknown as CronContext

  return { ctx, emails, updates }
}

const HOUR = 60 * 60 * 1000

function booking(over: Record<string, unknown> = {}): BookingRow {
  return {
    recordId: (over.recordId as string | undefined) ?? `bk_${Math.random().toString(36).slice(2)}`,
    data: {
      status: 'confirmed',
      hostName: 'Host',
      hostEmail: 'host@example.com',
      guestName: 'Guest',
      eventTitle: 'Intro call',
      hostTimezone: 'UTC',
      ...over,
    },
  }
}

/** A booking whose start time is `hours` from the frozen clock. */
function bookingIn(hours: number, over: Record<string, unknown> = {}): BookingRow {
  const start = new Date(Date.now() + hours * HOUR)
  return booking({
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
    ...over,
  })
}

const NOW = Date.parse('2026-08-20T03:31:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * The rows that are actually in the bookwithme production RecordRoom
 * (app:bookwithme), read read-only over the owner's WebSocket on 2026-08-20.
 * Two confirmed bookings, both with a start time weeks in the past, neither
 * carrying a remindersSent marker. This is the literal first tick.
 */
const PRODUCTION_BOOKINGS: BookingRow[] = [
  booking({
    recordId: '1783987375521_9f9yxp',
    startTime: '2026-07-14T13:00:49.217Z',
    endTime: '2026-07-14T13:30:49.217Z',
    hostName: 'heidi.serendipity',
    hostEmail: 'wuyuke0406@gmail.com',
    guestName: 'Yuke Wu',
    remindersSent: null,
  }),
  booking({
    recordId: '1782609585065_rwo79u',
    startTime: '2026-06-30T16:30:42.186Z',
    endTime: '2026-06-30T16:45:42.186Z',
    hostName: 'evan chang',
    hostEmail: 'evch1204@gmail.com',
    guestName: 'evan chang',
    remindersSent: null,
  }),
]

describe('sendReminders — the first tick after the cron room is armed', () => {
  it('sends nothing against the real production rows: both bookings already started', async () => {
    const { ctx, emails, updates } = fakeCtx(PRODUCTION_BOOKINGS.map((b) => ({ ...b, data: { ...b.data } })))

    await sendReminders(ctx)

    expect(emails).toEqual([])
    expect(updates).toEqual([])
  })

  // The backlog case that would be a blast if the windows were "everything in
  // the future": a pile of confirmed bookings spread across the coming weeks.
  // Only the ones sitting inside a live window are allowed to produce mail.
  it('mails only the bookings inside a window, not every future booking', async () => {
    const rows = [
      bookingIn(0.5, { hostEmail: '1h-a@example.com' }), // inside the 1h window
      bookingIn(1.4, { hostEmail: '1h-b@example.com' }), // inside the 1h window
      bookingIn(2), // between windows
      bookingIn(12), // between windows
      bookingIn(24, { hostEmail: '24h@example.com' }), // inside the 24h window
      bookingIn(26), // not yet
      bookingIn(72), // not yet
      bookingIn(24 * 30), // not yet
    ]
    const { ctx, emails } = fakeCtx(rows)

    await sendReminders(ctx)

    expect(emails.map((e) => e.to).sort()).toEqual([
      '1h-a@example.com',
      '1h-b@example.com',
      '24h@example.com',
    ])
  })

  // The "cron was dead for two months" case. A booking whose 24h slot passed
  // during the outage does not get a late 24h reminder — missed is missed —
  // and a booking whose whole meeting passed gets nothing at all.
  it('does not replay slots missed while the cron was dead', async () => {
    const { ctx, emails } = fakeCtx([
      bookingIn(-1), // started an hour ago
      bookingIn(-24 * 60), // two months ago
      bookingIn(10), // its 24h slot passed during the outage
    ])

    await sendReminders(ctx)

    expect(emails).toEqual([])
  })

  it('ignores bookings that are not confirmed', async () => {
    const { ctx, emails } = fakeCtx([
      bookingIn(24, { status: 'cancelled' }),
      bookingIn(1, { status: 'no_show' }),
      bookingIn(24, { status: 'completed' }),
    ])

    await sendReminders(ctx)

    expect(emails).toEqual([])
  })

  it('survives a booking with an unparseable start time', async () => {
    const { ctx, emails } = fakeCtx([booking({ startTime: 'not a date', endTime: 'not a date' })])

    await sendReminders(ctx)

    expect(emails).toEqual([])
  })
})

describe('sendReminders — remindersSent is the idempotence marker', () => {
  // A booking spends about four 30-minute ticks inside the 2-hour 24h window.
  // Without the marker that is four identical emails to the same host.
  it('sends one 24h reminder across the ~4 ticks a booking spends in the window', async () => {
    const rows = [bookingIn(24.9)]
    const { ctx, emails } = fakeCtx(rows)

    for (let tick = 0; tick < 4; tick++) {
      await sendReminders(ctx)
      vi.setSystemTime(Date.now() + 30 * 60_000)
    }

    expect(emails).toHaveLength(1)
  })

  it('records the marker under the window key it just sent', async () => {
    const rows = [bookingIn(24)]
    const { ctx, updates } = fakeCtx(rows)

    await sendReminders(ctx)

    expect(updates).toEqual([
      { recordId: rows[0].recordId, data: { remindersSent: { '24h': true } } },
    ])
  })

  it('keeps the 24h marker when it later writes the 1h one', async () => {
    const rows = [bookingIn(24)]
    const { ctx, emails, updates } = fakeCtx(rows)

    await sendReminders(ctx)
    vi.setSystemTime(NOW + 23.5 * HOUR)
    await sendReminders(ctx)

    expect(emails).toHaveLength(2)
    expect(updates[1].data.remindersSent).toEqual({ '24h': true, '1h': true })
  })

  it('respects a marker already on the record', async () => {
    const { ctx, emails } = fakeCtx([
      bookingIn(24, { remindersSent: { '24h': true } }),
      bookingIn(1, { remindersSent: { '1h': true } }),
    ])

    await sendReminders(ctx)

    expect(emails).toEqual([])
  })

  // email/send answers 200 with an { error } body when the sender domain is
  // not verified. Marking that as sent would swallow the reminder forever, so
  // the marker is withheld and the next tick tries again.
  it('does not mark a soft-failed send, so the next tick retries', async () => {
    const rows = [bookingIn(24)]
    const { ctx, updates } = fakeCtx(rows, { emailFails: true })

    await sendReminders(ctx)

    expect(updates).toEqual([])
  })

  // No host email means there is nothing to retry. Treat it as handled so the
  // row does not get re-processed on every tick for the rest of the window.
  it('marks a booking with no host email as handled without sending', async () => {
    const rows = [bookingIn(24, { hostEmail: '' })]
    const { ctx, emails, updates } = fakeCtx(rows)

    await sendReminders(ctx)

    expect(emails).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0].data.remindersSent).toEqual({ '24h': true })
  })
})
