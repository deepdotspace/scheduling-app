/**
 * Cron Handler — BookMe
 *
 * Sends reminder notifications for upcoming bookings.
 * Runs every 30 minutes. Sends reminders at:
 *   - 24 hours before the meeting
 *   - 1 hour before the meeting
 *
 * Uses remindersSent (object) on booking records for deduplication:
 *   { "24h": true, "1h": true }
 */
import type { CronContext, CronTask } from 'deepspace/worker'
import { buildReminderEmailSend } from './lib/booking-email-templates'

/**
 * Task schedule, read by {@link AppCronRoom} at construction time (deepspace
 * 0.4.3 cron model — config lives in code, not cron.json). The DO validates
 * these and self-schedules alarms; each fire dispatches through {@link handler}.
 */
export const tasks: CronTask[] = [{ name: 'send-reminders', intervalMinutes: 30 }]

export async function handler(taskName: string, ctx: CronContext): Promise<void> {
  switch (taskName) {
    case 'send-reminders':
      await sendReminders(ctx)
      break
  }
}

/**
 * Sweep every confirmed booking and mail the host the reminders that are due
 * right now. Exported so the first-tick blast radius is pinned by unit tests
 * (src/cron.test.ts) rather than argued about.
 *
 * Three independent guards keep this bounded, and all three matter most on the
 * FIRST tick after the cron room is armed, when every booking is being looked
 * at for the first time:
 *
 *  1. A booking that already started is skipped outright (`startTime <= now`).
 *     Reminders for meetings that happened while the cron was dead are missed,
 *     not replayed — nobody wants "your meeting starts in 1 hour" for last June.
 *  2. The windows are absolute and narrow (23 < h <= 25, and 0 < h <= 1.5), not
 *     "everything still in the future". A booking three days out gets nothing;
 *     a booking ten hours out has already missed its 24h slot and only gets the
 *     1h one. So an outage cannot pile every future booking into one tick.
 *  3. `remindersSent` is the idempotence marker, and it is written only after a
 *     send actually succeeds, so a transient email failure retries on the next
 *     tick while a success is never repeated across the ~4 ticks a booking
 *     spends inside a window.
 */
export async function sendReminders(ctx: CronContext): Promise<void> {
  const now = Date.now()
  const bookings = await ctx.records.query('bookings', {
    where: { status: 'confirmed' },
  }) as Array<{ recordId: string; data: Record<string, unknown> }>

  for (const booking of bookings) {
    // records.query returns { recordId, data: {...fields} } — booking fields live under .data.
    const recordId = booking.recordId
    const data = booking.data
    if (!data) continue

    const startTime = new Date(data.startTime as string).getTime()
    if (isNaN(startTime) || startTime <= now) continue

    const hoursUntil = (startTime - now) / (60 * 60 * 1000)
    const remindersSent = (data.remindersSent as Record<string, boolean>) ?? {}

    // 24h reminder: send when ~23-25 hours away (matches the 30-min cron cadence).
    // Only mark as sent when delivery actually succeeded, so a transient failure retries next tick.
    if (hoursUntil <= 25 && hoursUntil > 23 && !remindersSent['24h']) {
      if (await sendReminderNotification(ctx, data, '24h')) {
        await ctx.records.update('bookings', recordId, {
          remindersSent: { ...remindersSent, '24h': true },
        })
      }
    }

    // 1h reminder: send when 0-1.5 hours away.
    if (hoursUntil <= 1.5 && hoursUntil > 0 && !remindersSent['1h']) {
      if (await sendReminderNotification(ctx, data, '1h')) {
        await ctx.records.update('bookings', recordId, {
          remindersSent: { ...remindersSent, '1h': true },
        })
      }
    }
  }
}

/** Returns true when the reminder is considered handled (sent, or nothing to send). */
async function sendReminderNotification(
  ctx: CronContext,
  booking: Record<string, unknown>,
  window: '24h' | '1h',
): Promise<boolean> {
  // CronContext.records is bound to a single room (app:{name}) and cannot reach the dir:mail /
  // conv:* scopes, so the previous in-app DM write always threw. Deliver the reminder by email
  // to the host via the owner-billed email/send integration instead.
  const hostEmail = (booking.hostEmail as string) ?? ''
  const send = buildReminderEmailSend({
    window,
    hostName: (booking.hostName as string) ?? '',
    hostEmail,
    guestName: (booking.guestName as string) ?? '',
    eventTitle: (booking.eventTitle as string) ?? 'Meeting',
    startTime: booking.startTime as string,
    endTime: (booking.endTime as string) ?? (booking.startTime as string),
    meetingLink: (booking.meetingLink as string) ?? '',
    hostTimezone:
      typeof booking.hostTimezone === 'string' && booking.hostTimezone.trim().length > 0
        ? booking.hostTimezone.trim()
        : 'UTC',
  })
  // No host email to remind — nothing to retry; treat as handled so we don't reprocess every tick.
  if (!send) return true

  try {
    const res = await ctx.integrations.call('email/send', {
      to: send.to,
      subject: send.subject,
      html: send.html,
    })
    // email/send can return HTTP-success with a soft error in the body (mirrors booking-email-server).
    if (res && typeof res === 'object' && (res as { error?: unknown }).error) {
      console.warn(`[cron:send-reminders] ${window} reminder email/send returned error:`, (res as { error?: unknown }).error)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[cron:send-reminders] Failed to send ${window} reminder:`, err)
    return false
  }
}
