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

/**
 * The actions a signed-out visitor may call.
 *
 * A booking link exists so people WITHOUT an account can book time, so the two
 * calls the public page makes — read the host's busy intervals, then book a
 * slot — must work with no JWT. Everything else in `actions` acts on a booking
 * that already exists and the worker answers 401 for it without a verified JWT
 * (`cancel-booking` / `reschedule-booking` have their own guest path: the guest
 * presents the per-booking `cancelToken` they were mailed).
 *
 * What makes these two safe to open is that neither grants a capability the
 * caller didn't already have, and neither takes the caller's word for anything
 * that matters:
 *
 * - `get-busy-times` is read-only and returns start/end instants only, never
 *   event titles or attendees — it exists precisely so a stranger can see when
 *   a host is busy without seeing what they are doing.
 * - `schedule-event` resolves the host's real name and email server-side,
 *   refuses an event type that isn't active or doesn't belong to the named
 *   host, computes `endTime` from the event type's own duration, and runs the
 *   full availability gate (weekday windows, minimum notice, per-day cap, date
 *   overrides) plus conflict checks against bookings, the host's DeepSpace
 *   calendar and their Google FreeBusy. A signed-out caller can therefore only
 *   land on a slot the host has actually published as free — the same slots the
 *   picker would offer them.
 *
 * Adding anything here removes its sign-in requirement for the whole internet;
 * `public-actions.test.ts` asserts the set stays exactly these two.
 */
export const PUBLIC_ACTIONS: ReadonlySet<string> = new Set(['schedule-event', 'get-busy-times'])
