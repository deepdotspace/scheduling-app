/**
 * Resolve the "other person" for a meeting row or detail panel (host ↔ guest).
 */

import { isAnonymousPlaceholderName } from './display-names'
import type { UserProfile } from '../constants'
import type { BookingWithRole } from '../hooks/useBookings'

export interface CounterpartyDisplay {
  name: string
  email: string
  imageUrl?: string
}

function resolveProfileDisplayName(p: UserProfile | undefined, bookingFallback: string, roleFallback: string): string {
  const fromBooking = bookingFallback.trim()
  if (fromBooking) return fromBooking
  const n = p?.name?.trim()
  if (n && !isAnonymousPlaceholderName(n)) return n
  const u = p?.username?.trim()
  if (u) return u
  if (p?.email?.trim()) {
    const local = p.email.trim().split('@')[0]
    if (local) return local
  }
  return roleFallback
}

function resolveProfileEmail(p: UserProfile | undefined, bookingFallback?: string): string {
  const fromBooking = bookingFallback?.trim()
  if (fromBooking) return fromBooking
  const e = p?.email?.trim()
  if (e) return e
  return '—'
}

/** Enriched via useUserLookup / batch API — DeepSpace name + avatar */
export interface RoomUserOverlay {
  name: string
  imageUrl?: string
  email?: string
}

function mergeRoomOverlay(
  p: UserProfile | undefined,
  room: RoomUserOverlay | undefined,
  syntheticId: string,
): UserProfile | undefined {
  if (!p && !room) return undefined
  if (!room) return p
  if (!p) {
    return {
      id: syntheticId,
      name: room.name,
      email: room.email ?? '',
      imageUrl: room.imageUrl,
      username: '',
      calendarConnected: false,
      emailConnected: false,
    }
  }
  return {
    ...p,
    name: room.name || p.name,
    email: (room.email && room.email.trim()) ? room.email : p.email,
    imageUrl: room.imageUrl ?? p.imageUrl,
  }
}

export function getCounterpartyDisplay(
  booking: BookingWithRole,
  profiles: Record<string, UserProfile>,
  roomUsersById?: Record<string, RoomUserOverlay>,
): CounterpartyDisplay {
  if (booking.role === 'host') {
    const gid = booking.guestUserId
    const g = gid ? profiles[gid] : undefined
    const room = gid ? roomUsersById?.[gid] : undefined
    const merged = mergeRoomOverlay(g, room, gid ?? 'guest')
    const name = resolveProfileDisplayName(merged, booking.guestName, 'Guest')
    return {
      name,
      email: resolveProfileEmail(merged, booking.guestEmail),
      imageUrl: merged?.imageUrl,
    }
  }

  const hid = booking.hostUserId
  const h = profiles[hid]
  const room = roomUsersById?.[hid]
  const merged = mergeRoomOverlay(h, room, hid)
  const name = resolveProfileDisplayName(merged, booking.hostName, 'Host')
  const email = resolveProfileEmail(merged, booking.hostEmail)

  return {
    name,
    email,
    imageUrl: merged?.imageUrl,
  }
}
