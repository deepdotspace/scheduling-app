/**
 * delete-booking — Permanently remove a booking record (host or guest).
 *
 * Allowed only for cancelled, no-show, or past confirmed/completed meetings.
 * Best-effort removal of linked platform calendar events, then deletes the booking row.
 */
import type { ActionHandler } from 'deepspace/worker'
import type { Booking } from '../constants'
import {
  removeGuestBookMeCalendarEvent,
  removeHostBookMeCalendarEvent,
} from '../lib/booking-calendar-cleanup'
import { isBookingEligibleForPermanentDelete } from '../lib/booking-permanent-delete-eligibility'
import { SCOPE_ID as APP_SCOPE } from '../constants'

export const deleteBooking: ActionHandler = async (ctx) => {
  const { bookingId } = ctx.params as { bookingId: string }

  if (!bookingId) {
    return { success: false, error: 'Missing bookingId' }
  }

  if (!ctx.userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const result = await ctx.tools.get(APP_SCOPE, 'bookings', bookingId)
  if (!result.success) {
    return { success: false, error: 'Booking not found' }
  }

  const booking = (result.data as { record: { data: Record<string, unknown> } }).record.data

  const isHost = ctx.userId === booking.hostUserId
  const isGuest = ctx.userId === booking.guestUserId
  if (!isHost && !isGuest) {
    return { success: false, error: 'Not authorized to delete this booking' }
  }

  const eligibility: Pick<Booking, 'status' | 'startTime'> = {
    status: (booking.status as Booking['status']) ?? 'confirmed',
    startTime: typeof booking.startTime === 'string' ? booking.startTime : '',
  }
  if (!isBookingEligibleForPermanentDelete(eligibility)) {
    return {
      success: false,
      error: 'Only past, cancelled, or no-show meetings can be permanently deleted',
    }
  }

  const hostUserId = booking.hostUserId as string
  const startTimeIso = booking.startTime as string
  const calendarEventId = booking.calendarEventId as string | undefined
  const rawGuestId = booking.guestUserId as string | undefined
  const guestUserId =
    typeof rawGuestId === 'string' && rawGuestId.trim() !== '' ? rawGuestId.trim() : undefined

  try {
    await removeHostBookMeCalendarEvent(ctx, hostUserId, calendarEventId, startTimeIso)
  } catch (err) {
    console.warn('[delete-booking] Host calendar cleanup error:', err)
  }

  try {
    await removeGuestBookMeCalendarEvent(ctx, guestUserId ?? '', hostUserId, startTimeIso)
  } catch (err) {
    console.warn('[delete-booking] Guest calendar cleanup error:', err)
  }

  const del = await ctx.tools.remove(APP_SCOPE, 'bookings', bookingId)
  if (!del.success) {
    return { success: false, error: del.error ?? 'Failed to delete booking' }
  }

  return { success: true, data: { bookingId } }
}
