/**
 * BookMe Constants
 *
 * Scheduling app configuration and type definitions
 */

import {
  addCalendarDays,
  getDayOfWeekInTimezone,
  getZonedYMDHM,
  zonedWallTimeToUtc,
} from './lib/zoned-time'

/** App slug — must match deploy / worker APP_NAME */
export const APP_NAME = 'book2me'

export const SCOPE_ID = `app:${APP_NAME}`

/** DeepSpace video call base URL */
export const VIDEO_CALL_BASE_URL = 'https://meet.app.space'

/**
 * Canonical URL for a DeepSpace video call room (pre-join / join flow).
 * Always includes `/call/{roomId}` so links never open the miniapp root alone.
 */
export function buildVideoCallMeetingUrl(roomId: string): string {
  const id = roomId.trim()
  if (id.length === 0) {
    throw new Error('buildVideoCallMeetingUrl: roomId must be non-empty')
  }
  return `${VIDEO_CALL_BASE_URL}/call/${id}`
}

/** Shared DO connections. Empty by default — add entries to connect to shared DOs. */
export const SHARED_CONNECTIONS: { type: string; instanceId?: string }[] = []

// Days of the week
export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type DayOfWeek = typeof DAYS_OF_WEEK[number]

// Time slots from 00:00 to 23:30 in 30-minute increments
export const TIME_SLOTS: string[] = []
for (let hour = 0; hour < 24; hour++) {
  for (let min = 0; min < 60; min += 30) {
    const h = hour.toString().padStart(2, '0')
    const m = min.toString().padStart(2, '0')
    TIME_SLOTS.push(`${h}:${m}`)
  }
}

// Event durations in minutes
export const EVENT_DURATIONS = [
  { value: 15, label: '15 minutes' },
  { value: 20, label: '20 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 45, label: '45 minutes' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
] as const

// Meeting locations
export const MEETING_LOCATIONS = [
  { value: 'deepspace-meets', label: 'DeepSpace Meets', icon: '🚀' },
  { value: 'google-meet', label: 'Google Meet', icon: '📹' },
  { value: 'zoom', label: 'Zoom', icon: '💻' },
  { value: 'phone', label: 'Phone Call', icon: '📞' },
  { value: 'in-person', label: 'In Person', icon: '🏢' },
] as const

export type MeetingLocation = typeof MEETING_LOCATIONS[number]['value']

// Buffer time options (minutes)
export const BUFFER_OPTIONS = [
  { value: 0, label: 'No buffer' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 45, label: '45 minutes' },
  { value: 60, label: '1 hour' },
] as const

// Booking question types
export interface BookingQuestion {
  id: string
  type: 'text' | 'textarea' | 'select' | 'checkbox'
  label: string
  required: boolean
  options?: string[] // For 'select' type
}

// Event types
export interface EventType {
  id: string
  userId: string // Owner of this event type
  title: string
  description: string
  duration: number
  location: MeetingLocation
  isActive: boolean
  color: string
  /** When true, send DeepSpace Mail directory + in-app DM notifications for bookings (see server + client hooks). */
  sendDeepSpaceMail: boolean
  /**
   * When true, call Google Calendar API to create an event and send a calendar invite to the guest
   * (requires host to connect Google Calendar). Stored as `sendGcalInvite` in records.
   */
  sendGoogleCalendarInvite: boolean
  sendExternalEmail: boolean
  bufferBefore: number
  bufferAfter: number
  durations: number[]
  availabilityScheduleId: string
  bookingQuestions: BookingQuestion[]
  maxAttendees: number // 0 or 1 = single booking, >1 = group event
  isRoundRobin: boolean // If true, bookings are distributed across team members
  teamMemberIds: string[] // User IDs participating in round robin
  createdAt: string
}

// Availability slot
export interface AvailabilitySlot {
  day: DayOfWeek
  isAvailable: boolean
  startTime: string
  endTime: string
}

/** Single time block within a day (e.g. 9:00–12:00) */
export interface DayBlock {
  startTime: string
  endTime: string
}

/** Day-level availability: multiple blocks per day (e.g. 9–12 and 14–17) */
export interface DaySettings {
  isAvailable: boolean
  blocks: DayBlock[]
}

// Availability settings
export interface AvailabilitySettings {
  id: string
  name: string
  monday: DaySettings
  tuesday: DaySettings
  wednesday: DaySettings
  thursday: DaySettings
  friday: DaySettings
  saturday: DaySettings
  sunday: DaySettings
  timeGap: number // Minimum minutes gap before booking
  maxBookingsPerDay: number // 0 = unlimited
  timezone: string
}

/** Normalize legacy day data (single startTime/endTime) to blocks array */
export function normalizeDaySettings(day: unknown): DaySettings {
  const raw = (day ?? {}) as { isAvailable?: boolean; startTime?: string; endTime?: string; blocks?: DayBlock[] }
  if (Array.isArray(raw.blocks) && raw.blocks.length > 0) {
    return {
      isAvailable: raw.isAvailable ?? true,
      blocks: raw.blocks.map(b => ({ startTime: b.startTime ?? '09:00', endTime: b.endTime ?? '17:00' })),
    }
  }
  return {
    isAvailable: raw.isAvailable ?? true,
    blocks: [{ startTime: raw.startTime ?? '09:00', endTime: raw.endTime ?? '17:00' }],
  }
}

// Availability override (date-specific)
export interface AvailabilityOverride {
  id: string
  userId: string
  date: string // YYYY-MM-DD
  type: 'blocked' | 'custom'
  startTime?: string
  endTime?: string
}

// Recurrence options for recurring meetings
export type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly'

export const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
]

// Booking
export interface Booking {
  id: string
  eventTypeId: string
  eventTitle: string
  guestName: string
  guestEmail: string
  guestUserId?: string // Set when a logged-in user makes a booking
  startTime: string
  endTime: string
  meetingLink?: string
  additionalInfo?: string
  answers?: Record<string, string | boolean> // Custom question answers
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  cancelToken?: string
  seriesId?: string // Links recurring bookings together
  recurrence?: RecurrenceType
  createdAt: string
  hostUserId: string
  hostName: string
  /** Host contact on the booking (set at schedule time for guest-facing UI) */
  hostEmail?: string
  /** Set when the meeting was rescheduled via the reschedule flow (audit) */
  rescheduleEmail?: string
  reasonForChange?: string
  /** IANA zone the guest used when booking (for email display to guest vs host) */
  guestTimezone?: string
  /** Host availability IANA zone at booking time (reminders + DM copy) */
  hostTimezone?: string
}

// Branding settings for the public booking page
export interface BrandingSettings {
  accentColor: string
  greetingText: string
  logoUrl: string
}

export const DEFAULT_BRANDING: BrandingSettings = {
  accentColor: '#111111',
  greetingText: '',
  logoUrl: '',
}

export const BRANDING_COLORS = [
  '#111111', // brand (black)
  '#8b5cf6', // violet
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#84cc16', // lime
] as const

// User profile for booking page
export interface UserProfile {
  id: string
  name: string
  email: string
  imageUrl?: string
  username: string
  bio?: string
  calendarConnected: boolean
  emailConnected: boolean
  branding?: BrandingSettings
}

// Default availability (Mon-Fri 9-5)
export const DEFAULT_AVAILABILITY: AvailabilitySettings = {
  id: '',
  name: 'Standard Hours',
  monday: { isAvailable: true, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  tuesday: { isAvailable: true, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  wednesday: { isAvailable: true, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  thursday: { isAvailable: true, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  friday: { isAvailable: true, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  saturday: { isAvailable: false, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  sunday: { isAvailable: false, blocks: [{ startTime: '09:00', endTime: '17:00' }] },
  timeGap: 60,
  maxBookingsPerDay: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}

// Event colors for visual distinction (user-selectable for event types)
export const EVENT_COLORS = [
  '#B2E1D2',
  '#FF8c00',
  '#CD9A62',
  '#007B82',
  '#D8EB27',
  '#F3c1AA',
  '#5E183B',
  '#BDBDF7',
  '#003c38',
  '#FFc20E',
] as const

/** Convert a hex color to a misty/pastel version (blended with white) for card backgrounds */
export function toMistyColor(hex: string, whiteAmount = 0.72): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '#E8E8E8'
  const r = parseInt(result[1], 16)
  const g = parseInt(result[2], 16)
  const b = parseInt(result[3], 16)
  const wr = Math.round(255 * whiteAmount + r * (1 - whiteAmount))
  const wg = Math.round(255 * whiteAmount + g * (1 - whiteAmount))
  const wb = Math.round(255 * whiteAmount + b * (1 - whiteAmount))
  return '#' + [wr, wg, wb].map(x => x.toString(16).padStart(2, '0')).join('')
}

// Generate random ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

// Format date for display
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Format time for display
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// Get day of week from date
export function getDayOfWeek(date: Date): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return days[date.getDay()]
}

// Check if time slot is available
export function isTimeSlotAvailable(
  time: string,
  availability: AvailabilitySettings,
  day: DayOfWeek
): boolean {
  const daySettings = normalizeDaySettings(availability[day])
  if (!daySettings.isAvailable) return false
  return daySettings.blocks.some(b => time >= b.startTime && time < b.endTime)
}

/**
 * Generate bookable slot start times (UTC ISO strings) for a calendar day.
 *
 * - `selectedDate`: any Date whose instant falls on the chosen calendar day (e.g. midnight local from the picker).
 * - `displayTimezone`: booker's IANA zone — slots are a 30‑minute grid on that civil day in this zone.
 * - Availability blocks (09:00–17:00, weekday flags) are interpreted in `availability.timezone` (host).
 */
export function getAvailableSlots(
  selectedDate: Date,
  displayTimezone: string,
  availability: AvailabilitySettings,
  duration: number,
  existingBookings: Booking[],
  options?: {
    bufferBefore?: number
    bufferAfter?: number
    overrides?: AvailabilityOverride[]
    calendarBusyTimes?: Array<{ start: string; end: string }>
    maxAttendees?: number // >1 means group event — allow multiple bookings per slot
  }
): string[] {
  const bufferBefore = options?.bufferBefore ?? 0
  const bufferAfter = options?.bufferAfter ?? 0
  const hostTz = availability.timezone || 'UTC'

  const civil = getZonedYMDHM(selectedDate, displayTimezone)
  const dateStr = `${civil.year}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`

  const override = options?.overrides?.find(o => o.date === dateStr)
  if (override?.type === 'blocked') return []

  const maxPerDay = availability.maxBookingsPerDay ?? 0
  if (maxPerDay > 0) {
    const dayStartUtc = zonedWallTimeToUtc(civil.year, civil.month, civil.day, 0, 0, displayTimezone)
    const nextCivil = addCalendarDays(civil.year, civil.month, civil.day, 1)
    const nextDayUtc = zonedWallTimeToUtc(nextCivil.year, nextCivil.month, nextCivil.day, 0, 0, displayTimezone)
    if (dayStartUtc && nextDayUtc) {
      const sameDayBookings = existingBookings.filter(b => {
        if (b.status === 'cancelled' || b.status === 'no_show') return false
        const bStart = new Date(b.startTime)
        return bStart >= dayStartUtc && bStart < nextDayUtc
      })
      if (sameDayBookings.length >= maxPerDay) return []
    }
  }

  const now = new Date()
  const minStartUtc = new Date(now.getTime() + availability.timeGap * 60_000)

  const slots: string[] = []
  const maxAtt = options?.maxAttendees ?? 0
  const isGroupEvent = maxAtt > 1

  const tryAddSlot = (slotStart: Date): void => {
    if (slotStart.getTime() < minStartUtc.getTime()) return

    const slotEnd = new Date(slotStart.getTime() + duration * 60000)
    const bufferedStart = new Date(slotStart.getTime() - bufferBefore * 60000)
    const bufferedEnd = new Date(slotEnd.getTime() + bufferAfter * 60000)

    let hasBookingConflict: boolean
    if (isGroupEvent) {
      const overlappingCount = existingBookings.filter(booking => {
        if (booking.status === 'cancelled' || booking.status === 'no_show') return false
        const bookingStart = new Date(booking.startTime)
        const bookingEnd = new Date(booking.endTime)
        return slotStart < bookingEnd && slotEnd > bookingStart
      }).length
      hasBookingConflict = overlappingCount >= maxAtt
    } else {
      hasBookingConflict = existingBookings.some(booking => {
        if (booking.status === 'cancelled' || booking.status === 'no_show') return false
        const bookingStart = new Date(booking.startTime)
        const bookingEnd = new Date(booking.endTime)
        return bufferedStart < bookingEnd && bufferedEnd > bookingStart
      })
    }

    const hasCalendarConflict = (options?.calendarBusyTimes ?? []).some(busy => {
      const busyStart = new Date(busy.start)
      const busyEnd = new Date(busy.end)
      return slotStart < busyEnd && slotEnd > busyStart
    })

    if (!hasBookingConflict && !hasCalendarConflict) {
      slots.push(slotStart.toISOString())
    }
  }

  // Custom day: windows are stored as host-local HH:MM on override.date (Gregorian)
  if (override?.type === 'custom' && override.startTime && override.endTime) {
    const [y, mo, d] = dateStr.split('-').map(s => parseInt(s, 10))
    const oStart = parseTimeToMinutes(override.startTime)
    const oEnd = parseTimeToMinutes(override.endTime)
    for (let hm = oStart; hm + duration <= oEnd; hm += 30) {
      const sh = Math.floor(hm / 60)
      const sm = hm % 60
      const slotStart = zonedWallTimeToUtc(y, mo, d, sh, sm, hostTz)
      if (!slotStart) continue
      const zDisp = getZonedYMDHM(slotStart, displayTimezone)
      if (zDisp.year !== civil.year || zDisp.month !== civil.month || zDisp.day !== civil.day) continue
      tryAddSlot(slotStart)
    }
    return slots
  }

  for (let dayMins = 0; dayMins < 24 * 60; dayMins += 30) {
    const h = Math.floor(dayMins / 60)
    const m = dayMins % 60
    const slotStart = zonedWallTimeToUtc(civil.year, civil.month, civil.day, h, m, displayTimezone)
    if (!slotStart) continue

    const zCheck = getZonedYMDHM(slotStart, displayTimezone)
    if (zCheck.year !== civil.year || zCheck.month !== civil.month || zCheck.day !== civil.day) {
      continue
    }

    const slotEnd = new Date(slotStart.getTime() + duration * 60_000)
    const hostDay = getDayOfWeekInTimezone(slotStart, hostTz)
    const daySettings = normalizeDaySettings(availability[hostDay])
    if (!daySettings.isAvailable) continue

    const hostStart = getZonedYMDHM(slotStart, hostTz)
    const hostEnd = getZonedYMDHM(slotEnd, hostTz)
    const slotStartMins = hostStart.hour * 60 + hostStart.minute
    // If the slot end falls on a different calendar day in the host timezone (e.g. a 23:30
    // slot whose end wraps to 00:00 the next day), getZonedYMDHM returns hour=0 minute=0
    // which evaluates to 0 — falsely satisfying any slotEndMins <= availEnd check.
    // Treat cross-midnight ends as 24:00 (1440 min) so they correctly fail the block test.
    const hostEndSameDay =
      hostEnd.year === hostStart.year &&
      hostEnd.month === hostStart.month &&
      hostEnd.day === hostStart.day
    const slotEndMins = hostEndSameDay ? hostEnd.hour * 60 + hostEnd.minute : 24 * 60

    const inBlock = daySettings.blocks.some(b => {
      const availStart = parseTimeToMinutes(b.startTime)
      const availEnd = parseTimeToMinutes(b.endTime)
      return slotStartMins >= availStart && slotEndMins <= availEnd
    })
    if (!inBlock) continue

    tryAddSlot(slotStart)
  }

  return slots
}

/** Get remaining spots for a group event time slot (slotStartIso = UTC ISO from {@link getAvailableSlots}). */
export function getRemainingSpots(
  slotStartIso: string,
  duration: number,
  maxAttendees: number,
  existingBookings: Booking[],
): number {
  if (maxAttendees <= 1) return 1 // Not a group event

  const slotStart = new Date(slotStartIso)
  if (isNaN(slotStart.getTime())) return 0
  const slotEnd = new Date(slotStart.getTime() + duration * 60000)

  const overlapping = existingBookings.filter(b => {
    if (b.status === 'cancelled' || b.status === 'no_show') return false
    const bStart = new Date(b.startTime)
    const bEnd = new Date(b.endTime)
    return slotStart < bEnd && slotEnd > bStart
  }).length

  return Math.max(0, maxAttendees - overlapping)
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Common timezones for the timezone selector
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
] as const

/** Get a human-readable timezone label */
export function getTimezoneLabel(tz: string): string {
  try {
    const now = new Date()
    const short = now.toLocaleTimeString('en-US', { timeZone: tz, timeZoneName: 'short' }).split(' ').pop() ?? ''
    const offset = now.toLocaleTimeString('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).split('GMT').pop() ?? ''
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
    return `${city} (${short}${offset ? ', GMT' + offset : ''})`
  } catch {
    return tz
  }
}

/** Convert 24h time string "HH:MM" to 12h format "h:MM AM/PM" */
export function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`
}

export {
  formatInstantInTimezone,
  formatDateInTimezone,
  formatTimeRangeInTimezone,
  formatTimeZoneShortName,
  formatEmailDateAndTimeRange,
  formatEmailDateAndOptionalEndRange,
  formatDualPartyTimeRangeForDm,
  formatDualPartyOptionalEndForDm,
} from './lib/email-datetime-format'

/** Generate .ics calendar file content */
export function generateIcsContent(params: {
  title: string
  startTime: string
  endTime: string
  description: string
  location?: string
}): string {
  const fmt = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BookMe//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(params.startTime)}`,
    `DTEND:${fmt(params.endTime)}`,
    `SUMMARY:${params.title}`,
    `DESCRIPTION:${params.description.replace(/\n/g, '\\n')}`,
    params.location ? `LOCATION:${params.location}` : '',
    `UID:${Date.now()}@bookme`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

/** Build a Google Calendar "Add Event" URL (opens pre-filled event form). */
export function generateGoogleCalendarUrl(params: {
  title: string
  startTime: string // ISO string
  endTime: string   // ISO string
  description: string
  location?: string
}): string {
  // Google Calendar expects yyyyMMddTHHmmssZ format
  const fmt = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  const url = new URL('https://calendar.google.com/calendar/event')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set('text', params.title)
  url.searchParams.set('dates', `${fmt(params.startTime)}/${fmt(params.endTime)}`)
  url.searchParams.set('details', params.description)
  if (params.location) url.searchParams.set('location', params.location)
  return url.toString()
}

export { ROLES, ROLE_CONFIG, type Role } from 'deepspace'
