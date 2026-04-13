import type { Booking } from '../constants'

/**
 * User-initiated permanent delete is allowed for cancelled / no-show, or past
 * confirmed/completed meetings (clears list clutter). Upcoming meetings must be cancelled first.
 */
export function isBookingEligibleForPermanentDelete(booking: Pick<Booking, 'status' | 'startTime'>): boolean {
  const status = booking.status
  if (status === 'cancelled' || status === 'no_show') return true
  const startMs = new Date(booking.startTime).getTime()
  if (Number.isNaN(startMs) || startMs > Date.now()) return false
  return status === 'confirmed' || status === 'completed'
}
