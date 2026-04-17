/**
 * get-calendar-events — Fetch the signed-in user's calendar events with titles.
 *
 * Unlike get-busy-times (host privacy), this is for the current user’s own
 * events so the booking UI can show “Your Schedule” with event names.
 */
import type { ActionHandler } from 'deepspace/worker'
import type { BookMeActionTools } from '../types/book-me-tools'

export const getCalendarEvents: ActionHandler = async (ctx) => {
  const { userId, dateStart, dateEnd } = ctx.params as {
    userId: string
    dateStart: string
    dateEnd: string
  }

  if (!userId || !dateStart || !dateEnd) {
    return { success: false, error: 'Missing required fields: userId, dateStart, dateEnd' }
  }

  if (ctx.userId !== userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const rangeStart = new Date(dateStart)
  const rangeEnd = new Date(dateEnd)
  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
    return { success: false, error: 'Invalid date format' }
  }

  const userScope = `user:${userId}`

  // Fetch from book2me's own DO and from the deepspace calendar app in parallel
  const [eventsResult, calendarRes] = await Promise.all([
    ctx.tools.query(userScope, 'events', {}),
    (ctx.tools as BookMeActionTools).calendarApp('/internal/calendar-events', {
      userId,
      dateStart,
      dateEnd,
    }).catch((err) => {
      console.warn('[get-calendar-events] DS calendar fetch failed:', err)
      return null
    }),
  ])

  const eventRecords = (eventsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []

  // Collect with sourceRef for deduplication
  const rawEvents: Array<{ start: string; end: string; title: string; sourceRef: string }> = []
  for (const record of eventRecords) {
    const eventStart = record.data.StartTime as string
    const eventEnd = record.data.EndTime as string
    const titleRaw = record.data.Title
    const title = typeof titleRaw === 'string' && titleRaw.trim().length > 0 ? titleRaw.trim() : 'Busy'
    if (!eventStart || !eventEnd) continue

    const eStart = new Date(eventStart)
    const eEnd = new Date(eventEnd)
    if (isNaN(eStart.getTime()) || isNaN(eEnd.getTime())) continue

    if (record.data.AllDay === 1) continue

    if (eStart < rangeEnd && eEnd > rangeStart) {
      rawEvents.push({
        start: eStart.toISOString(),
        end: eEnd.toISOString(),
        title,
        sourceRef: typeof record.data.SourceRef === 'string' ? record.data.SourceRef : '',
      })
    }
  }

  // Deduplicate: if the same start time has both a host booking event (book-me:booking) and a guest
  // booking event (book-me:guest-booking), only keep the host one to avoid showing the same meeting twice.
  const hostBookingStarts = new Set(
    rawEvents.filter(e => e.sourceRef === 'book-me:booking').map(e => e.start)
  )
  const localEvents = rawEvents
    .filter(e => !(e.sourceRef === 'book-me:guest-booking' && hostBookingStarts.has(e.start)))
    .map(({ start, end, title }) => ({ start, end, title, source: 'deepspace' as const }))

  // Merge in deepspace calendar app events, deduplicating by (start, end) to avoid double-counting
  // events that were already synced into the book2me shadow collection.
  const localStartEnds = new Set(localEvents.map(e => `${e.start}|${e.end}`))
  let calendarAppEvents: Array<{ start: string; end: string; title: string; source: 'deepspace' }> = []
  if (calendarRes) {
    try {
      const json = (await calendarRes.json()) as { events?: Array<{ start: string; end: string; title: string }> }
      console.log(`[get-calendar-events] DS calendar returned ${json.events?.length ?? 0} events for user ${userId}`)
      if (Array.isArray(json.events)) {
        calendarAppEvents = json.events
          .filter(e => !localStartEnds.has(`${e.start}|${e.end}`))
          .map(e => ({ ...e, source: 'deepspace' as const }))
      }
    } catch (err) {
      console.warn('[get-calendar-events] Failed to parse DS calendar response:', err)
    }
  } else {
    console.log('[get-calendar-events] DS calendar unreachable (no CALENDAR_WORKER binding nor CALENDAR_WORKER_URL)')
  }

  const events = [...localEvents, ...calendarAppEvents].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )

  return {
    success: true,
    data: { events },
  }
}
