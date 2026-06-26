/**
 * Server Actions — BookMe
 *
 * Each action validates business logic before writing — the action
 * code IS the trust boundary, not rate limiting.
 */
import type { ActionHandler } from '../lib/action-types'
import { scheduleEvent } from './schedule-event'
import { cancelBooking } from './cancel-booking'
import { rescheduleBooking } from './reschedule-booking'
import { getBusyTimes } from './get-busy-times'
import { getCalendarEvents } from './get-calendar-events'
import { markBookingNoShow } from './mark-booking-no-show'
import { undoBookingNoShow } from './undo-booking-no-show'
import { deleteBooking } from './delete-booking'

export const actions: Record<string, ActionHandler> = {
  'schedule-event': scheduleEvent,
  'cancel-booking': cancelBooking,
  'reschedule-booking': rescheduleBooking,
  'get-busy-times': getBusyTimes,
  'get-calendar-events': getCalendarEvents,
  'mark-booking-no-show': markBookingNoShow,
  'undo-booking-no-show': undoBookingNoShow,
  'delete-booking': deleteBooking,
}
