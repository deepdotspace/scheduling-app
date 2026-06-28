/**
 * schedule-event — Book a meeting on a host's calendar.
 *
 * Single source of truth: the `bookings` collection in app:bookme.
 * Both the time-slot picker (frontend) and this action check the same
 * collection, so a slot that's visible to the guest is guaranteed bookable.
 *
 * Flow:
 *  1. Validate event type, availability, timeGap
 *  2. Check for conflicts against bookings collection + host calendar
 *  3. Create the host calendar event first (so a failure can't orphan a confirmed booking)
 *  4. Create booking record (authoritative) with calendarEventId already set
 *  5. Create optional guest calendar event
 *  6. Send cross-app notifications (Slack channel + mail DM) and confirmation email
 */
import type { ActionHandler } from '../lib/action-types'
import { createDirMailBookingNotification, getSendDeepSpaceMailFromEventTypeData, getSendExternalEmailFromEventTypeData } from '../lib/dir-mail-booking-notify'
import { formatDualPartyTimeRangeForDm } from '../lib/email-datetime-format'
import { SCOPE_ID as APP_SCOPE } from '../constants'
import { buildConfirmedBookingSends } from '../lib/booking-email-templates'
import { sendTransactionalEmailBatch } from '../lib/booking-email-server'
import { validateHostAvailability } from './validate-availability'

async function hashCancelToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// --- Abuse guard: cap how many confirmation emails one guest address can trigger ---
// Booking emails are developer-billed, so a script (or someone email-bombing a victim address)
// directly costs the app owner. Count this guest's recent booking-events straight from the
// bookings collection — a recurring series counts once (via seriesId). No extra infrastructure.
const EMAIL_RL_WINDOW_MS = 60 * 60 * 1000 // rolling 1 hour
const EMAIL_RL_MAX = 5                     // max distinct booking-events per guest email / window
const EMAIL_RL_SCAN = 50                   // bound the lookback scan

function countRecentBookingEvents(
  records: Array<{ recordId: string; createdAt?: string; data: Record<string, unknown> }>,
  sinceMs: number,
): number {
  const events = new Set<string>()
  for (const r of records) {
    const t = Date.parse(r.createdAt ?? '')
    if (!Number.isFinite(t) || t < sinceMs) continue
    // Series counts once; standalone bookings are unique by their own id.
    const key = typeof r.data.seriesId === 'string' && r.data.seriesId ? r.data.seriesId : r.recordId
    events.add(key)
  }
  return events.size
}

export const scheduleEvent: ActionHandler = async (ctx) => {
  const {
    hostUserId,
    eventTypeId,
    startTime,
    guestEmail,
    guestName,
    hostName,
    description,
    guestUserId,
    meetingLink,
    seriesId,
    recurrence,
    additionalInfo,
    answers,
    guestTimezone: guestTimezoneParam,
    duration: durationParam,
    origin: originParam,
    sendConfirmationEmail: sendConfirmationEmailParam,
    sendGuestEmail: sendGuestEmailParam,
  } = ctx.params as {
    hostUserId: string
    eventTypeId: string
    startTime: string
    guestEmail: string
    guestName: string
    /** Display name fallback for the host; the authoritative name/email come from the host profile. */
    hostName?: string
    description?: string
    guestUserId?: string
    meetingLink?: string
    seriesId?: string
    recurrence?: string
    additionalInfo?: string
    answers?: Record<string, string | boolean>
    /** IANA timezone the guest used in the booking UI */
    guestTimezone?: string
    /**
     * Guest-selected duration (minutes) for multi-duration event types. Honored only when it is one
     * of the event type's configured `durations`; otherwise the base `etData.duration` is used. A raw
     * client `endTime` is never trusted.
     */
    duration?: number
    /** App origin (e.g. https://book.example.com) used to build the guest manage/cancel link in email. */
    origin?: string
    /**
     * Occurrence gate: when false, skip ALL transactional confirmation email for this call (host and
     * guest) — used for recurring-series occurrences after the first. Default true.
     */
    sendConfirmationEmail?: boolean
    /**
     * Guest's per-booking "also email me" choice: when false, suppress only the guest's confirmation
     * copy; the host is still emailed (subject to the occurrence gate above). Default true.
     */
    sendGuestEmail?: boolean
  }

  const guestTimezone =
    typeof guestTimezoneParam === 'string' && guestTimezoneParam.trim().length > 0
      ? guestTimezoneParam.trim()
      : ''

  // Display-name fallback only. Host identity used for emails is resolved authoritatively from the
  // host's profile after event-type validation (see below) — never from a client-supplied address.
  let hostDisplayName = typeof hostName === 'string' ? hostName.trim() : ''
  let hostDisplayEmail = ''

  if (!hostUserId || !eventTypeId || !startTime || !guestEmail || !guestName) {
    return { success: false, error: 'Missing required fields' }
  }

  // Reject malformed guest emails server-side: a direct API call bypasses any client check, and an
  // unsendable address means the guest silently never receives their confirmation.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim())) {
    return { success: false, error: 'Please enter a valid email address' }
  }

  // Throttle only calls that will actually send mail — recurring follow-on occurrences pass
  // sendConfirmationEmail:false and are exempt, so a legit recurring series counts as one.
  if (sendConfirmationEmailParam !== false) {
    const recent = await ctx.tools.query(APP_SCOPE, 'bookings', {
      where: { guestEmail },
      orderBy: 'createdAt',
      orderDir: 'desc',
      limit: EMAIL_RL_SCAN,
    })
    const recentRecords =
      (recent.data as { records?: Array<{ recordId: string; createdAt?: string; data: Record<string, unknown> }> })
        ?.records ?? []
    if (countRecentBookingEvents(recentRecords, Date.now() - EMAIL_RL_WINDOW_MS) >= EMAIL_RL_MAX) {
      return { success: false, error: 'Too many bookings from this email address recently. Please try again in a bit.' }
    }
  }

  // 1. Validate event type exists and is active
  const eventTypeResult = await ctx.tools.get(APP_SCOPE, 'event-types', eventTypeId)
  if (!eventTypeResult.success) {
    return { success: false, error: 'Event type not found' }
  }
  const etData = (eventTypeResult.data as { record: { data: Record<string, unknown> } }).record.data
  // `isActive` is persisted in a text column, so it reads back as the string "true"/"false" (no
  // boolean decode). Compare against the falsey forms — a bare truthiness check would pass "false"
  // and let bookings through on a deactivated event type.
  const isActive =
    etData.isActive !== false && etData.isActive !== 'false' && etData.isActive !== 0 && etData.isActive !== '0'
  if (!isActive) {
    return { success: false, error: 'Event type is not active' }
  }
  if (etData.userId !== hostUserId) {
    return { success: false, error: 'Event type does not belong to this host' }
  }

  // Security boundary: resolve the host's real name/email server-side and ignore the client-supplied
  // values. Otherwise a direct API call could set hostEmail to an arbitrary address and make the app
  // send booking + reminder emails there from the app's sender, billed to the app owner.
  // - Name comes from the public `users` record (also drives the booking page display).
  const hostProfileResult = await ctx.tools.get(APP_SCOPE, 'users', hostUserId)
  if (hostProfileResult.success) {
    const hostProfile =
      (hostProfileResult.data as { record?: { data?: Record<string, unknown> } })?.record?.data ?? {}
    const profileName = typeof hostProfile.name === 'string' ? hostProfile.name.trim() : ''
    if (profileName) hostDisplayName = profileName
  }
  // - Email comes from the private `host-contacts` collection (kept out of the world-readable
  //   `users` record). Query by userId — the userBound stamp guarantees the row's userId is the real
  //   owner, so a caller-chosen recordId can't poison this; recordId is never trusted for identity.
  const hostContactResult = await ctx.tools.query(APP_SCOPE, 'host-contacts', {
    where: { userId: hostUserId },
  })
  const hostContacts =
    (hostContactResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
  const contactEmail = hostContacts[0]?.data?.email
  hostDisplayEmail = typeof contactEmail === 'string' ? contactEmail.trim() : ''

  // Honor a guest-selected duration only when it is one of the event type's configured durations
  // (multi-duration event types). Never trust an arbitrary client-supplied length/endTime.
  const baseDuration = etData.duration as number
  const allowedDurations = Array.isArray(etData.durations)
    ? (etData.durations as unknown[]).filter((d): d is number => typeof d === 'number')
    : []
  const duration =
    typeof durationParam === 'number' && allowedDurations.includes(durationParam)
      ? durationParam
      : baseDuration
  const eventTitle = etData.title as string
  const sendDeepSpaceMail = getSendDeepSpaceMailFromEventTypeData(etData)
  const sendGoogleCalendarInvite = (etData.sendGcalInvite as boolean) ?? false
  const sendExternalEmail = getSendExternalEmailFromEventTypeData(etData)
  const bufferBefore = (etData.bufferBefore as number) ?? 0
  const bufferAfter = (etData.bufferAfter as number) ?? 0
  // maxAttendees > 1 marks a group event: multiple guests may book the same slot up to capacity.
  const maxAttendees = (etData.maxAttendees as number) ?? 0
  const isGroupEvent = maxAttendees > 1

  // 2. Compute endTime from event type duration
  const start = new Date(startTime)
  if (isNaN(start.getTime())) {
    return { success: false, error: 'Invalid startTime' }
  }
  const end = new Date(start.getTime() + duration * 60_000)

  // 3. Validate start is in the future
  const now = new Date()
  if (start <= now) {
    return { success: false, error: 'Cannot book a time in the past' }
  }

  // 4. Load existing bookings (drives both the per-day cap inside validation and conflict checks).
  const bookingsResult = await ctx.tools.query(APP_SCOPE, 'bookings', {
    where: { hostUserId },
  })
  const existingBookings = (bookingsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []

  // Validate the slot against host availability (weekday/blocks/timeGap/per-day cap/overrides) via the
  // shared helper — the single source of truth shared with reschedule-booking so the two never drift.
  const availabilityCheck = await validateHostAvailability(ctx.tools, {
    hostUserId,
    start,
    end,
    now,
    existingBookings,
    availabilityScheduleId: typeof etData.availabilityScheduleId === 'string' ? etData.availabilityScheduleId : undefined,
  })
  if (!availabilityCheck.ok) {
    return { success: false, error: availabilityCheck.error }
  }
  const hostTimezone = availabilityCheck.hostTimezone

  // 5. Check for conflicts. Mirrors the client slot picker (getAvailableSlots): for a group event,
  // count overlapping live bookings and allow until capacity is reached; otherwise any
  // buffer-expanded overlap is a conflict.
  const bufferedStart = new Date(start.getTime() - bufferBefore * 60_000)
  const bufferedEnd = new Date(end.getTime() + bufferAfter * 60_000)
  let hasConflict: boolean
  if (isGroupEvent) {
    const overlappingCount = existingBookings.filter((b) => {
      if (b.data.status === 'cancelled' || b.data.status === 'no_show') return false
      const bStart = new Date(b.data.startTime as string)
      const bEnd = new Date(b.data.endTime as string)
      return start < bEnd && end > bStart
    }).length
    hasConflict = overlappingCount >= maxAttendees
  } else {
    hasConflict = existingBookings.some((b) => {
      if (b.data.status === 'cancelled' || b.data.status === 'no_show') return false
      const bStart = new Date(b.data.startTime as string)
      const bEnd = new Date(b.data.endTime as string)
      return bufferedStart < bEnd && bufferedEnd > bStart
    })
  }
  if (hasConflict) {
    return {
      success: false,
      error: isGroupEvent ? 'This group session is full' : 'Time slot conflicts with an existing booking',
    }
  }

  // 5b. Check for conflicts against host's calendar events
  try {
    const calEventsResult = await ctx.tools.query(`user:${hostUserId}`, 'events', {})
    const calEvents = (calEventsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []
    const hasCalendarConflict = calEvents.some((ev) => {
      if (ev.data.AllDay === 1) return false
      // Skip the app's own booking mirrors — the bookings collection (step 5) is authoritative for
      // booking conflicts, and counting these here would block group-event co-attendees.
      const sourceRef = ev.data.SourceRef as string | undefined
      if (sourceRef === 'book-me:booking' || sourceRef === 'book-me:guest-booking') return false
      const evStart = new Date(ev.data.StartTime as string)
      const evEnd = new Date(ev.data.EndTime as string)
      if (isNaN(evStart.getTime()) || isNaN(evEnd.getTime())) return false
      return start < evEnd && end > evStart
    })
    if (hasCalendarConflict) {
      return { success: false, error: 'Time slot conflicts with an existing calendar event' }
    }
  } catch (err) {
    console.warn('[schedule-event] Failed to check calendar conflicts:', err)
  }

  // 5c. Check for conflicts against host's Google Calendar (FreeBusy)
  try {
    const dayStart = new Date(start)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(start)
    dayEnd.setUTCHours(23, 59, 59, 999)

    const fbRaw = await ctx.tools.integration('booking-host-freebusy', {
      hostClerkUserId: hostUserId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
    })
    const fbPayload = (fbRaw.data ?? fbRaw) as {
      busyTimes?: Array<{ start: string; end: string }>
    }
    if (fbRaw.success && Array.isArray(fbPayload.busyTimes)) {
      const hasGoogleConflict = fbPayload.busyTimes.some(b => {
        const bStart = new Date(b.start)
        const bEnd = new Date(b.end)
        return start < bEnd && end > bStart
      })
      if (hasGoogleConflict) {
        return { success: false, error: 'Time slot conflicts with an existing calendar event' }
      }
    }
  } catch (err) {
    console.warn('[schedule-event] Google FreeBusy conflict check failed:', err)
  }

  // 6. Create the host calendar event FIRST. Doing this before the booking means a calendar
  // failure can't leave an orphaned confirmed booking that permanently blocks the slot; the
  // booking is then written with calendarEventId already set (no separate back-fill update).
  const calendarResult = await ctx.tools.create(`user:${hostUserId}`, 'events', {
    Title: `${eventTitle} with ${guestName}`,
    Description: description ?? '',
    StartTime: start.toISOString(),
    EndTime: end.toISOString(),
    AllDay: 0,
    Visibility: 'shared',
    SourceRef: 'book-me:booking',
    Metadata: JSON.stringify({
      guestEmail,
      guestName,
      bookedBy: ctx.userId,
      eventTypeId,
    }),
  })
  if (!calendarResult.success) {
    console.error('[schedule-event] Calendar event creation failed')
    return calendarResult
  }
  const hostCalendarEventRecordId = (calendarResult.data as { record?: { recordId: string } })?.record?.recordId

  // 7. Create booking record in app:bookme (authoritative — drives conflict detection + slot picker)
  const cancelToken = crypto.randomUUID()
  const cancelTokenHash = await hashCancelToken(cancelToken)
  const bookingPayload = {
    eventTypeId,
    eventTitle,
    hostUserId,
    hostName: hostDisplayName,
    hostEmail: hostDisplayEmail,
    guestName,
    guestEmail,
    guestUserId: guestUserId ?? '',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    meetingLink: meetingLink ?? '',
    cancelToken: cancelTokenHash,
    status: 'confirmed',
    seriesId: seriesId ?? '',
    recurrence: recurrence ?? '',
    additionalInfo: additionalInfo ?? '',
    answers: answers ?? {},
    ...(guestTimezone ? { guestTimezone } : {}),
    hostTimezone,
    ...(hostCalendarEventRecordId ? { calendarEventId: hostCalendarEventRecordId } : {}),
  }
  const bookingResult = await ctx.tools.create(APP_SCOPE, 'bookings', bookingPayload)
  if (!bookingResult.success) {
    // Roll back the calendar event we just created so it can't block the slot on retry.
    if (hostCalendarEventRecordId) {
      try {
        await ctx.tools.remove(`user:${hostUserId}`, 'events', hostCalendarEventRecordId)
      } catch (err) {
        console.warn('[schedule-event] Failed to roll back calendar event after booking failure:', err)
      }
    }
    return { success: false, error: 'Failed to create booking record' }
  }

  // 7b. If guestUserId provided (and distinct from host), create a calendar event in guest's user DO
  if (guestUserId && guestUserId !== hostUserId) {
    try {
      await ctx.tools.create(`user:${guestUserId}`, 'events', {
        Title: `${eventTitle} with ${hostDisplayName || 'Host'}`,
        Description: description ?? '',
        StartTime: start.toISOString(),
        EndTime: end.toISOString(),
        AllDay: 0,
        Visibility: 'shared',
        SourceRef: 'book-me:guest-booking',
        Metadata: JSON.stringify({
          hostUserId,
          guestEmail,
          guestName,
          eventTypeId,
        }),
      })
    } catch (err) {
      console.warn('[schedule-event] Failed to create guest calendar event:', err)
    }
  }

  // 8. Send cross-app notifications via dir DOs
  const guestTzForMail = guestTimezone || hostTimezone
  const notificationBody = [
    `📅 New booking: ${eventTitle}`,
    `Guest: ${guestName} (${guestEmail})`,
    '',
    formatDualPartyTimeRangeForDm(start.toISOString(), end.toISOString(), guestTzForMail, hostTimezone),
  ].join('\n')
  // The team channel below is public; omit the guest's email there. The private dir:mail thread
  // (participants only, sent further down) keeps the full body including the email.
  const slackNotificationBody = [
    `📅 New booking: ${eventTitle}`,
    `Guest: ${guestName}`,
    '',
    formatDualPartyTimeRangeForDm(start.toISOString(), end.toISOString(), guestTzForMail, hostTimezone),
  ].join('\n')

  // All post-commit side effects (cross-app notifications + confirmation email) are best-effort:
  // the booking row and host calendar event are already persisted above, so a failure here must NOT
  // surface as a failed booking (which would prompt a retry and double-book the slot). Swallow + log.
  try {
    const slackDirScope = 'dir:teams'
    const slackChannelQuery = await ctx.tools.query(slackDirScope, 'conversations', {
      where: { Name: 'bookings' },
      limit: 1,
    })
    const slackChannels = (slackChannelQuery.data as { records?: Array<{ recordId: string }> })?.records ?? []
    let slackChannelId: string | undefined = slackChannels[0]?.recordId

    if (!slackChannelId) {
      const createResult = await ctx.tools.create(slackDirScope, 'conversations', {
        Name: 'bookings',
        Description: 'Booking notifications from BookWithMe',
        Type: 'public',
        Visibility: 'public',
        CreatedBy: ctx.userId,
        ParticipantHash: '',
        ParticipantIds: '',
        Status: 'active',
        AssigneeId: '',
        LinkedRef: '',
        LastMessageAt: new Date().toISOString(),
        LastMessagePreview: slackNotificationBody.slice(0, 100),
        LastMessageAuthor: ctx.userId,
      })
      slackChannelId = (createResult.data as { recordId?: string })?.recordId
    }

    if (slackChannelId) {
      await ctx.tools.create(`conv:${slackChannelId}`, 'conv_messages', {
        Content: slackNotificationBody,
        AuthorId: ctx.userId,
        ParentId: '',
        Edited: 0,
        MessageType: 'system',
        Metadata: JSON.stringify({ source: 'book-me', eventTypeId }),
      })
      await ctx.tools.update(slackDirScope, 'conversations', slackChannelId, {
        LastMessageAt: new Date().toISOString(),
        LastMessagePreview: slackNotificationBody.slice(0, 100),
        LastMessageAuthor: ctx.userId,
      })
    }

    // DeepSpace Mail (dir:mail) — only when sendDeepSpaceMail (see lib/dir-mail-booking-notify.ts).
    await createDirMailBookingNotification(ctx, {
      sendDeepSpaceMail,
      eventTypeId,
      participantHash: `booking-${eventTypeId}-${start.toISOString()}`,
      conversationTitle: `Booking Confirmed: ${eventTitle}`,
      messageBody: notificationBody,
      guestName,
      hostUserId,
      guestUserId,
    })
  } catch (err) {
    console.warn('[schedule-event] post-commit notifications failed:', err)
  }

  // Confirmation email — its OWN independent try/catch so a Slack/dir-mail failure above (e.g. an
  // unprovisioned dir:teams scope) can never prevent the guest/host confirmation from being sent.
  // Two independent gates:
  //  - `sendExternalEmail` (event-type level) is the master switch for transactional email.
  //  - `sendConfirmationEmailParam` is the per-occurrence gate (false for recurring occurrences after
  //    the first), so the whole batch is skipped for those — the host is emailed once, not per occurrence.
  // Within an emailing occurrence, `sendGuestEmailParam` controls only the guest's copy; the host is
  // still notified even when the guest opts out.
  try {
    const emailThisOccurrence = sendConfirmationEmailParam !== false
    if (sendExternalEmail && emailThisOccurrence) {
      let extra = typeof additionalInfo === 'string' ? additionalInfo : ''
      if (recurrence && recurrence !== 'none') {
        extra = extra ? `${extra}\n\n` : ''
        extra += `This is a recurring ${recurrence} meeting.`
      }
      // Guest self-service link: the RAW cancelToken (only its SHA-256 hash is stored) lets a
      // logged-out guest cancel/reschedule from /manage. Built only when the client passed an origin.
      const origin = typeof originParam === 'string' ? originParam.trim().replace(/\/+$/, '') : ''
      const bookingRecordId = (bookingResult.data as { recordId?: string } | undefined)?.recordId
      const manageUrl = origin && bookingRecordId ? `${origin}/manage/${bookingRecordId}/${cancelToken}` : undefined
      const sends = buildConfirmedBookingSends({
        hostName: hostDisplayName || 'Host',
        hostEmail: hostDisplayEmail,
        guestName,
        guestEmail,
        eventTitle,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        meetingLink: meetingLink ?? '',
        additionalInfo: extra || undefined,
        guestTimezone,
        hostTimezone,
        sendGuestEmail: sendGuestEmailParam !== false,
        manageUrl,
      })
      if (sends.length > 0) {
        const emailResult = await sendTransactionalEmailBatch(ctx.tools, sends)
        if (!emailResult.ok) {
          console.warn('[schedule-event] email/send:', emailResult.errors.join('; '))
        }
      }
    }
  } catch (err) {
    console.warn('[schedule-event] confirmation email failed:', err)
  }

  const calendarData = calendarResult.data as { record?: { recordId: string } } | undefined
  const bookingData = bookingResult.data as { recordId?: string } | undefined
  return {
    success: true,
    data: {
      record: calendarData?.record,
      bookingId: bookingData?.recordId,
      cancelToken,
      eventType: { sendDeepSpaceMail, sendExternalEmail, sendGoogleCalendarInvite },
    },
  }
}
