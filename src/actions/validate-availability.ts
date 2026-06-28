/**
 * validate-availability — shared host-availability gate for booking actions.
 *
 * Single source of truth used by BOTH schedule-event and reschedule-booking so the two never drift.
 * Validates a requested slot against the host's weekly availability (weekday enabled, time blocks),
 * the minimum-advance timeGap, the per-day booking cap, and date-specific overrides (blocked / custom
 * window) — all evaluated in the HOST's timezone. Conflict detection against existing bookings and
 * calendars stays in the callers (it differs per action), this covers only the availability rules.
 */
import type { ActionTools } from '../lib/action-types'
import { formatYmdInTimezone } from '../lib/zoned-time'
import { SCOPE_ID as APP_SCOPE } from '../constants'

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

export interface ValidateAvailabilityInput {
  hostUserId: string
  /** Slot start (UTC). */
  start: Date
  /** Slot end (UTC). */
  end: Date
  /** "Now" reference for the timeGap check. Defaults to new Date(). */
  now?: Date
  /** Live bookings for this host (already fetched by the caller) — drives the per-day cap. */
  existingBookings: Array<{ recordId?: string; data: Record<string, unknown> }>
  /** Booking id to exclude from the per-day cap count (the booking being rescheduled). */
  excludeBookingId?: string
  /**
   * Event type's bound availability schedule (its `availability` recordId). When set, that specific
   * schedule is validated against instead of the host's default/arbitrary record — parity with the
   * client slot picker (getScheduleById(eventType.availabilityScheduleId)). Falls back to the default
   * when empty or when the id doesn't resolve to one of this host's schedules.
   */
  availabilityScheduleId?: string
}

export type ValidateAvailabilityResult =
  | { ok: true; hostTimezone: string }
  | { ok: false; error: string }

/**
 * Validate a slot against host availability rules. Returns the resolved host timezone on success so
 * the caller can reuse it (e.g. for the stored booking + emails) without re-deriving it.
 */
export async function validateHostAvailability(
  tools: ActionTools,
  input: ValidateAvailabilityInput,
): Promise<ValidateAvailabilityResult> {
  const { hostUserId, start, end, existingBookings, excludeBookingId, availabilityScheduleId } = input
  const now = input.now ?? new Date()

  // Load host availability. Prefer the event type's bound schedule (by recordId) so a custom schedule
  // whose windows differ from the host's default is validated correctly — matching the client slot
  // picker. Verify the loaded record actually belongs to this host before trusting it; otherwise fall
  // back to the host's default/arbitrary record.
  let avail: Record<string, unknown> | undefined
  if (typeof availabilityScheduleId === 'string' && availabilityScheduleId.trim() !== '') {
    const byId = await tools.get(APP_SCOPE, 'availability', availabilityScheduleId.trim())
    if (byId.success) {
      const byIdData = (byId.data as { record?: { data?: Record<string, unknown> } })?.record?.data
      if (byIdData && byIdData.userId === hostUserId) {
        avail = byIdData
      }
    }
  }
  if (!avail) {
    const availResult = await tools.query(APP_SCOPE, 'availability', {
      where: { userId: hostUserId },
      limit: 1,
    })
    const availRecords = (availResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
    if (availRecords.length === 0) {
      return { ok: false, error: 'Host has not configured availability' }
    }
    avail = availRecords[0].data
  }
  const hostTimezone = (avail.timezone as string) || 'UTC'

  const slotLocal = getTimeInTimezone(start, hostTimezone)
  const endLocal = getTimeInTimezone(end, hostTimezone)

  const dayName = DAY_NAMES[slotLocal.dayOfWeek]
  const daySettings = avail[dayName] as DaySettings | undefined
  if (!daySettings?.isAvailable) {
    return { ok: false, error: `Host is not available on ${dayName}` }
  }

  // Normalize legacy single-block format to blocks array
  const blocks: DayBlock[] = Array.isArray(daySettings.blocks) && daySettings.blocks.length > 0
    ? daySettings.blocks
    : [{ startTime: daySettings.startTime ?? '09:00', endTime: daySettings.endTime ?? '17:00' }]

  const slotStartMins = slotLocal.hours * 60 + slotLocal.minutes
  // If the slot end lands on a different host-local calendar day (e.g. 23:30 + 60m wraps past
  // midnight), endLocal collapses to ~00:30 and would falsely satisfy slotEndMins <= availEnd.
  // Treat any cross-midnight end as 24:00 (1440 min) so the block/override checks reject it.
  const slotEndMins =
    formatYmdInTimezone(end, hostTimezone) !== formatYmdInTimezone(start, hostTimezone)
      ? 24 * 60
      : endLocal.hours * 60 + endLocal.minutes

  const inSomeBlock = blocks.some(b => {
    const availStart = parseTimeToMinutes(b.startTime)
    const availEnd = parseTimeToMinutes(b.endTime)
    return slotStartMins >= availStart && slotEndMins <= availEnd
  })
  if (!inSomeBlock) {
    return { ok: false, error: 'Requested time is outside availability window' }
  }

  // Minimum advance booking window
  const timeGap = (avail.timeGap as number) ?? 0
  const minsUntilSlot = (start.getTime() - now.getTime()) / 60_000
  if (minsUntilSlot < timeGap) {
    return { ok: false, error: `Must book at least ${timeGap} minutes in advance` }
  }

  // Per-day booking cap (host-local day)
  const maxPerDay = (avail.maxBookingsPerDay as number) ?? 0
  if (maxPerDay > 0) {
    const startDayYmd = formatYmdInTimezone(start, hostTimezone)
    const sameDayBookings = existingBookings.filter((b) => {
      if (excludeBookingId && b.recordId === excludeBookingId) return false
      if (b.data.status === 'cancelled' || b.data.status === 'no_show') return false
      const bStart = new Date(b.data.startTime as string)
      return formatYmdInTimezone(bStart, hostTimezone) === startDayYmd
    })
    if (sameDayBookings.length >= maxPerDay) {
      return { ok: false, error: 'Maximum bookings for this day has been reached' }
    }
  }

  // Date-specific overrides (stored as host-local calendar dates)
  const overridesResult = await tools.query(APP_SCOPE, 'availability-overrides', {
    where: { userId: hostUserId },
  })
  const overrideRecords = (overridesResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
  const slotDateStr = formatYmdInTimezone(start, hostTimezone)
  const dateOverride = overrideRecords.find(o => o.data.date === slotDateStr)
  if (dateOverride) {
    if (dateOverride.data.type === 'blocked') {
      return { ok: false, error: 'Host is not available on this date (date override)' }
    }
    if (dateOverride.data.type === 'custom' && dateOverride.data.startTime && dateOverride.data.endTime) {
      const overrideStart = parseTimeToMinutes(dateOverride.data.startTime as string)
      const overrideEnd = parseTimeToMinutes(dateOverride.data.endTime as string)
      if (slotStartMins < overrideStart || slotEndMins > overrideEnd) {
        return { ok: false, error: 'Requested time is outside availability window for this date' }
      }
    }
  }

  return { ok: true, hostTimezone }
}
