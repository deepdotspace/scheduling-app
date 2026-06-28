/**
 * BookMe Platform Provider
 *
 * Exposes calendar scheduling via server actions. Creates events in the
 * host user's user:{userId} DO. The site worker runs the action server-side
 * with X-App-Action: true, so user RBAC is bypassed — the action code
 * itself is the trust/validation boundary (checks availability, conflicts, etc.).
 */

import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { getAuthToken } from 'deepspace'

interface BusyTime {
  start: string
  end: string
}

/** Logged-in guest’s own calendar row (from get-calendar-events). */
export interface GuestCalendarEvent {
  start: string
  end: string
  title: string
  source: 'deepspace' | 'google'
}

interface BookMePlatformContextValue {
  scheduleCalendarEvent: (data: {
    hostUserId: string
    eventTypeId: string
    startTime: string
    guestEmail: string
    guestName: string
    hostName?: string
    hostEmail?: string
    description?: string
    guestUserId?: string
    meetingLink?: string
    seriesId?: string
    recurrence?: string
    additionalInfo?: string
    answers?: Record<string, string | boolean>
    /** IANA zone used on the booking UI (stored on booking + emails). */
    guestTimezone?: string
    /** Guest-selected duration (minutes) for multi-duration event types; server validates against the event type's durations. */
    duration?: number
    /** App origin (window.location.origin) used to build the guest manage/cancel link in confirmation email. */
    origin?: string
    /** Occurrence gate: when false, skip ALL confirmation email for this call (e.g. recurring occurrences after the first). Default true. */
    sendConfirmationEmail?: boolean
    /** Guest's "also email me" choice: when false, suppress only the guest copy; host still emailed. Default true. */
    sendGuestEmail?: boolean
  }) => Promise<{
    success: boolean
    calendarEventId?: string
    bookingId?: string
    cancelToken?: string
    error?: string
    eventType?: {
      sendDeepSpaceMail: boolean
      sendExternalEmail: boolean
      sendGoogleCalendarInvite: boolean
    }
  }>
  cancelBooking: (data: {
    bookingId: string
    cancelToken?: string
  }) => Promise<{ success: boolean; error?: string }>
  rescheduleBooking: (data: {
    bookingId: string
    cancelToken?: string
    newStartTime: string
    /** Email of the person requesting the reschedule (stored for audit) */
    rescheduleEmail?: string
    /** Reason provided for the reschedule (stored for audit) */
    reasonForChange?: string
  }) => Promise<{ success: boolean; error?: string }>
  getBusyTimes: (data: {
    hostUserId: string
    dateStart: string
    dateEnd: string
  }) => Promise<{ success: boolean; busyTimes?: BusyTime[]; error?: string }>
  getCalendarEvents: (data: {
    userId: string
    dateStart: string
    dateEnd: string
  }) => Promise<{ success: boolean; events?: GuestCalendarEvent[]; error?: string }>
}

/** POST a platform server action with the current auth token; returns the parsed JSON. */
async function postPlatformAction<T>(path: string, data: unknown): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  })
  return (await res.json()) as T
}

const BookMePlatformContext = createContext<BookMePlatformContextValue | null>(null)

export function useBookMePlatform() {
  const ctx = useContext(BookMePlatformContext)
  if (!ctx) throw new Error('useBookMePlatform must be used within BookMePlatformProvider')
  return ctx
}

export function BookMePlatformProvider({ children }: { children: ReactNode }) {
  const scheduleCalendarEvent = useCallback(async (data: {
    hostUserId: string
    eventTypeId: string
    startTime: string
    guestEmail: string
    guestName: string
    hostName?: string
    hostEmail?: string
    description?: string
    guestUserId?: string
    meetingLink?: string
    seriesId?: string
    recurrence?: string
    additionalInfo?: string
    answers?: Record<string, string | boolean>
    guestTimezone?: string
    duration?: number
    origin?: string
    sendConfirmationEmail?: boolean
    sendGuestEmail?: boolean
  }) => {
    const result = await postPlatformAction<{
      success: boolean
      data?: {
        record?: { recordId: string }
        eventType?: {
          sendDeepSpaceMail: boolean
          sendExternalEmail: boolean
          sendGoogleCalendarInvite: boolean
        }
      }
      error?: string
    }>('/api/actions/schedule-event', data)
    if (!result.success) {
      console.error('[BookMePlatform] schedule-event FAILED:', result.error)
      return { success: false, error: result.error ?? 'Unknown error' }
    }
    return {
      success: true,
      calendarEventId: result.data?.record?.recordId,
      bookingId: (result.data as any)?.bookingId,
      cancelToken: (result.data as any)?.cancelToken,
      eventType: result.data?.eventType,
    }
  }, [])

  const cancelBookingAction = useCallback(async (data: {
    bookingId: string
    cancelToken?: string
  }) => {
    return postPlatformAction<{ success: boolean; error?: string }>('/api/actions/cancel-booking', data)
  }, [])

  const rescheduleBookingAction = useCallback(async (data: {
    bookingId: string
    cancelToken?: string
    newStartTime: string
    rescheduleEmail?: string
    reasonForChange?: string
  }) => {
    return postPlatformAction<{ success: boolean; error?: string }>('/api/actions/reschedule-booking', data)
  }, [])

  const getBusyTimesAction = useCallback(async (data: {
    hostUserId: string
    dateStart: string
    dateEnd: string
  }) => {
    const result = await postPlatformAction<{
      success: boolean
      data?: { busyTimes: BusyTime[] }
      error?: string
    }>('/api/actions/get-busy-times', data)
    if (!result.success) {
      return { success: false, error: result.error ?? 'Failed to fetch busy times' }
    }
    return { success: true, busyTimes: result.data?.busyTimes ?? [] }
  }, [])

  const getCalendarEventsAction = useCallback(async (data: {
    userId: string
    dateStart: string
    dateEnd: string
  }) => {
    const result = await postPlatformAction<{
      success: boolean
      data?: { events: Array<{ start: string; end: string; title: string }> }
      error?: string
    }>('/api/actions/get-calendar-events', data)
    if (!result.success) {
      return { success: false, error: result.error ?? 'Failed to fetch calendar events' }
    }
    const events: GuestCalendarEvent[] = (result.data?.events ?? []).map(e => ({
      ...e,
      source: 'deepspace' as const,
    }))
    return { success: true, events }
  }, [])

  return (
    <BookMePlatformContext.Provider value={{
      scheduleCalendarEvent,
      cancelBooking: cancelBookingAction,
      rescheduleBooking: rescheduleBookingAction,
      getBusyTimes: getBusyTimesAction,
      getCalendarEvents: getCalendarEventsAction,
    }}>
      {children}
    </BookMePlatformContext.Provider>
  )
}
