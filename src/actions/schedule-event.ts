/**
 * schedule-event — Book a meeting on a host's calendar.
 *
 * Single source of truth: the `bookings` collection in app:bookme.
 * Both the time-slot picker (frontend) and this action check the same
 * collection, so a slot that's visible to the guest is guaranteed bookable.
 *
 * Flow:
 *  1. Validate event type, availability, timeGap
 *  2. Check for conflicts against bookings collection
 *  3. Create booking record (authoritative)
 *  4. Create calendar events (host + optional guest)
 *  5. Send cross-app notifications (Slack channel + mail DM)
 */
import type { ActionHandler } from 'deepspace/worker'
import { createDirMailBookingNotification } from '../lib/dir-mail-booking-notify'
import { formatDualPartyTimeRangeForDm } from '../lib/email-datetime-format'
import { formatYmdInTimezone } from '../lib/zoned-time'
import { SCOPE_ID as APP_SCOPE } from '../constants'
import { buildConfirmedBookingSends } from '../lib/booking-email-templates'
import { sendTransactionalEmailBatch } from '../lib/booking-email-server'

type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
interface DayBlock { startTime: string; endTime: string }
interface DaySettings { isAvailable: boolean; blocks?: DayBlock[]; startTime?: string; endTime?: string }

const DAY_NAMES: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Convert a UTC Date to hours/minutes/dayOfWeek in a given IANA timezone. */
function getTimeInTimezone(date: Date, timezone: string): { hours: number; minutes: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date)
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hours, minutes, dayOfWeek: dayMap[weekday] ?? date.getUTCDay() }
}

async function hashCancelToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const scheduleEvent: ActionHandler = async (ctx) => {
  const {
    hostUserId,
    eventTypeId,
    startTime,
    guestEmail,
    guestName,
    hostName,
    hostEmail,
    description,
    guestUserId,
    meetingLink,
    seriesId,
    recurrence,
    additionalInfo,
    answers,
    guestTimezone: guestTimezoneParam,
    sendConfirmationEmail: sendConfirmationEmailParam,
  } = ctx.params as {
    hostUserId: string
    eventTypeId: string
    startTime: string
    guestEmail: string
    guestName: string
    /** Display name for the host (from booking UI — persisted for guests' Meetings view) */
    hostName?: string
    hostEmail?: string
    description?: string
    guestUserId?: string
    meetingLink?: string
    seriesId?: string
    recurrence?: string
    additionalInfo?: string
    answers?: Record<string, string | boolean>
    /** IANA timezone the guest used in the booking UI */
    guestTimezone?: string
    /**
     * When false, skip transactional `email/send` confirmation (e.g. recurring series after the first occurrence).
     * Default true.
     */
    sendConfirmationEmail?: boolean
  }

  const guestTimezone =
    typeof guestTimezoneParam === 'string' && guestTimezoneParam.trim().length > 0
      ? guestTimezoneParam.trim()
      : ''

  const hostDisplayName = typeof hostName === 'string' ? hostName.trim() : ''
  const hostDisplayEmail = typeof hostEmail === 'string' ? hostEmail.trim() : ''

  console.log('[schedule-event] Called with:', { hostUserId, eventTypeId, startTime, guestEmail, guestName, guestUserId })
  console.log('[schedule-event] Auth userId:', ctx.userId)

  if (!hostUserId || !eventTypeId || !startTime || !guestEmail || !guestName) {
    console.log('[schedule-event] Missing required fields:', { hostUserId: !!hostUserId, eventTypeId: !!eventTypeId, startTime: !!startTime, guestEmail: !!guestEmail, guestName: !!guestName })
    return { success: false, error: 'Missing required fields' }
  }

  // 1. Validate event type exists and is active
  console.log('[schedule-event] Step 1: Fetching event type', eventTypeId, 'from', APP_SCOPE)
  const eventTypeResult = await ctx.tools.get(APP_SCOPE, 'event-types', eventTypeId)
  console.log('[schedule-event] Event type result:', JSON.stringify(eventTypeResult).slice(0, 500))
  if (!eventTypeResult.success) {
    return { success: false, error: 'Event type not found' }
  }
  const etData = (eventTypeResult.data as { record: { data: Record<string, unknown> } }).record.data
  if (!etData.isActive) {
    return { success: false, error: 'Event type is not active' }
  }
  if (etData.userId !== hostUserId) {
    return { success: false, error: 'Event type does not belong to this host' }
  }
  const duration = etData.duration as number
  const eventTitle = etData.title as string
  const sendDeepSpaceMail = (etData.sendDeepSpaceMail as boolean) ?? false
  const sendGoogleCalendarInvite = (etData.sendGcalInvite as boolean) ?? false
  const sendExternalEmail = (etData.sendExternalEmail as boolean) ?? true
  const bufferBefore = (etData.bufferBefore as number) ?? 0
  const bufferAfter = (etData.bufferAfter as number) ?? 0

  // 2. Compute endTime from event type duration
  const start = new Date(startTime)
  if (isNaN(start.getTime())) {
    return { success: false, error: 'Invalid startTime' }
  }
  const end = new Date(start.getTime() + duration * 60_000)

  // 3. Validate start is in the future
  const now = new Date()
  if (start <= now) {
    return { success: false, error: 'Cannot book a time in the past' }
  }

  // 4. Load host availability
  console.log('[schedule-event] Step 4: Querying availability for hostUserId:', hostUserId)
  const availResult = await ctx.tools.query(APP_SCOPE, 'availability', {
    where: { userId: hostUserId },
    limit: 1,
  })
  console.log('[schedule-event] Availability query result:', JSON.stringify(availResult).slice(0, 500))
  const availRecords = (availResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
  console.log('[schedule-event] Availability records count:', availRecords.length)
  if (availRecords.length === 0) {
    // Also try querying ALL availability records for debugging
    const allAvailResult = await ctx.tools.query(APP_SCOPE, 'availability', {})
    const allAvailRecords = (allAvailResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
    console.log('[schedule-event] ALL availability records:', allAvailRecords.length, allAvailRecords.map(r => ({ userId: r.data.userId })))
    return { success: false, error: 'Host has not configured availability' }
  }
  const avail = availRecords[0].data
  console.log('[schedule-event] Host availability found, timezone:', avail.timezone)

  // Convert slot times to the host's configured timezone for availability check.
  // Availability windows (e.g. 09:00-17:00) are in the host's local timezone.
  // The incoming startTime is UTC (ISO string), so we convert to the host's tz.
  const hostTimezone = (avail.timezone as string) || 'UTC'
  const slotLocal = getTimeInTimezone(start, hostTimezone)
  const endLocal = getTimeInTimezone(end, hostTimezone)

  const dayName = DAY_NAMES[slotLocal.dayOfWeek]
  const daySettings = avail[dayName] as DaySettings | undefined
  if (!daySettings?.isAvailable) {
    return { success: false, error: `Host is not available on ${dayName}` }
  }

  // Normalize legacy single-block format to blocks array
  const blocks: DayBlock[] = Array.isArray(daySettings.blocks) && daySettings.blocks.length > 0
    ? daySettings.blocks
    : [{ startTime: daySettings.startTime ?? '09:00', endTime: daySettings.endTime ?? '17:00' }]

  // Check time falls within any availability block (in host's timezone)
  const slotStartMins = slotLocal.hours * 60 + slotLocal.minutes
  const slotEndMins = endLocal.hours * 60 + endLocal.minutes
  const inSomeBlock = blocks.some(b => {
    const availStart = parseTimeToMinutes(b.startTime)
    const availEnd = parseTimeToMinutes(b.endTime)
    return slotStartMins >= availStart && slotEndMins <= availEnd
  })
  if (!inSomeBlock) {
    return { success: false, error: 'Requested time is outside availability window' }
  }

  // Check timeGap (minimum minutes before booking)
  const timeGap = (avail.timeGap as number) ?? 0
  const minsUntilSlot = (start.getTime() - now.getTime()) / 60_000
  if (minsUntilSlot < timeGap) {
    return { success: false, error: `Must book at least ${timeGap} minutes in advance` }
  }

  // 5. Check for conflicts against bookings collection (same source the UI uses)
  console.log('[schedule-event] Step 5: Checking conflicts for hostUserId:', hostUserId)
  const bookingsResult = await ctx.tools.query(APP_SCOPE, 'bookings', {
    where: { hostUserId },
  })
  console.log('[schedule-event] Existing bookings:', ((bookingsResult.data as any)?.records ?? []).length)
  const existingBookings = (bookingsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []

  // Check max bookings per day
  const maxPerDay = (avail.maxBookingsPerDay as number) ?? 0
  if (maxPerDay > 0) {
    const startDayYmd = formatYmdInTimezone(start, hostTimezone)
    const sameDayBookings = existingBookings.filter((b) => {
      if (b.data.status === 'cancelled' || b.data.status === 'no_show') return false
      const bStart = new Date(b.data.startTime as string)
      return formatYmdInTimezone(bStart, hostTimezone) === startDayYmd
    })
    if (sameDayBookings.length >= maxPerDay) {
      return { success: false, error: 'Maximum bookings for this day has been reached' }
    }
  }

  // Check for conflicts (expanded by buffer times)
  const bufferedStart = new Date(start.getTime() - bufferBefore * 60_000)
  const bufferedEnd = new Date(end.getTime() + bufferAfter * 60_000)
  const hasConflict = existingBookings.some((b) => {
    if (b.data.status === 'cancelled' || b.data.status === 'no_show') return false
    const bStart = new Date(b.data.startTime as string)
    const bEnd = new Date(b.data.endTime as string)
    return bufferedStart < bEnd && bufferedEnd > bStart
  })
  if (hasConflict) {
    return { success: false, error: 'Time slot conflicts with an existing booking' }
  }

  // 5b. Check for conflicts against host's calendar events
  try {
    const calEventsResult = await ctx.tools.query(`user:${hostUserId}`, 'events', {})
    const calEvents = (calEventsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
    const hasCalendarConflict = calEvents.some((ev) => {
      if (ev.data.AllDay === 1) return false
      const evStart = new Date(ev.data.StartTime as string)
      const evEnd = new Date(ev.data.EndTime as string)
      if (isNaN(evStart.getTime()) || isNaN(evEnd.getTime())) return false
      return start < evEnd && end > evStart
    })
    if (hasCalendarConflict) {
      return { success: false, error: 'Time slot conflicts with an existing calendar event' }
    }
  } catch (err) {
    console.warn('[schedule-event] Failed to check calendar conflicts:', err)
  }

  // 5c. Check for conflicts against host's Google Calendar (FreeBusy)
  try {
    const dayStart = new Date(start)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(start)
    dayEnd.setUTCHours(23, 59, 59, 999)

    const fbRaw = await ctx.tools.integration('booking-host-freebusy', {
      hostClerkUserId: hostUserId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
    })
    const fbPayload = (fbRaw.data ?? fbRaw) as {
      busyTimes?: Array<{ start: string; end: string }>
    }
    if (fbRaw.success && Array.isArray(fbPayload.busyTimes)) {
      const hasGoogleConflict = fbPayload.busyTimes.some(b => {
        const bStart = new Date(b.start)
        const bEnd = new Date(b.end)
        return start < bEnd && end > bStart
      })
      if (hasGoogleConflict) {
        return { success: false, error: 'Time slot conflicts with an existing calendar event' }
      }
    }
  } catch (err) {
    console.warn('[schedule-event] Google FreeBusy conflict check failed:', err)
  }

  // Check date-specific overrides
  const overridesResult = await ctx.tools.query(APP_SCOPE, 'availability-overrides', {
    where: { userId: hostUserId },
  })
  const overrideRecords = (overridesResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
  const slotDateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const dateOverride = overrideRecords.find(o => o.data.date === slotDateStr)
  if (dateOverride) {
    if (dateOverride.data.type === 'blocked') {
      return { success: false, error: 'Host is not available on this date (date override)' }
    }
    if (dateOverride.data.type === 'custom' && dateOverride.data.startTime && dateOverride.data.endTime) {
      const overrideStart = parseTimeToMinutes(dateOverride.data.startTime as string)
      const overrideEnd = parseTimeToMinutes(dateOverride.data.endTime as string)
      if (slotStartMins < overrideStart || slotEndMins > overrideEnd) {
        return { success: false, error: 'Requested time is outside availability window for this date' }
      }
    }
  }

  // 6. Create booking record in app:bookme (authoritative — drives conflict detection + slot picker)
  console.log('[schedule-event] Step 6: Creating booking record')
  const cancelToken = crypto.randomUUID()
  const cancelTokenHash = await hashCancelToken(cancelToken)
  const bookingResult = await ctx.tools.create(APP_SCOPE, 'bookings', {
    eventTypeId,
    eventTitle,
    hostUserId,
    hostName: hostDisplayName,
    hostEmail: hostDisplayEmail,
    guestName,
    guestEmail,
    guestUserId: guestUserId ?? '',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    meetingLink: meetingLink ?? '',
    cancelToken: cancelTokenHash,
    status: 'confirmed',
    seriesId: seriesId ?? '',
    recurrence: recurrence ?? '',
    additionalInfo: additionalInfo ?? '',
    answers: answers ?? {},
    ...(guestTimezone ? { guestTimezone } : {}),
    hostTimezone,
  })
  console.log('[schedule-event] Booking result:', JSON.stringify(bookingResult).slice(0, 300))
  if (!bookingResult.success) {
    return { success: false, error: 'Failed to create booking record' }
  }

  // 7. Create calendar event in host's user DO
  console.log('[schedule-event] Step 7: Creating calendar event in user:', hostUserId)
  const calendarResult = await ctx.tools.create(`user:${hostUserId}`, 'events', {
    Title: `${eventTitle} with ${guestName}`,
    Description: description ?? '',
    StartTime: start.toISOString(),
    EndTime: end.toISOString(),
    AllDay: 0,
    Visibility: 'shared',
    SourceRef: 'book-me:booking',
    Metadata: JSON.stringify({
      guestEmail,
      guestName,
      bookedBy: ctx.userId,
      eventTypeId,
    }),
  })

  console.log('[schedule-event] Calendar result:', JSON.stringify(calendarResult).slice(0, 300))
  if (!calendarResult.success) {
    console.error('[schedule-event] Calendar event creation FAILED:', calendarResult)
    return calendarResult
  }

  // 7a. Store the host calendar event ID back into the booking so reschedule can update it later
  const hostCalendarEventRecordId = (calendarResult.data as { record?: { recordId: string } })?.record?.recordId
  const bookingRecordId = (bookingResult.data as { recordId?: string })?.recordId
  if (hostCalendarEventRecordId && bookingRecordId) {
    try {
      await ctx.tools.update(APP_SCOPE, 'bookings', bookingRecordId, {
        eventTypeId,
        eventTitle,
        hostUserId,
        hostName: hostDisplayName,
        hostEmail: hostDisplayEmail,
        guestName,
        guestEmail,
        guestUserId: guestUserId ?? '',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        meetingLink: meetingLink ?? '',
        cancelToken: cancelTokenHash,
        status: 'confirmed',
        seriesId: seriesId ?? '',
        recurrence: recurrence ?? '',
        additionalInfo: additionalInfo ?? '',
        answers: answers ?? {},
        calendarEventId: hostCalendarEventRecordId,
        ...(guestTimezone ? { guestTimezone } : {}),
        hostTimezone,
      })
    } catch (err) {
      console.warn('[schedule-event] Failed to store calendarEventId in booking:', err)
    }
  }

  // 7b. If guestUserId provided, create a calendar event in guest's user DO
  if (guestUserId) {
    try {
      await ctx.tools.create(`user:${guestUserId}`, 'events', {
        Title: `${eventTitle} (booked)`,
        Description: description ?? '',
        StartTime: start.toISOString(),
        EndTime: end.toISOString(),
        AllDay: 0,
        Visibility: 'shared',
        SourceRef: 'book-me:guest-booking',
        Metadata: JSON.stringify({
          hostUserId,
          guestEmail,
          guestName,
          eventTypeId,
        }),
      })
    } catch (err) {
      console.warn('[schedule-event] Failed to create guest calendar event:', err)
    }
  }

  // 8. Send cross-app notifications via dir DOs
  const guestTzForMail = guestTimezone || hostTimezone
  const notificationBody = [
    `📅 New booking: ${eventTitle}`,
    `Guest: ${guestName} (${guestEmail})`,
    '',
    formatDualPartyTimeRangeForDm(start.toISOString(), end.toISOString(), guestTzForMail, hostTimezone),
  ].join('\n')

  const slackDirScope = 'dir:teams'
  const slackChannelQuery = await ctx.tools.query(slackDirScope, 'conversations', {
    where: { Name: 'bookings' },
    limit: 1,
  })
  const slackChannels = (slackChannelQuery.data as { records?: Array<{ recordId: string }> })?.records ?? []
  let slackChannelId: string | undefined = slackChannels[0]?.recordId

  if (!slackChannelId) {
    const createResult = await ctx.tools.create(slackDirScope, 'conversations', {
      Name: 'bookings',
      Description: 'Booking notifications from BookMe',
      Type: 'public',
      Visibility: 'public',
      CreatedBy: ctx.userId,
      ParticipantHash: '',
      ParticipantIds: '',
      Status: 'active',
      AssigneeId: '',
      LinkedRef: '',
      LastMessageAt: new Date().toISOString(),
      LastMessagePreview: notificationBody.slice(0, 100),
      LastMessageAuthor: ctx.userId,
    })
    slackChannelId = (createResult.data as { recordId?: string })?.recordId
  }

  if (slackChannelId) {
    await ctx.tools.create(`conv:${slackChannelId}`, 'conv_messages', {
      Content: notificationBody,
      AuthorId: ctx.userId,
      ParentId: '',
      Edited: 0,
      MessageType: 'system',
      Metadata: JSON.stringify({ source: 'book-me', eventTypeId }),
    })
    await ctx.tools.update(slackDirScope, 'conversations', slackChannelId, {
      LastMessageAt: new Date().toISOString(),
      LastMessagePreview: notificationBody.slice(0, 100),
      LastMessageAuthor: ctx.userId,
    })
  }

  // DeepSpace Mail (dir:mail) — only when sendDeepSpaceMail (see lib/dir-mail-booking-notify.ts).
  await createDirMailBookingNotification(ctx, {
    sendDeepSpaceMail,
    eventTypeId,
    participantHash: `booking-${eventTypeId}-${start.toISOString()}`,
    conversationTitle: `Booking Confirmed: ${eventTitle}`,
    messageBody: notificationBody,
    guestName,
    hostUserId,
    guestUserId,
  })

  const sendThisConfirmation = sendConfirmationEmailParam !== false
  if (sendExternalEmail && sendThisConfirmation) {
    try {
      let extra = typeof additionalInfo === 'string' ? additionalInfo : ''
      if (recurrence && recurrence !== 'none') {
        extra = extra ? `${extra}\n\n` : ''
        extra += `This is a recurring ${recurrence} meeting.`
      }
      const sends = buildConfirmedBookingSends({
        hostName: hostDisplayName || 'Host',
        hostEmail: hostDisplayEmail,
        guestName,
        guestEmail,
        eventTitle,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        meetingLink: meetingLink ?? '',
        additionalInfo: extra || undefined,
        guestTimezone,
        hostTimezone,
      })
      const emailResult = await sendTransactionalEmailBatch(ctx.tools, sends)
      if (!emailResult.ok) {
        console.warn('[schedule-event] email/send:', emailResult.errors.join('; '))
      }
    } catch (err) {
      console.warn('[schedule-event] transactional email failed:', err)
    }
  }

  const calendarData = calendarResult.data as { record?: { recordId: string } } | undefined
  const bookingData = bookingResult.data as { recordId?: string } | undefined
  return {
    success: true,
    data: {
      record: calendarData?.record,
      bookingId: bookingData?.recordId,
      cancelToken,
      eventType: { sendDeepSpaceMail, sendExternalEmail, sendGoogleCalendarInvite },
    },
  }
}
