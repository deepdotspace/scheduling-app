/**
 * get-calendar-events — Fetch the signed-in user's calendar events with titles.
 *
 * Unlike get-busy-times (host privacy), this is for the current user’s own
 * events so the booking UI can show “Your Schedule” with event names.
 */
import type { ActionHandler } from 'deepspace/worker'

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
  const eventsResult = await ctx.tools.query(userScope, 'events', {})
  const eventRecords = (eventsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []

  const events: Array<{ start: string; end: string; title: string }> = []
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
      events.push({
        start: eStart.toISOString(),
        end: eEnd.toISOString(),
        title,
      })
    }
  }

  return {
    success: true,
    data: { events },
  }
}
