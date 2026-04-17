/**
 * get-busy-times — Fetch busy periods from a host's calendar.
 *
 * Queries the host's user:{hostUserId} DO for DeepSpace calendar events
 * AND the host's Google Calendar via the booking-host-freebusy API.
 * Merges both sources into a single list of blocking intervals.
 *
 * Returns only start/end times (not event details) for privacy.
 * Used by the booking page to exclude slots that conflict with the host's
 * existing calendar events.
 */
import type { ActionHandler } from 'deepspace/worker'
import type { BookMeActionTools } from '../types/book-me-tools'

interface BusyInterval {
  start: string
  end: string
}

/**
 * Merge two sorted-by-start busy interval lists, coalescing overlapping ranges.
 * Input lists need not be sorted; they will be sorted internally.
 */
function mergeAndCoalesce(a: BusyInterval[], b: BusyInterval[]): BusyInterval[] {
  const all = [...a, ...b].sort(
    (x, y) => new Date(x.start).getTime() - new Date(y.start).getTime()
  )
  if (all.length === 0) return []

  const result: BusyInterval[] = [all[0]]
  for (let i = 1; i < all.length; i++) {
    const prev = result[result.length - 1]
    const cur = all[i]
    if (new Date(cur.start).getTime() <= new Date(prev.end).getTime()) {
      // Overlapping or adjacent — extend the previous interval
      if (new Date(cur.end).getTime() > new Date(prev.end).getTime()) {
        prev.end = cur.end
      }
    } else {
      result.push(cur)
    }
  }
  return result
}

export const getBusyTimes: ActionHandler = async (ctx) => {
  const { hostUserId, dateStart, dateEnd } = ctx.params as {
    hostUserId: string
    dateStart: string
    dateEnd: string
  }

  if (!hostUserId || !dateStart || !dateEnd) {
    return { success: false, error: 'Missing required fields: hostUserId, dateStart, dateEnd' }
  }

  const rangeStart = new Date(dateStart)
  const rangeEnd = new Date(dateEnd)
  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
    return { success: false, error: 'Invalid date format' }
  }

  // 1. DeepSpace calendar events
  const userScope = `user:${hostUserId}`
  const eventsResult = await ctx.tools.query(userScope, 'events', {})
  const eventRecords = (eventsResult.data as { records?: Array<{ data: Record<string, unknown> }> })?.records ?? []

  const dsBusy: BusyInterval[] = []
  for (const record of eventRecords) {
    const eventStart = record.data.StartTime as string
    const eventEnd = record.data.EndTime as string
    if (!eventStart || !eventEnd) continue

    const eStart = new Date(eventStart)
    const eEnd = new Date(eventEnd)
    if (isNaN(eStart.getTime()) || isNaN(eEnd.getTime())) continue
    if (record.data.AllDay === 1) continue

    if (eStart < rangeEnd && eEnd > rangeStart) {
      dsBusy.push({ start: eStart.toISOString(), end: eEnd.toISOString() })
    }
  }

  // 2. Deepspace calendar app (via service binding to calendar worker)
  let calendarAppBusy: BusyInterval[] = []
  try {
    const res = await (ctx.tools as BookMeActionTools).calendarApp('/internal/busy-times', {
      userId: hostUserId,
      timeMin: dateStart,
      timeMax: dateEnd,
    })
    if (res) {
      const json = (await res.json()) as { busyTimes?: BusyInterval[] }
      if (Array.isArray(json.busyTimes)) calendarAppBusy = json.busyTimes
      console.log(`[get-busy-times] DS calendar: ${calendarAppBusy.length} busy intervals`)
    }
  } catch (err) {
    console.warn('[get-busy-times] DS calendar fetch failed (skipping):', err)
  }

  // 3. Google Calendar FreeBusy (via app worker integration proxy)
  let googleBusy: BusyInterval[] = []
  try {
    const raw = await ctx.tools.integration('booking-host-freebusy', {
      hostClerkUserId: hostUserId,
      timeMin: dateStart,
      timeMax: dateEnd,
    })
    const payload = (raw.data ?? raw) as {
      busyTimes?: BusyInterval[]
      hostNotConnected?: boolean
    }
    console.log(
      `[get-busy-times] FreeBusy: success=${raw.success}, busyTimes=${payload.busyTimes?.length ?? 0}, hostNotConnected=${payload.hostNotConnected ?? false}`,
    )
    if (raw.success && Array.isArray(payload.busyTimes)) {
      googleBusy = payload.busyTimes
    }
  } catch (err) {
    console.warn('[get-busy-times] Google FreeBusy failed (falling back to DS-only):', err)
  }

  // 4. Merge and coalesce all three sources
  const busyTimes = mergeAndCoalesce([...dsBusy, ...calendarAppBusy], googleBusy)

  return {
    success: true,
    data: { busyTimes },
  }
}
