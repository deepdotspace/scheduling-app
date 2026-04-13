/**
 * Bookings Hook
 *
 * Manages bookings (scheduled meetings).
 * Shows both meetings you host AND meetings you've booked with others.
 * Uses useQuery/useMutations (RecordRoom) pattern.
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'
import { getAuthToken } from 'deepspace'
import type { Booking } from '../constants'
import { clearBookingRescheduleAudit } from '../lib/reschedule-audit-storage'

/** Normalize stored field (string, or occasional non-string from sync) */
function readStringField(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string') return v
  return String(v)
}

/** Extended booking with role indicator */
export interface BookingWithRole extends Booking {
  /** Whether current user is the host or guest for this booking */
  role: 'host' | 'guest'
}

interface UseBookingsReturn {
  /** All bookings in the system */
  bookings: Booking[]
  /** Upcoming bookings where user is either host or guest */
  upcomingBookings: BookingWithRole[]
  /** Past bookings where user is either host or guest */
  pastBookings: BookingWithRole[]
  /** Cancelled bookings (user is host or guest) */
  cancelledBookings: BookingWithRole[]
  /** Bookings where user is the host (others booked with you) */
  hostedBookings: BookingWithRole[]
  /** Bookings where user is the guest (you booked with others) */
  bookedByYou: BookingWithRole[]
  createBooking: (booking: Omit<Booking, 'id' | 'createdAt' | 'status'>) => Booking
  /** Server action: updates booking and removes platform calendar busy blocks */
  cancelBooking: (id: string) => Promise<{ success: boolean; error?: string }>
  /** Host-only: mark a past confirmed meeting as no-show (server action). */
  markBookingNoShow: (id: string) => Promise<{ success: boolean; error?: string }>
  /** Host-only: revert no-show to confirmed (server action). */
  undoBookingNoShow: (id: string) => Promise<{ success: boolean; error?: string }>
  /** Permanently remove booking (past, cancelled, or no-show only; server action). */
  deleteBookingPermanently: (id: string) => Promise<{ success: boolean; error?: string }>
  getBooking: (id: string) => Booking | undefined
  getBookingsForHost: (hostUserId: string) => Booking[]
  getBookingsForDate: (date: Date) => Booking[]
  ready: boolean
}

export function useBookings(): UseBookingsReturn {
  const { user } = useUser()
  const { records, status } = useQuery<any>('bookings')
  const { create } = useMutations<any>('bookings')

  // Map records to Booking objects
  const bookings = useMemo((): Booking[] => {
    return records
      .map(rec => {
        const data = rec.data as any
        const reasonRaw = readStringField(data.reasonForChange)
        const rescheduleEmailRaw = readStringField(data.rescheduleEmail)
        return {
          id: rec.recordId,
          eventTypeId: data.eventTypeId ?? '',
          eventTitle: data.eventTitle ?? '',
          guestName: data.guestName ?? '',
          guestEmail: data.guestEmail ?? '',
          guestUserId: data.guestUserId,
          startTime: data.startTime ?? '',
          endTime: data.endTime ?? '',
          meetingLink: data.meetingLink,
          additionalInfo: data.additionalInfo,
          answers: data.answers,
          status: data.status ?? 'confirmed',
          createdAt: rec.createdAt ?? new Date().toISOString(),
          hostUserId: data.hostUserId ?? '',
          hostName: data.hostName ?? '',
          hostEmail: readStringField(data.hostEmail),
          seriesId: data.seriesId || undefined,
          recurrence: data.recurrence || undefined,
          rescheduleEmail: rescheduleEmailRaw,
          reasonForChange: reasonRaw,
          guestTimezone: readStringField(data.guestTimezone),
          hostTimezone: readStringField(data.hostTimezone),
        } as Booking
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [records])

  const createBooking = useCallback((
    data: Omit<Booking, 'id' | 'createdAt' | 'status'>
  ): Booking => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

    create({
      eventTypeId: data.eventTypeId,
      eventTitle: data.eventTitle,
      hostUserId: data.hostUserId,
      hostName: data.hostName,
      hostEmail: data.hostEmail,
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestUserId: data.guestUserId,
      startTime: data.startTime,
      endTime: data.endTime,
      meetingLink: data.meetingLink,
      additionalInfo: data.additionalInfo,
      status: 'confirmed',
    })

    return {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
    }
  }, [create])

  const cancelBooking = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    const token = await getAuthToken()
    const res = await fetch('/api/actions/cancel-booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ bookingId: id }),
    })
    const result = (await res.json()) as { success: boolean; error?: string }
    if (result.success) {
      clearBookingRescheduleAudit(id)
    }
    return result
  }, [])

  const markBookingNoShow = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    const token = await getAuthToken()
    const res = await fetch('/api/actions/mark-booking-no-show', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ bookingId: id }),
    })
    return (await res.json()) as { success: boolean; error?: string }
  }, [])

  const undoBookingNoShow = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    const token = await getAuthToken()
    const res = await fetch('/api/actions/undo-booking-no-show', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ bookingId: id }),
    })
    return (await res.json()) as { success: boolean; error?: string }
  }, [])

  const deleteBookingPermanently = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    const token = await getAuthToken()
    const res = await fetch('/api/actions/delete-booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ bookingId: id }),
    })
    const result = (await res.json()) as { success: boolean; error?: string }
    if (result.success) {
      clearBookingRescheduleAudit(id)
    }
    return result
  }, [])

  const getBooking = useCallback((id: string): Booking | undefined => {
    return bookings.find(b => b.id === id)
  }, [bookings])

  const getBookingsForHost = useCallback((hostUserId: string): Booking[] => {
    return bookings.filter(b => b.hostUserId === hostUserId)
  }, [bookings])

  const getBookingsForDate = useCallback((date: Date): Booking[] => {
    const dateStr = date.toISOString().split('T')[0]
    return bookings.filter(b => b.startTime.startsWith(dateStr))
  }, [bookings])

  // Filter bookings for current user (as host OR guest) with role indicator
  const userBookingsWithRole = useMemo((): BookingWithRole[] => {
    if (!user?.id) return []

    return bookings
      .filter(b => b.hostUserId === user.id || b.guestUserId === user.id)
      .map(b => ({
        ...b,
        role: b.hostUserId === user.id ? 'host' as const : 'guest' as const,
      }))
  }, [bookings, user?.id])

  const hostedBookings = useMemo(() => {
    return userBookingsWithRole.filter(b => b.role === 'host')
  }, [userBookingsWithRole])

  const bookedByYou = useMemo(() => {
    return userBookingsWithRole.filter(b => b.role === 'guest')
  }, [userBookingsWithRole])

  const upcomingBookings = useMemo(() => {
    const now = new Date()
    return userBookingsWithRole
      .filter(b => new Date(b.startTime) > now && b.status === 'confirmed')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [userBookingsWithRole])

  const pastBookings = useMemo(() => {
    const now = new Date()
    return userBookingsWithRole
      .filter(b => new Date(b.startTime) <= now && b.status !== 'cancelled')
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
  }, [userBookingsWithRole])

  const cancelledBookings = useMemo(() => {
    return userBookingsWithRole
      .filter(b => b.status === 'cancelled')
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
  }, [userBookingsWithRole])

  return {
    bookings,
    upcomingBookings,
    pastBookings,
    cancelledBookings,
    hostedBookings,
    bookedByYou,
    createBooking,
    cancelBooking,
    markBookingNoShow,
    undoBookingNoShow,
    deleteBookingPermanently,
    getBooking,
    getBookingsForHost,
    getBookingsForDate,
    ready: status !== 'loading',
  }
}
