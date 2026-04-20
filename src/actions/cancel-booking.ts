/**
 * cancel-booking — Cancel a booking by token or userId.
 *
 * Guests use the cancelToken (from confirmation email link).
 * Hosts use their authenticated userId.
 *
 * Also removes the linked platform calendar events (user:{id}/events) so
 * get-busy-times no longer blocks the slot for new bookings.
 */
import type { ActionHandler } from 'deepspace/worker'
import type { BookMeActionTools } from '../types/book-me-tools'
import {
  removeGuestBookMeCalendarEvent,
  removeHostBookMeCalendarEvent,
} from '../lib/booking-calendar-cleanup'
import { createDirMailBookingNotification, getSendDeepSpaceMailFromEventTypeData } from '../lib/dir-mail-booking-notify'
import { buildCancellationEmailSend } from '../lib/booking-email-templates'
import { sendTransactionalEmail } from '../lib/booking-email-server'

import { SCOPE_ID as APP_SCOPE } from '../constants'

async function hashCancelToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const cancelBooking: ActionHandler = async (ctx) => {
  const { bookingId, cancelToken } = ctx.params as {
    bookingId: string
    cancelToken?: string
  }

  if (!bookingId) {
    return { success: false, error: 'Missing bookingId' }
  }

  // Fetch the booking
  const result = await ctx.tools.get(APP_SCOPE, 'bookings', bookingId)
  if (!result.success) {
    return { success: false, error: 'Booking not found' }
  }

  const booking = (result.data as { record: { data: Record<string, unknown> } }).record.data

  if (booking.status === 'cancelled') {
    return { success: false, error: 'Booking is already cancelled' }
  }

  if (booking.status === 'no_show') {
    return { success: false, error: 'Cannot cancel a meeting marked as no-show' }
  }

  // Authorization: either the cancelToken matches, or the user is the host/guest
  const isHost = ctx.userId === booking.hostUserId
  const isGuest = ctx.userId === booking.guestUserId
  const hasValidToken = cancelToken && (await hashCancelToken(cancelToken)) === booking.cancelToken

  if (!isHost && !isGuest && !hasValidToken) {
    return { success: false, error: 'Not authorized to cancel this booking' }
  }

  const hostUserId = booking.hostUserId as string
  const startTimeIso = booking.startTime as string
  const calendarEventId = booking.calendarEventId as string | undefined
  const calendarAppEventId = booking.calendarAppEventId as string | undefined
  const rawGuestId = booking.guestUserId as string | undefined
  const guestUserId =
    typeof rawGuestId === 'string' && rawGuestId.trim() !== '' ? rawGuestId.trim() : undefined

  // Cancel the booking first so we never leave "no calendar event but still confirmed"
  const updateResult = await ctx.tools.update(APP_SCOPE, 'bookings', bookingId, {
    ...booking,
    status: 'cancelled',
  })

  if (!updateResult.success) {
    return { success: false, error: 'Failed to cancel booking' }
  }

  try {
    await removeHostBookMeCalendarEvent(ctx, hostUserId, calendarEventId, startTimeIso)
  } catch (err) {
    console.warn('[cancel-booking] Host calendar cleanup error:', err)
  }

  try {
    await removeGuestBookMeCalendarEvent(ctx, guestUserId ?? '', hostUserId, startTimeIso)
  } catch (err) {
    console.warn('[cancel-booking] Guest calendar cleanup error:', err)
  }

  // Remove the mirrored event from the calendar app's RECORD_ROOMS for the host.
  if (calendarAppEventId) {
    try {
      const res = await (ctx.tools as BookMeActionTools).calendarApp('/internal/delete-event', {
        userId: hostUserId,
        eventId: calendarAppEventId,
      })
      if (!res) {
        console.warn('[cancel-booking] calendar app unavailable for host event deletion')
      } else {
        const json = (await res.json()) as { success?: boolean }
        if (!json.success) console.warn('[cancel-booking] calendar app delete-event (host) failed:', json)
      }
    } catch (err) {
      console.warn('[cancel-booking] Failed to delete host event from calendar app:', err)
    }
  }

  // Remove the guest's mirrored event from the calendar app if applicable.
  // We don't store a separate guest calendarAppEventId, so we skip silently if absent.
  // (Guest mirror deletions are best-effort; the guest's own local event was already cleaned up above.)

  const etFetch = await ctx.tools.get(APP_SCOPE, 'event-types', booking.eventTypeId as string)
  let sendDeepSpaceMail = false
  let sendExternalEmail = true
  if (etFetch.success) {
    const etData = (etFetch.data as { record: { data: Record<string, unknown> } }).record.data
    sendDeepSpaceMail = getSendDeepSpaceMailFromEventTypeData(etData)
    sendExternalEmail = (etData.sendExternalEmail as boolean) ?? true
  }

  const eventTitle = (booking.eventTitle as string) ?? 'Meeting'
  const gName = (booking.guestName as string) ?? ''
  const gEmail = (booking.guestEmail as string) ?? ''
  const endTimeIso = (booking.endTime as string) ?? startTimeIso
  await createDirMailBookingNotification(ctx, {
    sendDeepSpaceMail,
    eventTypeId: booking.eventTypeId as string,
    participantHash: `booking-cancel-${bookingId}-${startTimeIso}`,
    conversationTitle: `Booking Cancelled: ${eventTitle}`,
    messageBody: `❌ Booking cancelled: ${eventTitle}\nGuest: ${gName} (${gEmail})\nWas: ${startTimeIso} – ${endTimeIso}`,
    guestName: gName,
    hostUserId,
    guestUserId,
  })

  if (sendExternalEmail) {
    try {
      const initiatedBy: 'host' | 'guest' = ctx.userId === hostUserId ? 'host' : 'guest'
      const gtz = typeof booking.guestTimezone === 'string' ? booking.guestTimezone.trim() : ''
      const htz = typeof booking.hostTimezone === 'string' ? booking.hostTimezone.trim() : ''
      const send = buildCancellationEmailSend({
        initiatedBy,
        hostName: (booking.hostName as string) ?? '',
        hostEmail: (booking.hostEmail as string) ?? '',
        guestName: gName,
        guestEmail: gEmail,
        eventTitle,
        startTime: startTimeIso,
        endTime: endTimeIso,
        guestTimezone: gtz || undefined,
        hostTimezone: htz || undefined,
      })
      if (send) {
        const r = await sendTransactionalEmail(ctx.tools, send)
        if (!r.ok) console.warn('[cancel-booking] email/send:', r.error)
      }
    } catch (err) {
      console.warn('[cancel-booking] transactional email failed:', err)
    }
  }

  return {
    success: true,
    data: { bookingId, status: 'cancelled' },
  }
}
