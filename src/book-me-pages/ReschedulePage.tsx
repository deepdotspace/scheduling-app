/**
 * Reschedule Page
 *
 * Allows the host or guest (signed in) to reschedule a confirmed, upcoming meeting.
 * Mirrors the BookingPage calendar/time-slot flow but with a simplified
 * details form (email + reason for change only).
 *
 * Route: /meetings/reschedule/:bookingId
 */

import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { AlertTriangle, CalendarCheck } from 'lucide-react'
import { useMutations, useUser } from 'deepspace'
import {
  useBookings,
  useProfile,
  useEventTypes,
  useAvailability,
  useAvailabilityOverrides,
  useBookingNotification,
  useUserLookup,
  showToast,
} from '../hooks'
import { useGoogleCalendar } from '../sdk-connectors'
import { useBookMePlatform, type GuestCalendarEvent } from '../platform/BookMePlatformProvider'
import { Button, Input, Textarea, Calendar, EmptyState } from '../components/ui'
import { isToday } from '../components/ui/date-utils'
import {
  getAvailableSlots,
  getDayOfWeek,
  formatDate,
  formatTime,
  formatInstantInTimezone,
  COMMON_TIMEZONES,
  getTimezoneLabel,
} from '../constants'
import { getZonedDayUtcRange } from '../lib/zoned-time'
import type { Booking } from '../constants'
import { saveBookingRescheduleAudit } from '../lib/reschedule-audit-storage'

function getStartOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Full-bleed chrome so reschedule feels like its own page (no sidebar), same tab */
function ReschedulePageChrome({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div data-testid="reschedule-page" className="min-h-screen bg-[#F3F4F6] flex flex-col">
      <header className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white/95 backdrop-blur-sm shrink-0 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-bold text-[#111827] hover:text-[#374151] flex items-center gap-2 uppercase tracking-wider shrink-0"
            aria-label="Back to Meetings"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Meetings
          </button>
          <div className="flex items-center gap-2 text-[#111827] min-w-0 justify-center flex-1">
            <CalendarCheck className="w-5 h-5 shrink-0" strokeWidth={2} />
            <span className="font-black italic tracking-tight text-base hidden sm:inline">Book Me</span>
            <span className="text-[#6B7280] font-semibold text-sm truncate">· Reschedule</span>
          </div>
          <div className="w-[72px] sm:w-[88px] shrink-0" aria-hidden />
        </div>
      </header>
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface LeftPanelProps {
  hostName: string
  hostImageUrl?: string
  eventTitle: string
  durationMinutes: number
  description?: string
  formerStartTime: string
  formerEndTime: string
  selectedDate: Date | null
  selectedSlotIso: string | null
}

function LeftPanel({
  hostName,
  hostImageUrl,
  eventTitle,
  durationMinutes,
  description,
  formerStartTime,
  formerEndTime,
  selectedDate,
  selectedSlotIso,
}: LeftPanelProps) {
  const formerDateStr = formatDate(formerStartTime)
  const formerTimeRange = `${formatTime(formerStartTime)} – ${formatTime(formerEndTime)}`

  const newTimeStr = useMemo(() => {
    if (!selectedDate || !selectedSlotIso) return null
    const start = new Date(selectedSlotIso)
    if (isNaN(start.getTime())) return null
    const end = new Date(start.getTime() + durationMinutes * 60_000)
    return `${formatDate(start.toISOString())} at ${formatTime(start.toISOString())} – ${formatTime(end.toISOString())}`
  }, [selectedDate, selectedSlotIso, durationMinutes])

  return (
    <div className="w-full md:w-2/5 p-12 space-y-8 border-r border-[#E5E7EB]">
      {/* Host */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#E5E7EB] overflow-hidden shrink-0">
          {hostImageUrl ? (
            <img src={hostImageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#6B7280] font-medium">
              {hostName.charAt(0)}
            </div>
          )}
        </div>
        <span className="text-lg font-medium text-[#111827]">{hostName}</span>
      </div>

      {/* Event title */}
      <h1 className="text-4xl font-bold text-[#111827] leading-tight tracking-tight">{eventTitle}</h1>

      {/* Duration chip */}
      <div className="flex items-center gap-2 text-[#6B7280] bg-[#F3F4F6] w-fit px-3 py-1.5 rounded-lg border border-[#E5E7EB] font-medium">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-medium tracking-tight">{durationMinutes} min</span>
      </div>

      {/* New time */}
      <div className="space-y-1">
        <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest">New Time</p>
        {newTimeStr ? (
          <p className="text-sm font-semibold text-[#111827]">{newTimeStr}</p>
        ) : (
          <p className="text-sm font-medium text-[#9CA3AF] italic">Select a new date and time →</p>
        )}
      </div>

      {/* Former time — always strikethrough */}
      <div className="space-y-1">
        <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest">Former Time</p>
        <p className="text-sm text-[#9CA3AF] line-through">{formerDateStr}</p>
        <p className="text-sm text-[#9CA3AF] line-through">{formerTimeRange}</p>
      </div>

      {/* Description */}
      {description?.trim() && (
        <p className="text-sm text-[#6B7280] leading-relaxed font-medium">{description.trim()}</p>
      )}

      {/* Back link */}
      <Link
        to="/meetings"
        className="text-sm text-[var(--color-app-text)] font-bold hover:underline flex items-center gap-2 pt-4 uppercase tracking-wider"
      >
        <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Back to Meetings
      </Link>
    </div>
  )
}

// ─── Confirmation screen ──────────────────────────────────────────────────────

interface ConfirmationScreenProps {
  bookingId: string
  newStartTime: string
  newEndTime: string
  rescheduleEmail: string
  reasonForChange: string
}

function ConfirmationScreen({
  bookingId,
  newStartTime,
  newEndTime,
  rescheduleEmail,
  reasonForChange,
}: ConfirmationScreenProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
      <div className="max-w-lg w-full mx-auto">
        <div className="app-card p-8 text-center border-[#10b981]/30">
          <div className="w-16 h-16 bg-[#10b981]/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#10b981]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[#111827] tracking-tight mb-2">Meeting Rescheduled!</h2>
          <p className="text-[#6B7280] font-medium mb-6">Your meeting has been moved to the new time.</p>

          <div className="bg-[#F3F4F6] rounded-xl p-4 text-left space-y-3 border border-[#E5E7EB] mb-6">
            <div>
              <p className="text-xs text-[#6B7280] font-medium">New date</p>
              <p className="text-[#111827] font-semibold">
                {new Date(newStartTime).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#6B7280] font-medium">New time</p>
              <p className="text-[#111827] font-semibold">
                {formatTime(newStartTime)} – {formatTime(newEndTime)}
              </p>
            </div>
          </div>

          <Link
            to="/meetings"
            replace={false}
            state={{
              rescheduleAudit: {
                bookingId,
                rescheduleEmail,
                reasonForChange,
              },
            }}
            className="app-btn-primary inline-flex items-center gap-2"
          >
            Back to Meetings
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReschedulePage() {
  const { bookingId } = useParams<{ bookingId: string }>()
  const navigate = useNavigate()
  const goToMeetings = (): void => {
    navigate('/meetings')
  }

  const { user } = useUser()
  const { bookings, ready: bookingsReady } = useBookings()
  const { putConfirmed: putBookingRecordConfirmed } = useMutations<Record<string, unknown>>('bookings')
  const { profiles, ready: profilesReady } = useProfile()
  const { rescheduleBooking, getBusyTimes, getCalendarEvents } = useBookMePlatform()
  const { getEvents: getGoogleEvents } = useGoogleCalendar()
  const { notifyReschedule } = useBookingNotification()

  const booking = useMemo((): Booking | undefined => {
    if (!bookingId) return undefined
    return bookings.find(b => b.id === bookingId)
  }, [bookingId, bookings])

  const hostProfile = useMemo(() => {
    if (!booking?.hostUserId) return undefined
    return profiles[booking.hostUserId]
  }, [booking, profiles])

  const { eventTypes: hostEventTypes } = useEventTypes(booking?.hostUserId)
  const { availability: hostDefaultAvailability, getScheduleById: getHostSchedule } = useAvailability(booking?.hostUserId)
  const { overrides: hostOverrides } = useAvailabilityOverrides(booking?.hostUserId)

  const eventType = useMemo(() => {
    if (!booking) return undefined
    return hostEventTypes.find(et => et.id === booking.eventTypeId)
  }, [booking, hostEventTypes])

  const hostAvailability = useMemo(() => {
    if (eventType?.availabilityScheduleId) {
      const schedule = getHostSchedule(eventType.availabilityScheduleId)
      if (schedule) return schedule
    }
    return hostDefaultAvailability
  }, [eventType, getHostSchedule, hostDefaultAvailability])

  const durationMinutes = useMemo(() => {
    if (!booking) return 30
    const ms = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()
    return Math.round(ms / 60_000)
  }, [booking])

  // Calendar state
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null)
  const [bookerTimezone, setBookerTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  /** Same as confirmation: when the booking has `guestTimezone`, align the picker (host rescheduling no longer stays on host browser TZ). */
  useEffect(() => {
    const g = booking?.guestTimezone?.trim()
    if (g) setBookerTimezone(g)
  }, [booking?.id, booking?.guestTimezone])
  const [calendarBusyTimes, setCalendarBusyTimes] = useState<Array<{ start: string; end: string }>>([])
  const [busyTimesLoading, setBusyTimesLoading] = useState(false)
  const [canShowTimeSlots, setCanShowTimeSlots] = useState(false)
  const busyTimesLoadStartRef = useRef<number | null>(null)
  const [guestCalendarEvents, setGuestCalendarEvents] = useState<GuestCalendarEvent[]>([])
  const [guestEventsLoading, setGuestEventsLoading] = useState(false)
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null)
  const hasInitializedSelectedDateRef = useRef(false)

  // Panel slide state (mirrors BookingPage)
  const [showDetailsForm, setShowDetailsForm] = useState(false)
  const [panelState, setPanelState] = useState<'calendar' | 'exiting' | 'details' | 'returning'>('calendar')
  const panelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Form state
  const [email, setEmail] = useState('')
  const [reasonForChange, setReasonForChange] = useState('')
  const { isLooking: isLookingUpUser, result: lookupResult } = useUserLookup(email)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Auto-fill email from logged-in DeepSpace account (does not overwrite typed email)
  useEffect(() => {
    const loginEmail = user?.email?.trim()
    if (!loginEmail) return
    setEmail(prev => {
      if (prev.trim()) return prev
      return loginEmail
    })
  }, [user?.email])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [rescheduleResult, setRescheduleResult] = useState<{
    newStartTime: string
    newEndTime: string
    bookingId: string
    rescheduleEmail: string
    reasonForChange: string
  } | null>(null)

  // Redirect guard — runs only after data is ready
  useEffect(() => {
    if (!bookingsReady || !profilesReady) return
    if (!booking) {
      navigate('/meetings', { replace: true })
      return
    }
    const isCancelled = booking.status === 'cancelled'
    const isPast = new Date(booking.startTime) <= new Date()
    if (isCancelled || isPast) {
      navigate('/meetings', { replace: true })
    }
  }, [booking, bookingsReady, profilesReady, navigate])

  // Host bookings for slot conflict detection — exclude the booking being rescheduled
  const hostBookingsExcludingCurrent = useMemo(() => {
    if (!booking) return []
    return bookings.filter(b => b.hostUserId === booking.hostUserId && b.status === 'confirmed' && b.id !== booking.id)
  }, [bookings, booking])

  // Available dates (next 60 days)
  const availableDates = useMemo(() => {
    const dates: Date[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 0; i < 60; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() + i)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const override = hostOverrides.find(o => o.date === dateStr)
      if (override?.type === 'blocked') continue
      if (override?.type === 'custom') { dates.push(date); continue }
      const dayOfWeek = getDayOfWeek(date)
      if (hostAvailability[dayOfWeek]?.isAvailable) dates.push(date)
    }
    return dates
  }, [hostAvailability, hostOverrides])

  // Default to today or first bookable day so the right column shows times + Your Schedule on load (matches BookingPage)
  useEffect(() => {
    if (hasInitializedSelectedDateRef.current) return
    if (availableDates.length === 0) return
    const today = getStartOfToday()
    const todayInList = availableDates.find(d => d.toDateString() === today.toDateString())
    if (todayInList) {
      setSelectedDate(today)
      hasInitializedSelectedDateRef.current = true
      return
    }
    const sorted = [...availableDates].sort((a, b) => a.getTime() - b.getTime())
    const first = sorted[0]
    if (first) {
      setSelectedDate(first)
      hasInitializedSelectedDateRef.current = true
    }
  }, [availableDates])

  // Fetch busy times when a date is selected
  useEffect(() => {
    if (!selectedDate || !booking?.hostUserId) {
      setCalendarBusyTimes([])
      setCanShowTimeSlots(false)
      return
    }
    let cancelled = false
    busyTimesLoadStartRef.current = Date.now()
    setBusyTimesLoading(true)
    setCanShowTimeSlots(false)

    const bounds = getZonedDayUtcRange(selectedDate, bookerTimezone)
    if (!bounds) {
      setCalendarBusyTimes([])
      setBusyTimesLoading(false)
      return
    }

    getBusyTimes({ hostUserId: booking.hostUserId, dateStart: bounds.start.toISOString(), dateEnd: bounds.end.toISOString() })
      .then(result => {
        if (cancelled) return
        setCalendarBusyTimes(result.success && result.busyTimes ? result.busyTimes : [])
      })
      .catch(() => { if (!cancelled) setCalendarBusyTimes([]) })
      .finally(() => { if (!cancelled) setBusyTimesLoading(false) })

    return () => { cancelled = true }
  }, [selectedDate, booking?.hostUserId, getBusyTimes, bookerTimezone])

  // Enforce minimum 250ms spinner to prevent flash
  useEffect(() => {
    if (busyTimesLoading) return
    const start = busyTimesLoadStartRef.current ?? Date.now()
    const elapsed = Date.now() - start
    const remaining = Math.max(0, 250 - elapsed)
    const timer = setTimeout(() => {
      setCanShowTimeSlots(true)
      busyTimesLoadStartRef.current = null
    }, remaining)
    return () => clearTimeout(timer)
  }, [busyTimesLoading])

  // Logged-in user's calendar events for the selected day (mirrors BookingPage)
  useEffect(() => {
    if (!selectedDate || !user?.id) {
      setGuestCalendarEvents([])
      return
    }
    let cancelled = false
    setGuestEventsLoading(true)
    const bounds = getZonedDayUtcRange(selectedDate, bookerTimezone)
    if (!bounds) {
      setGuestCalendarEvents([])
      setGuestEventsLoading(false)
      return
    }
    const startIso = bounds.start.toISOString()
    const endIso = bounds.end.toISOString()

    const dsPromise = getCalendarEvents({
      userId: user.id,
      dateStart: startIso,
      dateEnd: endIso,
    }).then(r => (r.success && r.events ? r.events : []))
      .catch(() => [] as GuestCalendarEvent[])

    const googlePromise = getGoogleEvents(startIso, endIso)
      .then(events =>
        (events as Array<{ start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; summary?: string }>).map((ev): GuestCalendarEvent => ({
          start: ev.start?.dateTime || ev.start?.date || '',
          end: ev.end?.dateTime || ev.end?.date || '',
          title: ev.summary || 'Busy',
          source: 'google',
        })).filter(e => e.start && e.end)
      )
      .catch(() => [] as GuestCalendarEvent[])

    Promise.all([dsPromise, googlePromise])
      .then(([dsEvents, googleEvents]) => {
        if (cancelled) return
        const merged = [...dsEvents, ...googleEvents].sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
        )
        setGuestCalendarEvents(merged)
      })
      .finally(() => {
        if (!cancelled) setGuestEventsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDate, user?.id, getCalendarEvents, getGoogleEvents, bookerTimezone])

  // Available time slots for selected date
  const timeSlots = useMemo(() => {
    if (!selectedDate || !eventType) return []
    return getAvailableSlots(selectedDate, bookerTimezone, hostAvailability, durationMinutes, hostBookingsExcludingCurrent, {
      bufferBefore: eventType.bufferBefore,
      bufferAfter: eventType.bufferAfter,
      overrides: hostOverrides,
      calendarBusyTimes,
      maxAttendees: eventType.maxAttendees,
    })
  }, [selectedDate, bookerTimezone, eventType, hostAvailability, hostBookingsExcludingCurrent, hostOverrides, calendarBusyTimes, durationMinutes])

  const conflictsBySlot = useMemo(() => {
    if (guestCalendarEvents.length === 0) return new Map<string, GuestCalendarEvent>()
    const map = new Map<string, GuestCalendarEvent>()
    for (const slotIso of timeSlots) {
      const slotStart = new Date(slotIso).getTime()
      const slotEnd = slotStart + durationMinutes * 60000
      const conflict = guestCalendarEvents.find(evt => {
        const evtStart = new Date(evt.start).getTime()
        const evtEnd = new Date(evt.end).getTime()
        return slotStart < evtEnd && slotEnd > evtStart
      })
      if (conflict) map.set(slotIso, conflict)
    }
    return map
  }, [timeSlots, guestCalendarEvents, durationMinutes])

  const hoveredScheduleConflict = useMemo(() => {
    if (!hoveredSlot) return null
    return conflictsBySlot.get(hoveredSlot) ?? null
  }, [hoveredSlot, conflictsBySlot])

  const handleSubmit = async () => {
    if (!bookingId || !booking || !selectedDate || !selectedSlotIso || !email || !reasonForChange) return
    setIsSubmitting(true)
    setSubmitError(null)
    const oldStartTime = booking.startTime
    const oldEndTime = booking.endTime
    try {
      const newStart = new Date(selectedSlotIso)
      if (isNaN(newStart.getTime())) {
        setSubmitError('Invalid time selection. Please pick a slot again.')
        return
      }
      const newEnd = new Date(newStart.getTime() + durationMinutes * 60_000)

      const result = await rescheduleBooking({
        bookingId,
        newStartTime: newStart.toISOString(),
        rescheduleEmail: email,
        reasonForChange,
      })

      if (!result.success) {
        setSubmitError(result.error ?? 'Failed to reschedule. Please try again.')
        return
      }

      // Sync local RecordRoom state so Meetings detail panel shows email/reason immediately
      // (worker update may lag or omit fields in some environments)
      const auditEmail = email.trim()
      const auditReason = reasonForChange.trim()

      // Persist audit locally so Meetings detail panel still shows Rescheduled after close/reopen
      saveBookingRescheduleAudit(bookingId, {
        rescheduleEmail: auditEmail,
        reasonForChange: auditReason,
      })

      if (booking) {
        try {
          await putBookingRecordConfirmed(booking.id, {
            eventTypeId: booking.eventTypeId,
            eventTitle: booking.eventTitle,
            hostUserId: booking.hostUserId,
            hostName: booking.hostName,
            guestName: booking.guestName,
            guestEmail: booking.guestEmail,
            guestUserId: booking.guestUserId ?? '',
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
            meetingLink: booking.meetingLink ?? '',
            additionalInfo: booking.additionalInfo ?? '',
            answers: booking.answers ?? {},
            status: booking.status,
            seriesId: booking.seriesId ?? '',
            recurrence: booking.recurrence ?? '',
            rescheduleEmail: auditEmail,
            reasonForChange: auditReason,
          })
        } catch (syncErr) {
          console.warn('[BookMe] Local booking sync after reschedule failed:', syncErr)
        }
      }

      const hostEmailResolved =
        booking.hostEmail?.trim() || hostProfile?.email?.trim() || ''
      /** Guest wall clock at booking (same idea as confirmation). Host rescheduling must not use host UI TZ here. */
      const guestTimezoneForEmail =
        booking.guestTimezone?.trim() || bookerTimezone

      const notifyResult = await notifyReschedule({
        initiatedBy: user?.id === booking.hostUserId ? 'host' : 'guest',
        hostName: booking.hostName,
        hostEmail: hostEmailResolved,
        hostUserId: booking.hostUserId,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestUserId: booking.guestUserId,
        eventTitle: booking.eventTitle,
        oldStartTime,
        oldEndTime,
        newStartTime: newStart.toISOString(),
        newEndTime: newEnd.toISOString(),
        meetingLink: booking.meetingLink ?? '',
        additionalInfo: booking.additionalInfo,
        reasonForChange: auditReason,
        sendRescheduleEmailToo: eventType?.sendExternalEmail ?? true,
        sendDeepSpaceMail: eventType?.sendDeepSpaceMail ?? true,
        guestTimezone: guestTimezoneForEmail,
        hostTimezone: booking.hostTimezone?.trim() || hostAvailability.timezone,
      })
      if (!notifyResult.success) {
        showToast(
          notifyResult.error ??
            'Meeting was rescheduled but the other participant could not be notified.',
          'info',
        )
      }

      setRescheduleResult({
        newStartTime: newStart.toISOString(),
        newEndTime: newEnd.toISOString(),
        bookingId,
        rescheduleEmail: auditEmail,
        reasonForChange: auditReason,
      })
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!bookingsReady || !profilesReady) {
    return (
      <ReschedulePageChrome onBack={goToMeetings}>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-[#E5E7EB] border-t-black rounded-full animate-spin" aria-hidden />
        </div>
      </ReschedulePageChrome>
    )
  }

  // ── Empty / invalid state (redirect handled via useEffect, this is a fallback) ──
  if (!booking || !hostProfile) {
    return (
      <ReschedulePageChrome onBack={goToMeetings}>
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            title="Meeting not found"
            description="This meeting doesn't exist or cannot be rescheduled."
            action={<Button onClick={goToMeetings}>Back to Meetings</Button>}
          />
        </div>
      </ReschedulePageChrome>
    )
  }

  // ── Success screen ────────────────────────────────────────────────────────────
  if (rescheduleResult) {
    return (
      <ReschedulePageChrome onBack={goToMeetings}>
        <ConfirmationScreen
          bookingId={rescheduleResult.bookingId}
          newStartTime={rescheduleResult.newStartTime}
          newEndTime={rescheduleResult.newEndTime}
          rescheduleEmail={rescheduleResult.rescheduleEmail}
          reasonForChange={rescheduleResult.reasonForChange}
        />
      </ReschedulePageChrome>
    )
  }

  // ── Main reschedule flow ──────────────────────────────────────────────────────
  return (
    <ReschedulePageChrome onBack={goToMeetings}>
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-6xl app-card overflow-hidden flex flex-col md:flex-row min-h-[600px] shadow-lg">
        {/* Left column */}
        <LeftPanel
          hostName={hostProfile.name}
          hostImageUrl={hostProfile.imageUrl}
          eventTitle={booking.eventTitle}
          durationMinutes={durationMinutes}
          description={eventType?.description}
          formerStartTime={booking.startTime}
          formerEndTime={booking.endTime}
          selectedDate={selectedDate}
          selectedSlotIso={selectedSlotIso}
        />

        {/* Right column: calendar + time slots + details form — min-w-0 for Your Schedule horizontal scroll */}
        <div className="flex-1 min-w-0 p-8 flex flex-col">
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Step 1 & 2: same layout as BookingPage — narrow calendar | time choices */}
            <div
              className={`flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8 flex-1 min-h-0 ${
                panelState === 'exiting' ? 'booking-panel-out-left' :
                panelState === 'calendar' ? '' : 'hidden'
              }`}
            >
              {/* Left: calendar + timezone — max width matches schedule page */}
              <div className="w-full max-w-[min(100%,320px)] shrink-0 flex flex-col">
                <h2 className="text-lg font-bold text-[#111827] mb-4 uppercase tracking-wider">Select a New Date</h2>
                <Calendar
                  selected={selectedDate}
                  onSelect={date => {
                    setSelectedDate(date)
                    setSelectedSlotIso(null)
                    setShowDetailsForm(false)
                    setPanelState('calendar')
                  }}
                  disabledDates={date => {
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    if (date < today) return true
                    return !availableDates.some(d => d.toDateString() === date.toDateString())
                  }}
                  minDate={new Date()}
                  renderDay={(date, _defaultEl, context) => {
                    const inMonth = context
                      ? date.getMonth() === context.month && date.getFullYear() === context.year
                      : true
                    if (!inMonth) return <span />

                    const todayDate = isToday(date)
                    const isAvailable = availableDates.some(d => d.toDateString() === date.toDateString())
                    const isSelected = selectedDate ? date.toDateString() === selectedDate.toDateString() : false
                    const disabled = context?.disabled ?? false

                    const btnClass = [
                      'w-9 h-9 rounded-full flex items-center justify-center text-sm transition-colors font-semibold',
                      isSelected
                        ? 'bg-black text-white'
                        : isAvailable
                          ? 'bg-[#E5E7EB] text-[#111827] hover:bg-[#D1D5DB] cursor-pointer'
                          : 'text-[#9CA3AF] cursor-not-allowed',
                    ].join(' ')

                    return (
                      <div className="flex flex-col items-center justify-center py-0.5">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => { if (!disabled) { setSelectedDate(date); setSelectedSlotIso(null) } }}
                          className={btnClass}
                        >
                          {date.getDate()}
                        </button>
                        {todayDate && <div className="w-1 h-1 rounded-full bg-black mt-0.5 shrink-0" />}
                      </div>
                    )
                  }}
                />

                <div className="flex items-center gap-2 text-sm font-medium text-[#6B7280] cursor-pointer hover:bg-[#F3F4F6] px-3 py-2 rounded-lg transition-colors mt-4">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <select
                    value={bookerTimezone}
                    onChange={e => setBookerTimezone(e.target.value)}
                    className="bg-transparent border-none outline-none cursor-pointer text-sm font-medium"
                    aria-label="Select timezone"
                  >
                    {COMMON_TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>{getTimezoneLabel(tz)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedDate ? (
                <div className="w-full flex-1 min-w-0 sm:min-w-[14rem] flex flex-col">
                  <div className="sm:mt-[3.25rem] text-sm font-bold text-[#111827]">
                    {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="mt-4 flex flex-col">
                    {!canShowTimeSlots ? (
                      <div className="flex items-center gap-2 text-[#6B7280] font-medium min-h-[120px] items-center justify-center">
                        <div className="w-5 h-5 border-2 border-[#E5E7EB] border-t-black rounded-full animate-spin shrink-0" />
                        <span>Checking availability...</span>
                      </div>
                    ) : timeSlots.length === 0 ? (
                      <p className="text-[#6B7280] text-sm font-medium">No available times on this date.</p>
                    ) : (
                      <div className="space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                        {timeSlots.map(slotIso => {
                          const isHighlighted = selectedSlotIso === slotIso
                          const conflict = conflictsBySlot.get(slotIso) ?? null
                          return (
                            <div key={slotIso} className="flex overflow-hidden rounded-xl">
                              <button
                                type="button"
                                onMouseEnter={() => { setHoveredSlot(slotIso) }}
                                onMouseLeave={() => { setHoveredSlot(null) }}
                                onClick={() => { setSelectedSlotIso(slotIso); setSubmitError(null) }}
                                className={`flex flex-1 min-w-0 items-center justify-center py-3 px-2 transition-all active:scale-[0.98] text-sm font-semibold ${
                                  isHighlighted
                                    ? 'bg-[#E5E7EB] text-[#111827] border border-[#D1D5DB] rounded-l-xl rounded-r-none'
                                    : 'bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#111827] rounded-xl border border-transparent'
                                }`}
                              >
                                <div className="flex flex-row items-center justify-center gap-1.5">
                                  <span className="shrink-0 w-4 h-4 inline-flex items-center justify-center" aria-hidden>
                                    {conflict ? (
                                      <AlertTriangle className="w-4 h-4 text-black" strokeWidth={2} />
                                    ) : null}
                                  </span>
                                  <span className="flex flex-col items-center text-center">
                                    {formatInstantInTimezone(slotIso, bookerTimezone)}
                                  </span>
                                </div>
                              </button>
                              <div className={`booking-next-wrapper shrink-0 ${isHighlighted ? 'open' : ''}`}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (panelTimerRef.current) clearTimeout(panelTimerRef.current)
                                    setPanelState('exiting')
                                    panelTimerRef.current = setTimeout(() => {
                                      setShowDetailsForm(true)
                                      setPanelState('details')
                                    }, 230)
                                  }}
                                  aria-label="Proceed to reschedule details"
                                  className="h-full w-20 bg-black text-white text-sm font-bold hover:bg-[#374151] transition-colors flex items-center justify-center gap-1 rounded-r-xl uppercase tracking-wider"
                                >
                                  Next
                                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Step 3: Reschedule details form */}
            {(showDetailsForm || panelState === 'returning') && selectedDate && selectedSlotIso && (
              <div
                className={`w-full flex-1 min-h-0 overflow-auto flex flex-col ${
                  panelState === 'details' ? 'booking-panel-in-right' :
                  panelState === 'returning' ? 'booking-panel-out-right' : ''
                }`}
              >
                <div className="space-y-6">
                  {/* Back button + summary */}
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (panelTimerRef.current) clearTimeout(panelTimerRef.current)
                        setPanelState('returning')
                        panelTimerRef.current = setTimeout(() => {
                          setShowDetailsForm(false)
                          setPanelState('calendar')
                        }, 230)
                      }}
                      className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#F3F4F6] text-[#6B7280] hover:text-[#111827] transition-colors shrink-0"
                      aria-label="Back to date selection"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div>
                      <p className="text-sm font-bold text-[#111827]">
                        {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </p>
                      <p className="text-xs text-[#6B7280] font-medium">{formatInstantInTimezone(selectedSlotIso, bookerTimezone)}</p>
                    </div>
                  </div>

                  <div className="app-card p-6">
                    <h2 className="text-lg font-bold text-[#111827] mb-4 uppercase tracking-wider">Confirm Reschedule</h2>
                    <div className="space-y-4">
                      <div>
                        <Input
                          label="Your Email *"
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@example.com"
                        />
                        {isLookingUpUser && (
                          <p className="text-xs text-[#6B7280] mt-1 font-medium">Looking up user...</p>
                        )}
                        {lookupResult?.found && (
                          <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-[var(--color-primary-muted)] text-[var(--color-primary)] text-xs font-bold">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            DeepSpace user
                          </span>
                        )}
                      </div>
                      <Textarea
                        label="Reason for Change *"
                        value={reasonForChange}
                        onChange={e => setReasonForChange(e.target.value)}
                        placeholder="Please let us know why you're rescheduling…"
                        rows={4}
                      />

                      {submitError && (
                        <div
                          data-testid="reschedule-error"
                          className="bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg p-3 text-sm text-[#dc2626] font-medium"
                        >
                          {submitError}
                        </div>
                      )}

                      <Button
                        onClick={handleSubmit}
                        disabled={!email || !reasonForChange || isSubmitting}
                        className="w-full app-btn-primary"
                      >
                        {isSubmitting ? 'Rescheduling…' : 'Confirm Reschedule'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Your Schedule — under calendar + time choices row (same as BookingPage) */}
          {user && selectedDate && panelState === 'calendar' && (
            <div className="mt-6 pt-5 border-t border-[#E5E7EB] w-full min-w-0 max-w-full">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-[#6B7280] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wider">Your Schedule</h3>
                {hoveredScheduleConflict ? (
                  <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-[#111827]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                    Conflict
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-medium text-[#9CA3AF] mb-2">
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              {guestEventsLoading ? (
                <div className="flex items-center gap-2 text-[#6B7280] py-2">
                  <div className="w-4 h-4 border-2 border-[#E5E7EB] border-t-black rounded-full animate-spin shrink-0" />
                  <span className="text-xs font-medium">Loading your calendar…</span>
                </div>
              ) : guestCalendarEvents.length === 0 ? (
                <p className="text-xs text-[#9CA3AF] font-medium">No events scheduled for this day</p>
              ) : (
                <div
                  className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x -mx-1 px-1 pb-1.5 custom-scrollbar"
                  role="region"
                  aria-label="Your events for this day"
                >
                  <div className="inline-flex flex-nowrap gap-1.5">
                    {guestCalendarEvents.map(evt => {
                      const isHighlighted =
                        hoveredScheduleConflict !== null &&
                        hoveredScheduleConflict.start === evt.start &&
                        hoveredScheduleConflict.end === evt.end
                      return (
                        <div
                          key={`${evt.start}-${evt.end}-${evt.source}`}
                          className={`shrink-0 w-[9rem] rounded-md border px-2 py-1.5 transition-colors ${
                            isHighlighted
                              ? 'border-[#D1D5DB] bg-[#E5E7EB]'
                              : 'border-[#E5E7EB] bg-[#F9FAFB]'
                          }`}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className={`inline-block text-[9px] font-bold tracking-wide px-1 py-px rounded whitespace-nowrap ${
                              evt.source === 'google'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {evt.source === 'google' ? 'Google Calendar' : 'DeepSpace'}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-[#111827] leading-snug line-clamp-2 min-h-[2.25rem]">
                            {evt.title}
                          </p>
                          <p className="text-xs text-[#6B7280] font-medium leading-tight mt-1 tabular-nums">
                            {formatInstantInTimezone(evt.start, bookerTimezone)}
                          </p>
                          <p className="text-xs text-[#6B7280] font-medium leading-tight tabular-nums">
                            {formatInstantInTimezone(evt.end, bookerTimezone)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </ReschedulePageChrome>
  )
}
