/**
 * reschedule-booking — Reschedule a booking to a new time.
 *
 * Cancels the old booking and creates a new one at the specified time.
 * Validates the new time against availability and conflicts.
 */
import type { ActionHandler } from '../lib/action-types'
import { createDirMailBookingNotification, getSendDeepSpaceMailFromEventTypeData, getSendExternalEmailFromEventTypeData } from '../lib/dir-mail-booking-notify'
import { SCOPE_ID as APP_SCOPE } from '../constants'
import { buildRescheduleEmailSend } from '../lib/booking-email-templates'
import { sendTransactionalEmail } from '../lib/booking-email-server'
import { validateHostAvailability } from './validate-availability'

async function hashCancelToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const rescheduleBooking: ActionHandler = async (ctx) => {
  const { bookingId, cancelToken, newStartTime, rescheduleEmail, reasonForChange } = ctx.params as {
    bookingId: string
    cancelToken?: string
    newStartTime: string
    /** Email of the person requesting the reschedule (stored for audit) */
    rescheduleEmail?: string
    /** Reason provided for the reschedule (stored for audit) */
    reasonForChange?: string
  }

  if (!bookingId || !newStartTime) {
    return { success: false, error: 'Missing required fields' }
  }

  // Fetch the booking
  const result = await ctx.tools.get(APP_SCOPE, 'bookings', bookingId)
  if (!result.success) {
    return { success: false, error: 'Booking not found' }
  }

  const booking = (result.data as { record: { data: Record<string, unknown> } }).record.data

  if (booking.status === 'cancelled') {
    return { success: false, error: 'Cannot reschedule a cancelled booking' }
  }

  if (booking.status === 'no_show') {
    return { success: false, error: 'Cannot reschedule a no-show booking' }
  }

  // Authorization. Guard against an empty ctx.userId (the guest-token dispatch path passes userId='')
  // matching an empty stored id: anonymous bookings persist guestUserId='' (and a host id is never
  // empty), so without this `'' === ''` would make isGuest true and skip the cancelToken check entirely.
  const isHost = ctx.userId !== '' && ctx.userId === booking.hostUserId
  const isGuest = ctx.userId !== '' && ctx.userId === booking.guestUserId
  const hasValidToken = cancelToken && (await hashCancelToken(cancelToken)) === booking.cancelToken

  if (!isHost && !isGuest && !hasValidToken) {
    return { success: false, error: 'Not authorized to reschedule this booking' }
  }

  // Fetch event type for duration
  const etResult = await ctx.tools.get(APP_SCOPE, 'event-types', booking.eventTypeId as string)
  if (!etResult.success) {
    return { success: false, error: 'Event type not found' }
  }
  const etData = (etResult.data as { record: { data: Record<string, unknown> } }).record.data
  // Preserve the booking's actual length (a guest may have booked a non-default duration on a
  // multi-duration event type); recomputing from etData.duration would silently resize the meeting.
  // Fall back to the event type's base duration only if the stored times are unusable.
  const bookedDurationMs = new Date(booking.endTime as string).getTime() - new Date(booking.startTime as string).getTime()
  const duration =
    Number.isFinite(bookedDurationMs) && bookedDurationMs > 0
      ? bookedDurationMs / 60_000
      : (etData.duration as number)
  const sendDeepSpaceMail = getSendDeepSpaceMailFromEventTypeData(etData)
  const sendExternalEmail = getSendExternalEmailFromEventTypeData(etData)
  // maxAttendees > 1 marks a group event: co-attendees may share a slot up to capacity.
  const maxAttendees = (etData.maxAttendees as number) ?? 0
  const isGroupEvent = maxAttendees > 1

  const newStart = new Date(newStartTime)
  if (isNaN(newStart.getTime())) {
    return { success: false, error: 'Invalid newStartTime' }
  }
  const newEnd = new Date(newStart.getTime() + duration * 60_000)

  // Validate time is in the future
  if (newStart <= new Date()) {
    return { success: false, error: 'Cannot reschedule to a past time' }
  }

  // Check for conflicts (excluding the current booking)
  const bookingsResult = await ctx.tools.query(APP_SCOPE, 'bookings', {
    where: { hostUserId: booking.hostUserId },
  })
  const existingBookings = (bookingsResult.data as { records?: Array<{ recordId: string; data: Record<string, unknown> }> })?.records ?? []

  // Server-side availability enforcement for guest-initiated reschedules (parity with schedule-event
  // via the shared helper). The public reschedule path is authorized by a guest cancelToken, so the
  // client slot filter is not a real guard — without this a guest could move a meeting outside the
  // host's availability/overrides, past the per-day cap, or inside the timeGap horizon.
  // A host authenticated via JWT may reschedule their own meeting freely (Calendly-style: hosts move
  // bookings to any future, conflict-free time regardless of their published windows), so the
  // availability/timeGap gate is skipped for them and enforced only on the guest/token paths. Exclude
  // this booking from the per-day count (it is being moved, not added).
  if (!isHost) {
    const availabilityCheck = await validateHostAvailability(ctx.tools, {
      hostUserId: booking.hostUserId as string,
      start: newStart,
      end: newEnd,
      existingBookings,
      excludeBookingId: bookingId,
      availabilityScheduleId: typeof etData.availabilityScheduleId === 'string' ? etData.availabilityScheduleId : undefined,
    })
    if (!availabilityCheck.ok) {
      return { success: false, error: availabilityCheck.error }
    }
  }

  const overlappingOthers = existingBookings.filter((b) => {
    if (b.data.status === 'cancelled' || b.data.status === 'no_show') return false
    if (b.recordId === bookingId) return false // Exclude self
    const bStart = new Date(b.data.startTime as string)
    const bEnd = new Date(b.data.endTime as string)
    return newStart < bEnd && newEnd > bStart
  })
  // Group events allow co-attendees up to capacity (the current booking is already excluded above),
  // so the new slot is full only when the OTHER attendees already fill it.
  const hasConflict = isGroupEvent
    ? overlappingOthers.length >= maxAttendees
    : overlappingOthers.length > 0

  if (hasConflict) {
    return {
      success: false,
      error: isGroupEvent ? 'This group session is full' : 'New time conflicts with an existing booking',
    }
  }

  // Check for conflicts against host's DeepSpace calendar events (parity with schedule-event)
  const hostUserId = booking.hostUserId as string
  try {
    const calEventsResult = await ctx.tools.query(`user:${hostUserId}`, 'events', {})
    const calEvents = (calEventsResult.data as { records?: Array<{ recordId: string; data: Record<string, unknown> }> })?.records ?? []
    const currentCalendarEventId = booking.calendarEventId as string | undefined
    const hasCalendarConflict = calEvents.some((ev) => {
      if (ev.data.AllDay === 1) return false
      // Exclude the booking's own host calendar event from conflict detection
      if (currentCalendarEventId && ev.recordId === currentCalendarEventId) return false
      // Skip the app's own booking mirrors — the bookings collection is authoritative and counting
      // them here would block group-event co-attendees.
      const sourceRef = ev.data.SourceRef as string | undefined
      if (sourceRef === 'book-me:booking' || sourceRef === 'book-me:guest-booking') return false
      const evStart = new Date(ev.data.StartTime as string)
      const evEnd = new Date(ev.data.EndTime as string)
      if (isNaN(evStart.getTime()) || isNaN(evEnd.getTime())) return false
      return newStart < evEnd && newEnd > evStart
    })
    if (hasCalendarConflict) {
      return { success: false, error: 'New time conflicts with an existing calendar event' }
    }
  } catch (err) {
    console.warn('[reschedule-booking] Failed to check DeepSpace calendar conflicts:', err)
  }

  // Check for conflicts against host's Google Calendar (FreeBusy)
  try {
    const dayStart = new Date(newStart)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(newStart)
    dayEnd.setUTCHours(23, 59, 59, 999)

    const fbRaw = await ctx.tools.integration('booking-host-freebusy', {
      hostClerkUserId: hostUserId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
    })
    const fbPayload = (fbRaw.data ?? fbRaw) as { busyTimes?: Array<{ start: string; end: string }> }
    if (fbRaw.success && Array.isArray(fbPayload.busyTimes)) {
      const hasGoogleConflict = fbPayload.busyTimes.some(b => {
        const bStart = new Date(b.start)
        const bEnd = new Date(b.end)
        return newStart < bEnd && newEnd > bStart
      })
      if (hasGoogleConflict) {
        return { success: false, error: 'New time conflicts with an existing calendar event' }
      }
    }
  } catch (err) {
    console.warn('[reschedule-booking] Google FreeBusy conflict check failed:', err)
  }

  // Persist audit fields as explicit strings so they are never dropped by merge/JSON edge cases
  const auditEmail = typeof rescheduleEmail === 'string' ? rescheduleEmail.trim() : ''
  const auditReason = typeof reasonForChange === 'string' ? reasonForChange.trim() : ''

  // Capture old times and linked IDs before overwriting the booking
  const oldStartTime = booking.startTime as string
  const oldEndTime = booking.endTime as string
  const calendarEventId = booking.calendarEventId as string | undefined
  const guestUserId = booking.guestUserId as string | undefined

  // Update the booking with the new time and audit fields (always set so client sync shows them)
  const updateResult = await ctx.tools.update(APP_SCOPE, 'bookings', bookingId, {
    ...booking,
    startTime: newStart.toISOString(),
    endTime: newEnd.toISOString(),
    rescheduleEmail: auditEmail,
    reasonForChange: auditReason,
    // Re-arm reminders for the new time: the cron job only sends when the window flag is unset, so a
    // reminder that already fired for the original slot would otherwise suppress the new one.
    remindersSent: {},
  })

  if (!updateResult.success) {
    return { success: false, error: 'Failed to reschedule booking' }
  }

  // Update the host's calendar event to reflect the new time.
  // Fetch the existing event first to avoid clobbering non-time fields.
  if (calendarEventId) {
    try {
      const hostEventResult = await ctx.tools.get(`user:${hostUserId}`, 'events', calendarEventId)
      if (hostEventResult.success) {
        const existingData = (hostEventResult.data as { record: { data: Record<string, unknown> } }).record.data
        await ctx.tools.update(`user:${hostUserId}`, 'events', calendarEventId, {
          ...existingData,
          StartTime: newStart.toISOString(),
          EndTime: newEnd.toISOString(),
        })
      }
    } catch (err) {
      console.warn('[reschedule-booking] Failed to update host calendar event by ID:', err)
    }
  } else {
    // Fallback for bookings created before calendarEventId was persisted: find by SourceRef + old start time
    try {
      const eventsResult = await ctx.tools.query(`user:${hostUserId}`, 'events', {})
      const eventRecords = (eventsResult.data as { records?: Array<{ recordId: string; data: Record<string, unknown> }> })?.records ?? []
      const matchingEvent = eventRecords.find(
        (ev) => ev.data.SourceRef === 'book-me:booking' && ev.data.StartTime === oldStartTime
      )
      if (matchingEvent) {
        await ctx.tools.update(`user:${hostUserId}`, 'events', matchingEvent.recordId, {
          ...matchingEvent.data,
          StartTime: newStart.toISOString(),
          EndTime: newEnd.toISOString(),
        })
      }
    } catch (err) {
      console.warn('[reschedule-booking] Failed to find/update host calendar event by query:', err)
    }
  }

  // Update the guest's calendar event if they are a platform user
  if (guestUserId) {
    try {
      const guestEventsResult = await ctx.tools.query(`user:${guestUserId}`, 'events', {})
      const guestEventRecords = (guestEventsResult.data as { records?: Array<{ recordId: string; data: Record<string, unknown> }> })?.records ?? []
      const matchingGuestEvent = guestEventRecords.find(
        (ev) => ev.data.SourceRef === 'book-me:guest-booking' && ev.data.StartTime === oldStartTime
      )
      if (matchingGuestEvent) {
        await ctx.tools.update(`user:${guestUserId}`, 'events', matchingGuestEvent.recordId, {
          ...matchingGuestEvent.data,
          StartTime: newStart.toISOString(),
          EndTime: newEnd.toISOString(),
        })
      }
    } catch (err) {
      console.warn('[reschedule-booking] Failed to update guest calendar event:', err)
    }
  }

  const evTitle = booking.eventTitle as string
  const gName = booking.guestName as string
  const gEmail = booking.guestEmail as string
  const bodyLines = [
    `📆 Meeting rescheduled: ${evTitle}`,
    `Guest: ${gName} (${gEmail})`,
    `Former: ${oldStartTime} – ${oldEndTime}`,
    `New: ${newStart.toISOString()} – ${newEnd.toISOString()}`,
    auditReason ? `Reason: ${auditReason}` : '',
  ].filter(Boolean)
  await createDirMailBookingNotification(ctx, {
    sendDeepSpaceMail,
    eventTypeId: booking.eventTypeId as string,
    participantHash: `booking-reschedule-${bookingId}-${newStart.toISOString()}`,
    conversationTitle: `Meeting Rescheduled: ${evTitle}`,
    messageBody: bodyLines.join('\n'),
    guestName: gName,
    hostUserId,
    guestUserId,
  })

  if (sendExternalEmail) {
    try {
      const initiatedBy: 'host' | 'guest' = ctx.userId === hostUserId ? 'host' : 'guest'
      const gtz = typeof booking.guestTimezone === 'string' ? booking.guestTimezone.trim() : ''
      const htz = typeof booking.hostTimezone === 'string' ? booking.hostTimezone.trim() : ''
      const send = buildRescheduleEmailSend({
        initiatedBy,
        hostName: (booking.hostName as string) ?? '',
        hostEmail: (booking.hostEmail as string) ?? '',
        guestName: gName,
        guestEmail: gEmail,
        eventTitle: evTitle,
        oldStartTime,
        oldEndTime,
        newStartTime: newStart.toISOString(),
        newEndTime: newEnd.toISOString(),
        meetingLink: (booking.meetingLink as string) ?? '',
        additionalInfo: typeof booking.additionalInfo === 'string' ? booking.additionalInfo : undefined,
        reasonForChange: auditReason,
        guestTimezone: gtz || undefined,
        hostTimezone: htz || undefined,
      })
      if (send) {
        const r = await sendTransactionalEmail(ctx.tools, send)
        if (!r.ok) console.warn('[reschedule-booking] email/send:', r.error)
      }
    } catch (err) {
      console.warn('[reschedule-booking] transactional email failed:', err)
    }
  }

  return {
    success: true,
    data: {
      bookingId,
      newStartTime: newStart.toISOString(),
      newEndTime: newEnd.toISOString(),
      rescheduleEmail: auditEmail,
      reasonForChange: auditReason,
    },
  }
}
