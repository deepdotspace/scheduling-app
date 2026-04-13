/** Shared date/time helpers for Calendar, DatePicker, TimePicker */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Get the full month name (0-indexed) */
export function getMonthName(month: number): string {
  return MONTH_NAMES[month]
}

/** Build a 42-day grid (6 weeks) starting from Sunday before the 1st */
export function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  const startPad = firstDay.getDay()
  const start = new Date(year, month, 1 - startPad)

  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  return days
}

/** Build a grid with only the current month's days (null for empty cells before 1st) */
export function getMonthGridCurrentMonthOnly(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1)
  const startPad = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const result: (Date | null)[] = []
  for (let i = 0; i < startPad; i++) {
    result.push(null)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    result.push(new Date(year, month, d))
  }
  return result
}

/** Returns the Monday of the week containing `date` (week starts Monday) */
export function getMondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

/** Check if two dates are the same calendar day */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

/** Check if a date is today */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

/** Format date as "Mar 15, 2026" */
export function formatDate(date: Date): string {
  return `${SHORT_MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

/** Format 24h time string "HH:mm" → "2:30 PM" */
export function formatTime12h(time: string): string {
  const { hours, minutes } = parseTimeString(time)
  const period = hours >= 12 ? 'PM' : 'AM'
  const h = hours % 12 || 12
  return `${h}:${String(minutes).padStart(2, '0')} ${period}`
}

/** Convert Date → "YYYY-MM-DD" */
export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Convert Date → "HH:mm" */
export function toTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Parse "YYYY-MM-DD" → Date (local midnight) */
export function parseDateString(str: string): Date | null {
  if (!str) return null
  const parts = str.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

/** Parse "HH:mm" → { hours, minutes } */
export function parseTimeString(str: string): { hours: number; minutes: number } {
  const [h, m] = (str || '00:00').split(':').map(Number)
  return { hours: h || 0, minutes: m || 0 }
}

/** Generate time slots for TimePicker dropdown */
export function generateTimeSlots(interval: number, minTime?: string, maxTime?: string): string[] {
  const min = minTime ? parseTimeString(minTime) : { hours: 0, minutes: 0 }
  const max = maxTime ? parseTimeString(maxTime) : { hours: 23, minutes: 59 }
  const minMinutes = min.hours * 60 + min.minutes
  const maxMinutes = max.hours * 60 + max.minutes

  const slots: string[] = []
  for (let m = minMinutes; m <= maxMinutes; m += interval) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${hh}:${mm}`)
  }
  return slots
}
