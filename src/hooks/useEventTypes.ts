/**
 * Event Types Hook
 *
 * Manages event types (meeting templates) like "30 min meeting", "1 hour consultation".
 * Uses useQuery/useMutations (RecordRoom) pattern.
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'
import { EVENT_COLORS } from '../constants'
import type { EventType } from '../constants'

/** Wrap an array as { items: [...] } for RecordRoom object fields */
function wrapArray(arr: unknown[]): { items: unknown[] } {
  return { items: arr }
}

/** Unwrap { items: [...] } back to a plain array */
function unwrapArray<T = any>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[]
  if (val && typeof val === 'object' && 'items' in val && Array.isArray((val as any).items)) {
    return (val as any).items as T[]
  }
  return []
}

/** Normalize stored value (0, 1, true, false, undefined) to boolean */
function toBool(val: unknown, defaultValue: boolean): boolean {
  if (val === true || val === 1 || val === '1' || val === 'true') return true
  if (val === false || val === 0 || val === '0' || val === 'false') return false
  return defaultValue
}

interface UseEventTypesReturn {
  eventTypes: EventType[]
  createEventType: (eventType: Omit<EventType, 'id' | 'userId' | 'createdAt'>) => EventType
  updateEventType: (id: string, updates: Partial<Omit<EventType, 'id' | 'userId'>>) => void
  deleteEventType: (id: string) => void
  toggleEventType: (id: string) => void
  getEventType: (id: string) => EventType | undefined
  ready: boolean
}

/**
 * Hook to manage event types for a specific user.
 *
 * @param forUserId - Optional user ID to load event types for (defaults to current user).
 *                    Pass a specific userId to load another user's event types (e.g., for booking pages).
 */
export function useEventTypes(forUserId?: string): UseEventTypesReturn {
  const { user } = useUser()

  const targetUserId = forUserId ?? user?.id
  const isOwner = user?.id === targetUserId

  // Query event types, optionally filtered by userId
  const queryOptions = useMemo(() => {
    if (!targetUserId) return { where: { userId: '__none__' } }
    return { where: { userId: targetUserId } }
  }, [targetUserId])

  const { records, status } = useQuery<EventType>('event-types', queryOptions)
  const { create, put, remove } = useMutations<any>('event-types')

  // Map records to EventType objects
  const eventTypes = useMemo((): EventType[] => {
    return records
      .map(rec => ({
        id: rec.recordId,
        userId: (rec.data as any).userId ?? targetUserId ?? '',
        title: (rec.data as any).title ?? '',
        description: (rec.data as any).description ?? '',
        duration: (rec.data as any).duration ?? 30,
        location: (rec.data as any).location ?? 'google-meet',
        isActive: (rec.data as any).isActive ?? true,
        color: (rec.data as any).color ?? EVENT_COLORS[0],
        sendDeepSpaceMail: toBool((rec.data as any).sendDeepSpaceMail, false),
        sendGoogleCalendarInvite: toBool((rec.data as any).sendGcalInvite, false),
        sendExternalEmail: toBool((rec.data as any).sendExternalEmail, true),
        bufferBefore: (rec.data as any).bufferBefore ?? 0,
        bufferAfter: (rec.data as any).bufferAfter ?? 0,
        durations: unwrapArray((rec.data as any).durations),
        availabilityScheduleId: (rec.data as any).availabilityScheduleId ?? '',
        bookingQuestions: unwrapArray((rec.data as any).bookingQuestions),
        maxAttendees: (rec.data as any).maxAttendees ?? 0,
        isRoundRobin: (rec.data as any).isRoundRobin ?? false,
        teamMemberIds: unwrapArray((rec.data as any).teamMemberIds),
        createdAt: rec.createdAt ?? new Date().toISOString(),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [records, targetUserId])

  const createEventType = useCallback((
    data: Omit<EventType, 'id' | 'userId' | 'createdAt'>
  ): EventType => {
    if (!user?.id) {
      throw new Error('Cannot create event type: not logged in')
    }
    if (!isOwner) {
      throw new Error('Cannot create event type: not the owner')
    }

    const color = data.color || EVENT_COLORS[eventTypes.length % EVENT_COLORS.length]
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const sendDeepSpaceMail = data.sendDeepSpaceMail ?? false
    const sendGoogleCalendarInvite = data.sendGoogleCalendarInvite ?? false

    // Use put with our id so the stored recordId matches what we return (required for booking links)
    put(id, {
      userId: user.id,
      title: data.title,
      description: data.description,
      duration: data.duration,
      location: data.location,
      isActive: data.isActive,
      color,
      sendDeepSpaceMail,
      sendGcalInvite: sendGoogleCalendarInvite,
      sendExternalEmail: data.sendExternalEmail ?? true,
      bufferBefore: data.bufferBefore ?? 0,
      bufferAfter: data.bufferAfter ?? 0,
      durations: wrapArray(data.durations ?? []),
      availabilityScheduleId: data.availabilityScheduleId ?? '',
      bookingQuestions: wrapArray(data.bookingQuestions ?? []),
      maxAttendees: data.maxAttendees ?? 0,
      isRoundRobin: data.isRoundRobin ?? false,
      teamMemberIds: wrapArray(data.teamMemberIds ?? []),
    })

    return {
      ...data,
      sendGoogleCalendarInvite,
      id,
      userId: user.id,
      createdAt: new Date().toISOString(),
      color,
    }
  }, [user?.id, isOwner, eventTypes.length, put])

  const updateEventType = useCallback((id: string, updates: Partial<Omit<EventType, 'id' | 'userId'>>) => {
    if (!isOwner) {
      console.warn('Cannot update event type: not the owner')
      return
    }

    const eventType = eventTypes.find(et => et.id === id)
    if (!eventType) return

    put(id, {
      userId: eventType.userId,
      title: updates.title ?? eventType.title,
      description: updates.description ?? eventType.description,
      duration: updates.duration ?? eventType.duration,
      location: updates.location ?? eventType.location,
      isActive: updates.isActive ?? eventType.isActive,
      color: updates.color ?? eventType.color,
      sendDeepSpaceMail: updates.sendDeepSpaceMail ?? eventType.sendDeepSpaceMail,
      sendGcalInvite: updates.sendGoogleCalendarInvite ?? eventType.sendGoogleCalendarInvite,
      sendExternalEmail: updates.sendExternalEmail ?? eventType.sendExternalEmail,
      bufferBefore: updates.bufferBefore ?? eventType.bufferBefore,
      bufferAfter: updates.bufferAfter ?? eventType.bufferAfter,
      durations: wrapArray(updates.durations ?? eventType.durations),
      availabilityScheduleId: updates.availabilityScheduleId ?? eventType.availabilityScheduleId,
      bookingQuestions: wrapArray(updates.bookingQuestions ?? eventType.bookingQuestions),
      maxAttendees: updates.maxAttendees ?? eventType.maxAttendees,
      isRoundRobin: updates.isRoundRobin ?? eventType.isRoundRobin,
      teamMemberIds: wrapArray(updates.teamMemberIds ?? eventType.teamMemberIds),
    })
  }, [eventTypes, isOwner, put])

  const deleteEventType = useCallback((id: string) => {
    if (!isOwner) {
      console.warn('Cannot delete event type: not the owner')
      return
    }
    remove(id)
  }, [isOwner, remove])

  const toggleEventType = useCallback((id: string) => {
    if (!isOwner) {
      console.warn('Cannot toggle event type: not the owner')
      return
    }

    const eventType = eventTypes.find(et => et.id === id)
    if (!eventType) return

    put(id, {
      userId: eventType.userId,
      title: eventType.title,
      description: eventType.description,
      duration: eventType.duration,
      location: eventType.location,
      isActive: !eventType.isActive,
      color: eventType.color,
      sendDeepSpaceMail: eventType.sendDeepSpaceMail,
      sendGcalInvite: eventType.sendGoogleCalendarInvite,
      sendExternalEmail: eventType.sendExternalEmail,
      bufferBefore: eventType.bufferBefore,
      bufferAfter: eventType.bufferAfter,
      durations: wrapArray(eventType.durations),
      availabilityScheduleId: eventType.availabilityScheduleId,
      bookingQuestions: wrapArray(eventType.bookingQuestions),
      maxAttendees: eventType.maxAttendees,
      isRoundRobin: eventType.isRoundRobin,
      teamMemberIds: wrapArray(eventType.teamMemberIds),
    })
  }, [eventTypes, isOwner, put])

  const getEventType = useCallback((id: string): EventType | undefined => {
    return eventTypes.find(et => et.id === id)
  }, [eventTypes])

  return {
    eventTypes,
    createEventType,
    updateEventType,
    deleteEventType,
    toggleEventType,
    getEventType,
    ready: status !== 'loading',
  }
}
