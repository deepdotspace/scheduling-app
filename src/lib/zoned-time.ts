/**
 * IANA timezone helpers using Intl only (no extra deps).
 * Used so host availability (wall clock in host TZ) matches guest-facing slots
 * (wall clock in booker TZ) while sharing one UTC instant per meeting.
 */

export type WeekdayKey =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'

const WEEKDAY_TO_DAY: Record<string, WeekdayKey> = {
  Sun: 'sunday',
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
}

export interface ZonedYMDHM {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export function getZonedYMDHM(date: Date, timeZone: string): ZonedYMDHM {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = f.formatToParts(date)
  const v = (t: string) => parts.find(p => p.type === t)?.value ?? '0'
  return {
    year: parseInt(v('year'), 10),
    month: parseInt(v('month'), 10),
    day: parseInt(v('day'), 10),
    hour: parseInt(v('hour'), 10),
    minute: parseInt(v('minute'), 10),
  }
}

export function getDayOfWeekInTimezone(date: Date, timeZone: string): WeekdayKey {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
  const wk = f.format(date)
  return WEEKDAY_TO_DAY[wk] ?? 'sunday'
}

/** YYYY-MM-DD for a UTC instant in the given IANA zone (Gregorian civil date). */
export function formatYmdInTimezone(date: Date, timeZone: string): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return f.format(date)
}

function compareYmdhm(
  z: ZonedYMDHM,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  if (z.year !== year) return z.year - year
  if (z.month !== month) return z.month - month
  if (z.day !== day) return z.day - day
  if (z.hour !== hour) return z.hour - hour
  return z.minute - minute
}

/**
 * UTC instant for a civil date/time interpreted in `timeZone`.
 * Returns null if that local time does not exist (DST gap).
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  let lo = Date.UTC(year, month - 1, day - 1, 12, 0, 0)
  let hi = Date.UTC(year, month - 1, day + 2, 12, 0, 0)
  for (let i = 0; i < 48; i++) {
    const mid = Math.floor((lo + hi) / 2)
    const midDate = new Date(mid)
    const z = getZonedYMDHM(midDate, timeZone)
    const cmp = compareYmdhm(z, year, month, day, hour, minute)
    if (cmp === 0) {
      return midDate
    }
    if (cmp < 0) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  const final = new Date(Math.floor((lo + hi) / 2))
  const z = getZonedYMDHM(final, timeZone)
  if (
    z.year === year &&
    z.month === month &&
    z.day === day &&
    z.hour === hour &&
    z.minute === minute
  ) {
    return final
  }
  return null
}

/** Gregorian civil date + n days (UTC calendar math; valid for booking dates). */
export function addCalendarDays(year: number, month: number, day: number, deltaDays: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

/** UTC range [start, end] covering one civil day in `displayTimezone` (for busy-time queries). */
export function getZonedDayUtcRange(
  selectedDate: Date,
  displayTimezone: string,
): { start: Date; end: Date } | null {
  const civil = getZonedYMDHM(selectedDate, displayTimezone)
  const dayStart = zonedWallTimeToUtc(civil.year, civil.month, civil.day, 0, 0, displayTimezone)
  const nextCivil = addCalendarDays(civil.year, civil.month, civil.day, 1)
  const nextDayStart = zonedWallTimeToUtc(nextCivil.year, nextCivil.month, nextCivil.day, 0, 0, displayTimezone)
  if (!dayStart || !nextDayStart) return null
  return { start: dayStart, end: new Date(nextDayStart.getTime() - 1) }
}
