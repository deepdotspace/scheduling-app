/**
 * mark-booking-no-show — Host marks a past meeting as no-show.
 *
 * Does not remove calendar events (meeting time has passed). Excluded from
 * “completed” analytics counts.
 */
import type { ActionHandler } from 'deepspace/worker'
import { SCOPE_ID as APP_SCOPE } from '../constants'

export const markBookingNoShow: ActionHandler = async (ctx) => {
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

  if (ctx.userId !== booking.hostUserId) {
    return { success: false, error: 'Only the host can mark a meeting as no-show' }
  }

  if (booking.status === 'cancelled') {
    return { success: false, error: 'Cannot mark a cancelled booking as no-show' }
  }

  if (booking.status === 'no_show') {
    return { success: false, error: 'This meeting is already marked as no-show' }
  }

  if (booking.status !== 'confirmed') {
    return { success: false, error: 'Only confirmed meetings can be marked as no-show' }
  }

  const end = new Date(booking.endTime as string)
  if (isNaN(end.getTime())) {
    return { success: false, error: 'Invalid end time' }
  }

  if (end.getTime() > Date.now()) {
    return { success: false, error: 'The meeting has not ended yet' }
  }

  const updateResult = await ctx.tools.update(APP_SCOPE, 'bookings', bookingId, {
    ...booking,
    status: 'no_show',
  })

  if (!updateResult.success) {
    return { success: false, error: 'Failed to update booking' }
  }

  return { success: true, data: { bookingId, status: 'no_show' } }
}
