/**
 * undo-booking-no-show — Host reverts a no-show back to confirmed.
 */
import type { ActionHandler } from '../lib/action-types'
import { SCOPE_ID as APP_SCOPE } from '../constants'

export const undoBookingNoShow: ActionHandler = async (ctx) => {
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
    return { success: false, error: 'Only the host can undo a no-show' }
  }

  if (booking.status !== 'no_show') {
    return { success: false, error: 'This meeting is not marked as no-show' }
  }

  const updateResult = await ctx.tools.update(APP_SCOPE, 'bookings', bookingId, {
    ...booking,
    status: 'confirmed',
  })

  if (!updateResult.success) {
    return { success: false, error: 'Failed to update booking' }
  }

  return { success: true, data: { bookingId, status: 'confirmed' } }
}
