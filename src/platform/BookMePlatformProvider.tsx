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
    /** When false, server skips confirmation `email/send` (e.g. recurring occurrences after the first). Default true. */
    sendConfirmationEmail?: boolean
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
    sendConfirmationEmail?: boolean
  }) => {
    console.log('[BookMePlatform] scheduleCalendarEvent called with:', data)
    const token = await getAuthToken()
    console.log('[BookMePlatform] Auth token present:', !!token)
    const res = await fetch('/api/actions/schedule-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    })

    console.log('[BookMePlatform] Response status:', res.status)
    const result = await res.json() as {
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
    }
    console.log('[BookMePlatform] Response body:', result)
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
    const token = await getAuthToken()
    const res = await fetch('/api/actions/cancel-booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    })
    const result = await res.json() as { success: boolean; error?: string }
    return result
  }, [])

  const rescheduleBookingAction = useCallback(async (data: {
    bookingId: string
    cancelToken?: string
    newStartTime: string
    rescheduleEmail?: string
    reasonForChange?: string
  }) => {
    const token = await getAuthToken()
    const res = await fetch('/api/actions/reschedule-booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    })
    const result = await res.json() as { success: boolean; error?: string }
    return result
  }, [])

  const getBusyTimesAction = useCallback(async (data: {
    hostUserId: string
    dateStart: string
    dateEnd: string
  }) => {
    const token = await getAuthToken()
    const res = await fetch('/api/actions/get-busy-times', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    })
    const result = await res.json() as {
      success: boolean
      data?: { busyTimes: BusyTime[] }
      error?: string
    }
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
    const token = await getAuthToken()
    const res = await fetch('/api/actions/get-calendar-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    })
    const result = await res.json() as {
      success: boolean
      data?: { events: Array<{ start: string; end: string; title: string }> }
      error?: string
    }
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
