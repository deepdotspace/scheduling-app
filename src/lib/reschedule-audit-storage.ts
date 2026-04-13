/**
 * Persists reschedule audit (email + reason) per booking so the meetings detail
 * panel keeps showing "Rescheduled" after close/reopen when RecordRoom sync lags
 * or omits fields. Cleared when the booking is cancelled.
 */

const storageKey = (bookingId: string): string => `bookme:rescheduleAudit:${bookingId}`

export interface StoredRescheduleAudit {
  rescheduleEmail: string
  reasonForChange: string
}

export function saveBookingRescheduleAudit(bookingId: string, audit: StoredRescheduleAudit): void {
  try {
    if (typeof window === 'undefined') return
    const rescheduleEmail = audit.rescheduleEmail.trim()
    const reasonForChange = audit.reasonForChange.trim()
    if (!rescheduleEmail && !reasonForChange) {
      window.localStorage.removeItem(storageKey(bookingId))
      return
    }
    window.localStorage.setItem(
      storageKey(bookingId),
      JSON.stringify({ rescheduleEmail, reasonForChange }),
    )
  } catch {
    /* quota / private mode */
  }
}

export function readBookingRescheduleAudit(bookingId: string): StoredRescheduleAudit | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(storageKey(bookingId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    const rescheduleEmail = typeof o.rescheduleEmail === 'string' ? o.rescheduleEmail.trim() : ''
    const reasonForChange = typeof o.reasonForChange === 'string' ? o.reasonForChange.trim() : ''
    if (!rescheduleEmail && !reasonForChange) return null
    return { rescheduleEmail, reasonForChange }
  } catch {
    return null
  }
}

export function clearBookingRescheduleAudit(bookingId: string): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(storageKey(bookingId))
  } catch {
    /* */
  }
}

/**
 * Fill missing audit fields on a booking from local persistence (store wins when present).
 */
export function mergeBookingWithStoredRescheduleAudit<T extends {
  id: string
  rescheduleEmail?: string
  reasonForChange?: string
}>(booking: T): T {
  const stored = readBookingRescheduleAudit(booking.id)
  if (!stored) return booking

  const emailFromStore = booking.rescheduleEmail?.trim()
  const reasonFromStore = booking.reasonForChange?.trim()
  const email = emailFromStore || stored.rescheduleEmail
  const reason = reasonFromStore || stored.reasonForChange

  if (!email && !reason) return booking

  return {
    ...booking,
    ...(email ? { rescheduleEmail: email } : {}),
    ...(reason ? { reasonForChange: reason } : {}),
  }
}
