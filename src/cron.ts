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
import type { CronContext } from 'deepspace/worker'
import { formatEmailDateAndTimeRange } from './lib/email-datetime-format'

export async function handler(taskName: string, ctx: CronContext): Promise<void> {
  switch (taskName) {
    case 'send-reminders':
      await sendReminders(ctx)
      break
  }
}

async function sendReminders(ctx: CronContext): Promise<void> {
  const now = Date.now()
  const bookings = await ctx.records.query('bookings', {
    where: { status: 'confirmed' },
  })

  for (const booking of bookings) {
    const startTime = new Date(booking.startTime as string).getTime()
    if (isNaN(startTime) || startTime <= now) continue

    const hoursUntil = (startTime - now) / (60 * 60 * 1000)
    const remindersSent = (booking.remindersSent as Record<string, boolean>) ?? {}

    // 24h reminder: send when 23-25 hours away
    if (hoursUntil <= 25 && hoursUntil > 1.5 && !remindersSent['24h']) {
      await sendReminderNotification(ctx, booking, '24h')
      await ctx.records.update('bookings', booking.recordId as string, {
        remindersSent: { ...remindersSent, '24h': true },
      })
    }

    // 1h reminder: send when 0.5-1.5 hours away
    if (hoursUntil <= 1.5 && hoursUntil > 0 && !remindersSent['1h']) {
      await sendReminderNotification(ctx, booking, '1h')
      await ctx.records.update('bookings', booking.recordId as string, {
        remindersSent: { ...remindersSent, '1h': true },
      })
    }
  }
}

async function sendReminderNotification(
  ctx: CronContext,
  booking: Record<string, unknown>,
  window: '24h' | '1h',
): Promise<void> {
  const timeLabel = window === '24h' ? 'tomorrow' : 'in 1 hour'
  const eventTitle = booking.eventTitle as string
  const guestName = booking.guestName as string
  const hostUserId = booking.hostUserId as string
  const meetingLink = (booking.meetingLink as string) ?? ''

  const startIso = booking.startTime as string
  const endIso = (booking.endTime as string) ?? startIso
  const hostTz =
    typeof booking.hostTimezone === 'string' && booking.hostTimezone.trim().length > 0
      ? booking.hostTimezone.trim()
      : 'UTC'
  const slot = formatEmailDateAndTimeRange(startIso, endIso, hostTz)
  const whenLines = [`Date: ${slot.dateLine}`, `Time: ${slot.timeLine}`].join('\n')

  // Send DM notification to host via deepspace-mail directory
  const mailDirScope = 'dir:mail'
  const reminderBody = `Reminder: ${eventTitle} with ${guestName} is ${timeLabel}\n${whenLines}\n${meetingLink ? `Join: ${meetingLink}` : ''}`

  try {
    const mailResult = await ctx.records.create(mailDirScope + '/conversations', {
      Name: `Reminder: ${eventTitle} ${timeLabel}`,
      Description: guestName,
      Type: 'dm',
      Visibility: 'private',
      CreatedBy: ctx.ownerUserId,
      ParticipantHash: `reminder-${booking.recordId}-${window}`,
      ParticipantIds: JSON.stringify([hostUserId]),
      Status: 'active',
      AssigneeId: '',
      LinkedRef: '',
      LastMessageAt: new Date().toISOString(),
      LastMessagePreview: reminderBody.slice(0, 100),
      LastMessageAuthor: ctx.ownerUserId,
    })

    const convId = (mailResult as any)?.recordId
    if (convId) {
      await ctx.records.create(`conv:${convId}/conv_messages`, {
        Content: reminderBody,
        AuthorId: ctx.ownerUserId,
        ParentId: '',
        Edited: 0,
        MessageType: 'system',
        Metadata: JSON.stringify({ source: 'book-me', type: 'reminder', window }),
      })
    }
  } catch (err) {
    console.warn(`[cron:send-reminders] Failed to send ${window} reminder for booking ${booking.recordId}:`, err)
  }
}
