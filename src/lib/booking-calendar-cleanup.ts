/**
 * Removes synthetic BookMe calendar rows from host/guest user scopes.
 * Shared by cancel-booking and delete-booking.
 */
import type { ActionContext } from 'deepspace/worker'

export async function removeHostBookMeCalendarEvent(
  ctx: ActionContext,
  hostUserId: string,
  calendarEventId: string | undefined,
  startTimeIso: string,
): Promise<void> {
  const userScope = `user:${hostUserId}`
  if (calendarEventId) {
    const del = await ctx.tools.remove(userScope, 'events', calendarEventId)
    if (!del.success) {
      console.warn('[booking-calendar-cleanup] remove host calendar event by id failed:', del.error)
    }
    return
  }
  const eventsResult = await ctx.tools.query(userScope, 'events', {})
  const eventRecords =
    (eventsResult.data as { records?: Array<{ recordId: string; data: Record<string, unknown> }> })?.records ?? []
  const match = eventRecords.find(
    ev => ev.data.SourceRef === 'book-me:booking' && ev.data.StartTime === startTimeIso,
  )
  if (match) {
    const del = await ctx.tools.remove(userScope, 'events', match.recordId)
    if (!del.success) {
      console.warn('[booking-calendar-cleanup] remove host calendar event by query failed:', del.error)
    }
  }
}

export async function removeGuestBookMeCalendarEvent(
  ctx: ActionContext,
  guestUserId: string,
  hostUserId: string,
  startTimeIso: string,
): Promise<void> {
  if (!guestUserId || guestUserId === hostUserId) return
  const userScope = `user:${guestUserId}`
  const eventsResult = await ctx.tools.query(userScope, 'events', {})
  const eventRecords =
    (eventsResult.data as { records?: Array<{ recordId: string; data: Record<string, unknown> }> })?.records ?? []
  const match = eventRecords.find(
    ev => ev.data.SourceRef === 'book-me:guest-booking' && ev.data.StartTime === startTimeIso,
  )
  if (!match) return
  const del = await ctx.tools.remove(userScope, 'events', match.recordId)
  if (!del.success) {
    console.warn('[booking-calendar-cleanup] remove guest calendar event failed:', del.error)
  }
}
