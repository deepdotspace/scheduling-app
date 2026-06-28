/**
 * Public Booking Page
 * 
 * Allows guests to book a meeting with a user
 * Route: /book/:username/:eventId
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarCheck } from 'lucide-react'
import { useUser } from 'deepspace'
import { useProfile, useEventTypes, useAvailability, useBookings, useBookingNotification, useUserLookup, useAvailabilityOverrides } from '../hooks'
import { useBookingCalendar, useGoogleCalendar } from '../sdk-connectors'
import { generateRoomId } from '../lib/room-id'
import { useBookMePlatform, type GuestCalendarEvent } from '../platform/BookMePlatformProvider'
import { Button, Input, Textarea, Avatar, EmptyState, Select, Calendar } from '../components/ui'
import { isToday } from '../components/ui/date-utils'
import { getAvailableSlots, getRemainingSpots, formatTime, formatInstantInTimezone, getDayOfWeek, buildVideoCallMeetingUrl, generateGoogleCalendarUrl, generateIcsContent, COMMON_TIMEZONES, getTimezoneLabel, RECURRENCE_OPTIONS } from '../constants'
import { getZonedDayUtcRange } from '../lib/zoned-time'
import type { Booking, BookingQuestion, RecurrenceType } from '../constants'

function getStartOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Persisted on the booking so the guest sees it under Meetings (`useBookings` filters by guestUserId).
 * Prefer the logged-in booker when the form email matches — directory lookup is debounced and often
 * has not finished before submit, or may not find the user.
 */
function resolveGuestUserIdForBooking(params: {
  hostUserId: string
  guestEmail: string
  currentUser: { id: string; email?: string | null } | null | undefined
  emailLookup: { found: boolean; userId?: string } | null
}): string | undefined {
  const { hostUserId, guestEmail, currentUser, emailLookup } = params
  const trimmed = guestEmail.trim()
  if (!trimmed) return undefined
  const cu = currentUser
  if (cu?.id && cu.id !== hostUserId && cu.email) {
    if (trimmed.toLowerCase() === cu.email.trim().toLowerCase()) return cu.id
  }
  // Directory lookup must not resolve to the host — same user would get two DS events
  // (host "with …" + guest "(booked)") in one calendar when booking your own link.
  if (emailLookup?.found && emailLookup.userId && emailLookup.userId !== hostUserId) {
    return emailLookup.userId
  }
  return undefined
}

export default function BookingPage() {
  const { username, eventId } = useParams<{ username: string; eventId?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromEventList = searchParams.get('from') === 'event-list'
  
  const { user: currentUser } = useUser()
  const { profiles, getProfileByUsername, ready: profilesReady } = useProfile()
  const { bookings } = useBookings()
  const { createBookingEvent, isCreating: isCreatingEvent } = useBookingCalendar()
  const { scheduleCalendarEvent, getBusyTimes, getCalendarEvents } = useBookMePlatform()
  const { getEvents: getGoogleEvents } = useGoogleCalendar()
  const { notify } = useBookingNotification()

  const [selectedDate, setSelectedDate] = useState<Date | null>(() => getStartOfToday())
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null)
  const [showDetailsForm, setShowDetailsForm] = useState(false)
  // 'calendar' | 'exiting' | 'details' | 'returning'
  const [panelState, setPanelState] = useState<'calendar' | 'exiting' | 'details' | 'returning'>('calendar')
  const panelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    additionalInfo: '',
  })
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string | boolean>>({})
  const [bookerTimezone, setBookerTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none')
  const [sendEmailToo, setSendEmailToo] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingComplete, setBookingComplete] = useState<(Booking & { totalOccurrences?: number }) | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [calendarBusyTimes, setCalendarBusyTimes] = useState<Array<{ start: string; end: string }>>([])
  const [busyTimesLoading, setBusyTimesLoading] = useState(false)
  const busyTimesLoadStartRef = useRef<number | null>(null)
  const [canShowTimeSlots, setCanShowTimeSlots] = useState(false)
  const [guestCalendarEvents, setGuestCalendarEvents] = useState<GuestCalendarEvent[]>([])
  const [guestEventsLoading, setGuestEventsLoading] = useState(false)
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null)

  // Debounced user lookup by email
  const { isLooking: isLookingUpUser, result: lookupResult } = useUserLookup(formData.email)

  // Auto-fill guest email and name from logged-in DeepSpace account (does not overwrite typed fields)
  useEffect(() => {
    const loginEmail = currentUser?.email?.trim()
    const loginName = currentUser?.name?.trim()
    setFormData(prev => {
      const nextEmail = loginEmail && !prev.email.trim() ? loginEmail : prev.email
      const nextName = loginName && !prev.name.trim() ? loginName : prev.name
      if (nextEmail === prev.email && nextName === prev.name) return prev
      return { ...prev, email: nextEmail, name: nextName }
    })
  }, [currentUser?.email, currentUser?.name])

  // Auto-populate name from directory lookup when not logged in or name not yet on session (does not overwrite typed name)
  useEffect(() => {
    if (!lookupResult?.found || !lookupResult.name) return
    setFormData(prev => {
      if (prev.name.trim()) return prev
      return { ...prev, name: lookupResult.name! }
    })
  }, [lookupResult])

  // Find the host user
  const hostProfile = useMemo(() => {
    if (!username) return null
    return getProfileByUsername(username)
  }, [username, getProfileByUsername, profiles])

  // Load the HOST's event types, availability, and overrides (not the current viewer's)
  const { eventTypes: hostEventTypes, ready: eventTypesReady } = useEventTypes(hostProfile?.id)
  const { availability: hostDefaultAvailability, getScheduleById: getHostSchedule } = useAvailability(hostProfile?.id)
  const { overrides: hostOverrides } = useAvailabilityOverrides(hostProfile?.id)

  // Find the event type
  const eventType = useMemo(() => {
    if (!eventId) return null
    return hostEventTypes.find(et => et.id === eventId && et.isActive)
  }, [eventId, hostEventTypes])

  // Use the event type's assigned schedule, or fall back to the default
  const hostAvailability = useMemo(() => {
    if (eventType?.availabilityScheduleId) {
      const schedule = getHostSchedule(eventType.availabilityScheduleId)
      if (schedule) return schedule
    }
    return hostDefaultAvailability
  }, [eventType, getHostSchedule, hostDefaultAvailability])
  
  // Get active event types for the host
  const activeHostEventTypes = useMemo(() => {
    return hostEventTypes.filter(et => et.isActive)
  }, [hostEventTypes])
  
  // Effective duration: user-selected or default
  const effectiveDuration = useMemo(() => {
    if (!eventType) return 30
    if (eventType.durations.length > 0) {
      return selectedDuration ?? eventType.durations[0]
    }
    return eventType.duration
  }, [eventType, selectedDuration])

  // Fetch calendar busy times when a date is selected
  useEffect(() => {
    if (!selectedDate || !hostProfile) {
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

    getBusyTimes({
      hostUserId: hostProfile.id,
      dateStart: bounds.start.toISOString(),
      dateEnd: bounds.end.toISOString(),
    }).then(result => {
      if (cancelled) return
      if (result.success && result.busyTimes) {
        setCalendarBusyTimes(result.busyTimes)
      } else {
        setCalendarBusyTimes([])
      }
    }).catch(() => {
      if (!cancelled) setCalendarBusyTimes([])
    }).finally(() => {
      if (!cancelled) setBusyTimesLoading(false)
    })

    return () => { cancelled = true }
  }, [selectedDate, hostProfile, getBusyTimes, bookerTimezone])

  // Minimum 250ms loading state before showing slots — prevents flash when fetch is fast
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

  // Logged-in guest’s calendar events for the selected day (matches ReschedulePage)
  useEffect(() => {
    if (!selectedDate || !currentUser?.id) {
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
      userId: currentUser.id,
      dateStart: startIso,
      dateEnd: endIso,
    }).then(r => (r.success && r.events ? r.events : []))
      .catch(() => [] as GuestCalendarEvent[])

    const googlePromise = getGoogleEvents(startIso, endIso)
      .then(events => {
        return (events as Array<{ start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; summary?: string }>).map((ev): GuestCalendarEvent => ({
          start: ev.start?.dateTime || ev.start?.date || '',
          end: ev.end?.dateTime || ev.end?.date || '',
          title: ev.summary || 'Busy',
          source: 'google',
        })).filter(e => e.start && e.end)
      })
      .catch((err) => {
        console.warn('[BookMe] Google Calendar fetch failed:', err)
        return [] as GuestCalendarEvent[]
      })

    Promise.all([dsPromise, googlePromise])
      .then(([dsEvents, googleEvents]) => {
        if (cancelled) return
        console.log('[BookMe] Your Schedule merged:', dsEvents.length, 'DS +', googleEvents.length, 'Google')
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
  }, [selectedDate, currentUser?.id, getCalendarEvents, getGoogleEvents, bookerTimezone])

  // Calculate available dates (next 60 days with availability)
  const availableDates = useMemo(() => {
    const dates: Date[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let i = 0; i < 60; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() + i)

      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const override = hostOverrides.find(o => o.date === dateStr)

      // If blocked, skip this date
      if (override?.type === 'blocked') continue
      // If custom override, include it regardless of weekly schedule
      if (override?.type === 'custom') {
        dates.push(date)
        continue
      }

      const dayOfWeek = getDayOfWeek(date)
      if (hostAvailability[dayOfWeek]?.isAvailable) {
        dates.push(date)
      }
    }

    return dates
  }, [hostAvailability, hostOverrides])

  // Host's confirmed bookings (used for slot generation and remaining spots)
  const hostBookings = useMemo(() => {
    return hostProfile
      ? bookings.filter(b => b.hostUserId === hostProfile.id && b.status === 'confirmed')
      : []
  }, [bookings, hostProfile])

  const isGroupEvent = (eventType?.maxAttendees ?? 0) > 1

  // Get available time slots for selected date
  const timeSlots = useMemo(() => {
    if (!selectedDate || !eventType) return []

    return getAvailableSlots(selectedDate, bookerTimezone, hostAvailability, effectiveDuration, hostBookings, {
      bufferBefore: eventType.bufferBefore,
      bufferAfter: eventType.bufferAfter,
      overrides: hostOverrides,
      calendarBusyTimes,
      maxAttendees: eventType.maxAttendees,
    })
  }, [selectedDate, bookerTimezone, eventType, hostAvailability, hostBookings, hostOverrides, calendarBusyTimes, effectiveDuration])

  const conflictsBySlot = useMemo(() => {
    if (guestCalendarEvents.length === 0) return new Map<string, GuestCalendarEvent>()
    const map = new Map<string, GuestCalendarEvent>()
    for (const slotIso of timeSlots) {
      const slotStart = new Date(slotIso).getTime()
      const slotEnd = slotStart + effectiveDuration * 60000
      const conflict = guestCalendarEvents.find(evt => {
        const evtStart = new Date(evt.start).getTime()
        const evtEnd = new Date(evt.end).getTime()
        return slotStart < evtEnd && slotEnd > evtStart
      })
      if (conflict) map.set(slotIso, conflict)
    }
    return map
  }, [timeSlots, guestCalendarEvents, effectiveDuration])

  const hoveredScheduleConflict = useMemo(() => {
    if (!hoveredSlot) return null
    return conflictsBySlot.get(hoveredSlot) ?? null
  }, [hoveredSlot, conflictsBySlot])

  const handleSubmit = async () => {
    if (!selectedDate || !selectedSlotIso || !eventType || !hostProfile) return
    if (!formData.name || !formData.email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setBookingError('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)
    try {
      const startTime = new Date(selectedSlotIso)
      if (isNaN(startTime.getTime())) {
        setBookingError('Invalid time selection. Please pick a slot again.')
        return
      }
      const endTime = new Date(startTime.getTime() + effectiveDuration * 60000)

      const occurrences: Array<{ start: Date; end: Date }> = [{ start: startTime, end: endTime }]
      if (recurrence !== 'none') {
        const count = recurrence === 'monthly' ? 3 : 4
        const MS_DAY = 86400000
        for (let i = 1; i < count; i++) {
          let nextStart: Date
          if (recurrence === 'weekly') {
            nextStart = new Date(startTime.getTime() + 7 * i * MS_DAY)
          } else if (recurrence === 'biweekly') {
            nextStart = new Date(startTime.getTime() + 14 * i * MS_DAY)
          } else {
            nextStart = new Date(startTime)
            nextStart.setMonth(nextStart.getMonth() + i)
          }
          const nextEnd = new Date(nextStart.getTime() + effectiveDuration * 60000)
          occurrences.push({ start: nextStart, end: nextEnd })
        }
      }

      const seriesId = recurrence !== 'none' ? `series-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` : undefined
      const guestUserId = resolveGuestUserIdForBooking({
        hostUserId: hostProfile.id,
        guestEmail: formData.email,
        currentUser,
        emailLookup: lookupResult,
      })
      let firstBooking: { startTime: string; endTime: string; meetingLink: string } | null = null
      let eventTypeToggles:
        | { sendDeepSpaceMail: boolean; sendExternalEmail: boolean; sendGoogleCalendarInvite: boolean }
        | undefined

      const useGoogleCalendarApi = eventType.sendGoogleCalendarInvite === true

      for (let idx = 0; idx < occurrences.length; idx++) {
        const occ = occurrences[idx]

        // 1. Meeting link + optional Google Calendar API (invite) — only when event type enables it
        // 'google-meet' is no longer an offered location, but legacy event types may still have it.
        const useGoogleMeet = (eventType.location as string) === 'google-meet'
        let meetingLink: string

        if (useGoogleMeet) {
          if (useGoogleCalendarApi) {
            const calendarDescription = formData.additionalInfo || 'Booked via BookWithMe'
            const calendarResult = await createBookingEvent({
              hostClerkUserId: hostProfile.id,
              title: `${eventType.title} with ${formData.name}`,
              description: calendarDescription,
              startTime: occ.start.toISOString(),
              endTime: occ.end.toISOString(),
              guestEmail: formData.email,
              addVideoConferencing: true,
            })

            if (calendarResult.success && calendarResult.meetLink) {
              meetingLink = calendarResult.meetLink
            } else {
              if (calendarResult.hostNotConnected) {
                console.warn('Host calendar not connected — falling back to DeepSpace Meets')
              } else if (!calendarResult.success) {
                console.warn('Failed to create Google Meet link:', calendarResult.error, '— falling back to DeepSpace Meets')
              }
              const roomId = generateRoomId()
              meetingLink = buildVideoCallMeetingUrl(roomId)
            }
          } else {
            const roomId = generateRoomId()
            meetingLink = buildVideoCallMeetingUrl(roomId)
          }
        } else {
          const roomId = generateRoomId()
          meetingLink = buildVideoCallMeetingUrl(roomId)

          if (useGoogleCalendarApi) {
            const calendarDescription = `${formData.additionalInfo || 'Booked via BookWithMe'}\n\nJoin meeting: ${meetingLink}`
            const calendarResult = await createBookingEvent({
              hostClerkUserId: hostProfile.id,
              title: `${eventType.title} with ${formData.name}`,
              description: calendarDescription,
              startTime: occ.start.toISOString(),
              endTime: occ.end.toISOString(),
              guestEmail: formData.email,
              addVideoConferencing: false,
            })

            if (calendarResult.hostNotConnected) {
              console.warn('Host calendar not connected — booking proceeds without Google Calendar event')
            } else if (!calendarResult.success) {
              console.warn('Failed to create calendar event:', calendarResult.error)
            }
          }
        }

        // 2. Schedule booking via server action
        const platformCalDescription = `${formData.additionalInfo || 'Booked via BookWithMe'}\n\nJoin meeting: ${meetingLink}`
        try {
          const scheduleResult = await scheduleCalendarEvent({
            hostUserId: hostProfile.id,
            eventTypeId: eventType.id,
            startTime: occ.start.toISOString(),
            guestEmail: formData.email,
            guestName: formData.name,
            hostName: hostProfile.name,
            hostEmail: hostProfile.email,
            description: platformCalDescription,
            guestUserId,
            meetingLink,
            seriesId,
            recurrence: idx === 0 ? recurrence : undefined,
            additionalInfo: formData.additionalInfo || undefined,
            answers: Object.keys(questionAnswers).length > 0 ? questionAnswers : undefined,
            guestTimezone: bookerTimezone,
            // Guest-selected duration for multi-duration event types; server validates it against the
            // event type's configured durations and computes the authoritative endTime from it.
            duration: effectiveDuration,
            // App origin so the server can embed a guest manage/cancel link in the confirmation email.
            origin: typeof window !== 'undefined' ? window.location.origin : undefined,
            // Occurrence gate: only the first occurrence of a recurring series sends confirmation email
            // (so the host isn't emailed once per occurrence).
            sendConfirmationEmail: idx === 0,
            // Guest's per-booking "Also send email notification" choice — gates only the guest's copy.
            sendGuestEmail: sendEmailToo,
          })
          if (!scheduleResult.success) {
            if (idx === 0) {
              setBookingError(scheduleResult.error || 'This time slot is no longer available. Please select a different time.')
              return
            }
            console.warn(`[BookMe] Recurring booking #${idx + 1} failed:`, scheduleResult.error)
            continue
          }
          if (idx === 0) eventTypeToggles = scheduleResult.eventType
        } catch (err) {
          if (idx === 0) {
            console.warn('[BookMe] Platform calendar scheduling failed:', err)
            setBookingError('Failed to schedule the meeting. Please try again.')
            return
          }
          console.warn(`[BookMe] Recurring booking #${idx + 1} failed:`, err)
          continue
        }

        if (idx === 0) {
          firstBooking = { startTime: occ.start.toISOString(), endTime: occ.end.toISOString(), meetingLink }
        }
      }

      if (!firstBooking) return

      // 3. Build booking object for confirmation UI
      const booking = {
        id: `${Date.now()}`,
        eventTypeId: eventType.id,
        eventTitle: eventType.title,
        guestName: formData.name,
        guestEmail: formData.email,
        guestUserId,
        startTime: firstBooking.startTime,
        endTime: firstBooking.endTime,
        meetingLink: firstBooking.meetingLink,
        additionalInfo: formData.additionalInfo,
        hostUserId: hostProfile.id,
        hostName: hostProfile.name,
        status: 'confirmed' as const,
        createdAt: new Date().toISOString(),
        seriesId,
        recurrence: recurrence !== 'none' ? recurrence : undefined,
        totalOccurrences: occurrences.length,
      }

      // 4. Notify guest (only for the first occurrence). Transactional email is sent server-side by
      // the schedule action; this notify() handles in-app DeepSpace Mail for internal guests.
      const dsmOn =
        eventTypeToggles?.sendDeepSpaceMail ?? eventType?.sendDeepSpaceMail ?? false
      try {
        const recurrenceNote = recurrence !== 'none'
          ? `\n\nThis is a recurring ${recurrence} meeting (${occurrences.length} total).`
          : ''
        await notify({
          hostUserId: hostProfile.id,
          hostName: hostProfile.name,
          hostEmail: hostProfile.email,
          guestName: formData.name,
          guestEmail: formData.email,
          guestUserId,
          eventTitle: eventType.title,
          startTime: firstBooking.startTime,
          endTime: firstBooking.endTime,
          meetingLink: firstBooking.meetingLink,
          additionalInfo: (formData.additionalInfo || '') + recurrenceNote,
          sendDeepSpaceMail: dsmOn,
          guestTimezone: bookerTimezone,
          hostTimezone: hostAvailability.timezone,
        })
      } catch (err) {
        console.warn('[BookMe] Guest notification failed:', err)
      }

      // 5. Show confirmation
      setBookingComplete(booking)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  // If no username provided
  if (!username) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
        <EmptyState
          title="Invalid booking link"
          description="Please check the URL and try again."
          icon={
            <svg className="w-12 h-12 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
      </div>
    )
  }
  
  // Profiles still syncing — avoid flashing "User not found"
  if (!profilesReady) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#E5E7EB] border-t-black rounded-full animate-spin shrink-0" />
          <p className="text-sm font-medium text-[#6B7280]">Loading booking page…</p>
        </div>
      </div>
    )
  }

  // User not found (after profiles have loaded)
  if (!hostProfile) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
        <EmptyState
          title="User not found"
          description="This booking page doesn't exist or the user hasn't set up their profile yet."
          icon={
            <svg className="w-12 h-12 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          }
        />
      </div>
    )
  }
  
  // Show event type selection if no specific event (Aura-scheduling style)
  if (!eventId) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] py-12 px-4 flex flex-col items-center">
        <div className="max-w-2xl mx-auto space-y-8 flex-1 w-full">
          <div className="text-center">
            <Avatar name={hostProfile.name} imageUrl={hostProfile.imageUrl} size="lg" />
            <h1 className="text-2xl font-bold text-[#111827] tracking-tight">{hostProfile.name}</h1>
            {hostProfile.bio ? (
              <p className="text-[#6B7280] mt-2 font-medium">{hostProfile.bio}</p>
            ) : null}
            <p className="text-[#6B7280] mt-4 font-medium max-w-md mx-auto">
              This is a scheduling page. Please follow the instructions and schedule an event through DeepSpace.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-[#111827] text-center">Select an event type</h2>
            {!eventTypesReady ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <div className="w-9 h-9 border-2 border-[#E5E7EB] border-t-black rounded-full animate-spin shrink-0" />
                <p className="text-sm font-medium text-[#6B7280]">Loading events…</p>
              </div>
            ) : activeHostEventTypes.length === 0 ? (
              <EmptyState
                title="No events available"
                description="This user hasn't created any event types yet."
              />
            ) : (
              <div className="grid gap-4">
                {activeHostEventTypes.map(et => (
                  <button
                    key={et.id}
                    onClick={() => navigate(`/book/${username}/${et.id}?from=event-list`)}
                    className="app-card p-5 text-left hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="w-2 h-full rounded-full min-h-[60px] shrink-0"
                        style={{ backgroundColor: et.color }}
                      />
                      <div className="flex-1">
                        <h3 className="font-semibold text-[#111827] group-hover:text-[#374151] transition-colors">
                          {et.title}
                        </h3>
                        <p className="text-sm text-[#6B7280] mt-1 font-medium">{et.description?.trim() || 'No description provided'}</p>
                        <p className="text-sm text-[#6B7280] mt-2 font-medium tracking-tight">
                          {et.durations.length > 0
                            ? et.durations.filter(d => d > 0).map(d => `${d} min`).join(' / ') || '30 min'
                            : `${et.duration > 0 ? et.duration : 30} minutes`}
                        </p>
                      </div>
                      <svg className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#6B7280] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Powered By Badge — small block centered at bottom */}
        <div className="mt-8 flex items-center justify-center">
          <div className="flex items-center gap-2 app-card px-4 py-2 w-fit">
            <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest">Powered by</span>
            <div className="flex items-center gap-1.5 text-[#111827]">
              <CalendarCheck className="w-3.5 h-3.5" strokeWidth={2} />
              <span className="text-sm font-bold tracking-tight">BookWithMe</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Event types still loading for /book/:user/:eventId — avoid flashing "not found"
  if (!eventTypesReady) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#E5E7EB] border-t-black rounded-full animate-spin shrink-0" />
          <p className="text-sm font-medium text-[#6B7280]">Loading event…</p>
        </div>
      </div>
    )
  }

  // Event type not found (query finished, id missing or inactive)
  if (!eventType) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
        <EmptyState
          title="Event type not found"
          description="This event type doesn't exist or is no longer available."
          icon={
            <svg className="w-12 h-12 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
          action={
            fromEventList ? (
              <Button onClick={() => navigate(`/book/${username}`)}>
                View All Events
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }
  
  // Booking Complete
  if (bookingComplete) {
    const gcalUrl = generateGoogleCalendarUrl({
      title: `${bookingComplete.eventTitle} with ${bookingComplete.hostName}`,
      startTime: bookingComplete.startTime,
      endTime: bookingComplete.endTime,
      description: `Join meeting: ${bookingComplete.meetingLink ?? ''}`,
      location: bookingComplete.meetingLink,
    })

    const handleDownloadIcs = () => {
      const icsContent = generateIcsContent({
        title: `${bookingComplete.eventTitle} with ${bookingComplete.hostName}`,
        startTime: bookingComplete.startTime,
        endTime: bookingComplete.endTime,
        description: `Join meeting: ${bookingComplete.meetingLink ?? ''}`,
        location: bookingComplete.meetingLink,
      })
      const blob = new Blob([icsContent], { type: 'text/calendar' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${bookingComplete.eventTitle.replace(/\s+/g, '-')}.ics`
      a.click()
      URL.revokeObjectURL(url)
    }

    const handleCopyLink = () => {
      if (bookingComplete.meetingLink) {
        navigator.clipboard.writeText(bookingComplete.meetingLink)
      }
    }

    return (
      <div className="min-h-screen bg-[#F3F4F6] py-12 px-4">
        <div className="max-w-lg mx-auto">
          <div className="app-card p-8 text-center border-[#10b981]/30">
            <div className="w-16 h-16 bg-[#10b981]/15 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#10b981]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-[#111827] tracking-tight mb-2">Booking Confirmed!</h2>
            <p className="text-[#6B7280] font-medium mb-6">
              {bookingComplete.totalOccurrences && bookingComplete.totalOccurrences > 1
                ? `${bookingComplete.totalOccurrences} ${bookingComplete.recurrence} meetings have been scheduled. You'll receive a confirmation email shortly.`
                : "You'll receive a confirmation email shortly."}
            </p>

            <div className="bg-[#F3F4F6] rounded-xl p-4 text-left space-y-3 border border-[#E5E7EB]">
              <div>
                <p className="text-xs text-[#6B7280] font-medium">Event</p>
                <p className="text-[#111827] font-semibold">{bookingComplete.eventTitle}</p>
              </div>
              <div>
                <p className="text-xs text-[#6B7280] font-medium">With</p>
                <p className="text-[#111827] font-semibold">{bookingComplete.hostName}</p>
              </div>
              <div>
                <p className="text-xs text-[#6B7280] font-medium">When</p>
                <p className="text-[#111827] font-semibold">
                  {new Date(bookingComplete.startTime).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
                <p className="text-[#6B7280] font-medium">
                  {formatTime(bookingComplete.startTime)} - {formatTime(bookingComplete.endTime)}
                </p>
              </div>

              {bookingComplete.meetingLink && (
                <div>
                  <p className="text-xs text-[#6B7280] font-medium">Meeting Link</p>
                  <a
                    href={bookingComplete.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-app-text)] font-semibold hover:underline break-all"
                  >
                    {bookingComplete.meetingLink}
                  </a>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-6 justify-center">
              <a href={gcalUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Add to Google Calendar
                </Button>
              </a>
              <Button variant="secondary" size="sm" onClick={handleDownloadIcs}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download .ics
              </Button>
              {bookingComplete.meetingLink && (
                <Button variant="secondary" size="sm" onClick={handleCopyLink}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  Copy Meeting Link
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // Main Booking Flow — Aura-scheduling style
  return (
    <div data-testid="booking-page" className="min-h-screen bg-[#F3F4F6] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-6xl app-card overflow-hidden flex flex-col md:flex-row min-h-[600px] shadow-lg">
        {/* Left Column: Event Info */}
        <div className="w-full md:w-2/5 p-12 space-y-8 border-r border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#E5E7EB] overflow-hidden shrink-0">
              {hostProfile.imageUrl ? (
                <img src={hostProfile.imageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#6B7280] font-medium">
                  {(hostProfile.name ?? 'U').charAt(0)}
                </div>
              )}
            </div>
            <span className="text-lg font-medium text-[#111827]">{hostProfile.name}</span>
          </div>

          <h1 className="text-4xl font-bold text-[#111827] leading-tight tracking-tight">{eventType.title}</h1>

          <div className="flex items-center gap-2 text-[#6B7280] bg-[#F3F4F6] w-fit px-3 py-1.5 rounded-lg border border-[#E5E7EB] font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium tracking-tight">
              {eventType.durations.length > 0
                ? eventType.durations.filter(d => d > 0).map(d => `${d} min`).join(' / ') || '30 min'
                : `${eventType.duration > 0 ? eventType.duration : 30} minutes`}
            </span>
          </div>

          <div className="space-y-4 text-[#6B7280] leading-relaxed font-medium">
            <p className="text-sm">
              {eventType.description?.trim() && eventType.description.trim() !== '0'
                ? eventType.description.trim()
                : 'No description provided'}
            </p>
            {isGroupEvent && eventType.maxAttendees > 0 && (
              <p className="text-sm">Group event (up to {eventType.maxAttendees} attendees)</p>
            )}
            {!!eventType.isRoundRobin && (
              <p className="text-sm">You'll be paired with a team member</p>
            )}
          </div>

          {fromEventList && (
            <button
              onClick={() => navigate(`/book/${username}`)}
              className="text-sm text-[var(--color-app-text)] font-bold hover:underline flex items-center gap-2 pt-8 uppercase tracking-wider"
            >
              <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Back to event selection
            </button>
          )}
        </div>

        {/* Right Column: Calendar & Time Slots */}
        <div className="flex-1 min-w-0 p-8 flex flex-col">
          {/* Duration Selector (if multiple durations) */}
          {eventType.durations.filter(d => d > 0).length > 1 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-[#111827] mb-2 uppercase tracking-wider">Select Duration</h3>
              <div className="flex flex-wrap gap-2">
                {eventType.durations.filter(d => d > 0).map(dur => (
                  <button
                    key={dur}
                    onClick={() => { setSelectedDuration(dur); setSelectedSlotIso(null); setShowDetailsForm(false) }}
                    className={`px-4 py-2 text-sm rounded-lg border font-semibold transition-colors tracking-tight ${
                      effectiveDuration === dur
                        ? 'bg-black text-white border-black'
                        : 'bg-[#F3F4F6] border-[#E5E7EB] text-[#111827] hover:border-[#D1D5DB]'
                    }`}
                  >
                    {dur} min
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Calendar & Slots Grid */}
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Step 1 & 2: calendar + time slots */}
            <div
              className={`flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8 flex-1 min-h-0 ${
                panelState === 'exiting' ? 'booking-panel-out-left' :
                panelState === 'calendar' ? '' :
                'hidden'
              }`}
            >
              {/* Left: Calendar + timezone — fixed max width so the row never collapses to calendar-only “wide” view */}
              <div className="w-full max-w-[min(100%,320px)] shrink-0 flex flex-col">
                <h2 className="text-lg font-bold text-[#111827] mb-4 uppercase tracking-wider">Select a Date</h2>
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
                    // Hide days outside the current month
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
                          onClick={() => {
                            if (!disabled) {
                              setSelectedDate(date)
                              setSelectedSlotIso(null)
                            }
                          }}
                          className={btnClass}
                        >
                          {date.getDate()}
                        </button>
                        {todayDate && (
                          <div className="w-1 h-1 rounded-full bg-black mt-0.5 shrink-0" />
                        )}
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
                >
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>
                      {getTimezoneLabel(tz)}
                    </option>
                  ))}
                </select>
              </div>
              </div>

              {/* Right: Date (aligned with calendar month nav) + time slots — always shown (defaults to today) */}
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
                    <p className="text-[#6B7280] text-sm font-medium">No available times</p>
                  ) : (
                    <div className="space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                      {timeSlots.map(slotIso => {
                        const spots = isGroupEvent && eventType
                          ? getRemainingSpots(slotIso, effectiveDuration, eventType.maxAttendees, hostBookings)
                          : null
                        const isHighlighted = selectedSlotIso === slotIso
                        const conflict = conflictsBySlot.get(slotIso) ?? null
                        return (
                          <div key={slotIso} className="flex overflow-hidden rounded-xl">
                            <button
                              type="button"
                              onMouseEnter={() => { setHoveredSlot(slotIso) }}
                              onMouseLeave={() => { setHoveredSlot(null) }}
                              onClick={() => { setSelectedSlotIso(slotIso); setBookingError(null) }}
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
                                  {spots != null ? (
                                    <span className="block text-[11px] opacity-70 mt-0.5">
                                      {spots} spot{spots !== 1 ? 's' : ''} left
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </button>
                            <div className={`booking-next-wrapper shrink-0 ${isHighlighted ? 'open' : ''}`}>
                              <button
                                onClick={() => {
                                  if (panelTimerRef.current) clearTimeout(panelTimerRef.current)
                                  setPanelState('exiting')
                                  panelTimerRef.current = setTimeout(() => {
                                    setShowDetailsForm(true)
                                    setPanelState('details')
                                  }, 230)
                                }}
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

            {currentUser && selectedDate && panelState === 'calendar' && (
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

            {/* Step 3: Enter Details — sibling to the calendar panel, not inside it */}
            {(showDetailsForm || panelState === 'returning') && selectedDate && selectedSlotIso && (
              <div
                className={`w-full flex-1 min-h-0 overflow-auto flex flex-col ${
                  panelState === 'details' ? 'booking-panel-in-right' :
                  panelState === 'returning' ? 'booking-panel-out-right' : ''
                }`}
              >
              <div className="space-y-6">
              {/* Back button + selected date/time summary */}
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
                <h2 className="text-lg font-bold text-[#111827] mb-4 uppercase tracking-wider">Enter Your Details</h2>
                
                <div className="space-y-4">
                  <div>
                    <Input
                      label="Your Email"
                      type="email"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="john@example.com"
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

                  <Input
                    label="Your Name"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="John Doe"
                  />

                  {lookupResult?.found && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <button
                        type="button"
                        onClick={() => setSendEmailToo(!sendEmailToo)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${
                          sendEmailToo ? 'bg-black' : 'bg-[#D1D5DB]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                            sendEmailToo ? 'left-[18px]' : 'left-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-sm text-[#111827] font-medium">Also send email notification</span>
                    </label>
                  )}

                  <Textarea
                    label="Additional Information (optional)"
                    value={formData.additionalInfo}
                    onChange={e => setFormData({ ...formData, additionalInfo: e.target.value })}
                    placeholder="Anything you'd like us to know before the meeting?"
                    rows={3}
                  />

                  {/* Dynamic Booking Questions */}
                  {eventType.bookingQuestions.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-[#E5E7EB]">
                      {eventType.bookingQuestions.map(q => (
                        <div key={q.id}>
                          {q.type === 'checkbox' ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!questionAnswers[q.id]}
                                onChange={e => setQuestionAnswers({ ...questionAnswers, [q.id]: e.target.checked })}
                                className="rounded border-[#D1D5DB] bg-white"
                              />
                              <span className="text-sm text-[#111827] font-medium">
                                {q.label}{q.required && <span className="text-red-400 ml-0.5">*</span>}
                              </span>
                            </label>
                          ) : q.type === 'select' ? (
                            <Select
                              label={`${q.label}${q.required ? ' *' : ''}`}
                              value={(questionAnswers[q.id] as string) ?? ''}
                              onChange={e => setQuestionAnswers({ ...questionAnswers, [q.id]: e.target.value })}
                              options={[
                                { value: '', label: 'Select...' },
                                ...(q.options ?? []).map(opt => ({ value: opt, label: opt })),
                              ]}
                            />
                          ) : q.type === 'textarea' ? (
                            <Textarea
                              label={`${q.label}${q.required ? ' *' : ''}`}
                              value={(questionAnswers[q.id] as string) ?? ''}
                              onChange={e => setQuestionAnswers({ ...questionAnswers, [q.id]: e.target.value })}
                              rows={3}
                            />
                          ) : (
                            <Input
                              label={`${q.label}${q.required ? ' *' : ''}`}
                              value={(questionAnswers[q.id] as string) ?? ''}
                              onChange={e => setQuestionAnswers({ ...questionAnswers, [q.id]: e.target.value })}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recurrence */}
                  <Select
                    label="Repeat"
                    value={recurrence}
                    onChange={e => setRecurrence(e.target.value as RecurrenceType)}
                    options={RECURRENCE_OPTIONS.map(r => ({ value: r.value, label: r.label }))}
                  />
                  {recurrence !== 'none' && (
                    <p className="text-xs text-[#6B7280] font-medium -mt-2">
                      {recurrence === 'weekly' ? '4 weekly meetings will be created' :
                       recurrence === 'biweekly' ? '4 biweekly meetings will be created' :
                       '3 monthly meetings will be created'}
                    </p>
                  )}

                  {bookingError && (
                    <div data-testid="booking-error" className="bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg p-3 text-sm text-[#dc2626] font-medium">
                      {bookingError}
                    </div>
                  )}

                  <Button
                    onClick={() => { setBookingError(null); handleSubmit() }}
                    disabled={
                      !formData.name || !formData.email || isSubmitting || isCreatingEvent ||
                      (eventType.bookingQuestions.some(q => q.required && !questionAnswers[q.id]))
                    }
                    className="w-full app-btn-primary"
                  >
                    {isSubmitting ? 'Scheduling...' : 'Schedule Meeting'}
                  </Button>
                </div>
              </div>
              </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Powered By Badge */}
      <div className="mt-8 flex items-center gap-2 app-card px-4 py-2">
        <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest">Powered by</span>
        <div className="flex items-center gap-1.5 text-[#111827]">
          <CalendarCheck className="w-3.5 h-3.5" strokeWidth={2} />
          <span className="text-sm font-bold tracking-tight">BookWithMe</span>
        </div>
      </div>
    </div>
  )
}

