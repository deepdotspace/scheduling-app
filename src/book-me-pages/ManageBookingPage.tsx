/**
 * Manage Booking Page
 *
 * Guest self-service: cancel a booking via token.
 * Route: /manage/:bookingId/:token
 */

import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useBookings, useBookingNotification, useEventTypes, useAvailability } from '../hooks'
import { Button, EmptyState } from '../components/ui'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { formatDate, formatTime, DEFAULT_AVAILABILITY } from '../constants'
import { getAuthToken } from 'deepspace'

export default function ManageBookingPage() {
  const { bookingId, token } = useParams<{ bookingId: string; token: string }>()
  const { bookings, ready } = useBookings()
  const { notifyCancellation } = useBookingNotification()

  const [isCancelling, setIsCancelling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const booking = useMemo(() => {
    if (!bookingId) return null
    return bookings.find(b => b.id === bookingId)
  }, [bookingId, bookings])

  const { eventTypes } = useEventTypes(booking?.hostUserId ?? '')
  const eventTypeForNotify = useMemo(
    () => eventTypes.find(et => et.id === booking?.eventTypeId),
    [eventTypes, booking?.eventTypeId],
  )
  const { availability: manageHostDefaultAvail, getScheduleById: manageGetSchedule } = useAvailability(
    booking?.hostUserId,
  )
  const manageHostAvailability = useMemo(() => {
    if (!booking) return manageHostDefaultAvail
    if (eventTypeForNotify?.availabilityScheduleId) {
      const s = manageGetSchedule(eventTypeForNotify.availabilityScheduleId)
      if (s) return s
    }
    return manageHostDefaultAvail
  }, [booking, eventTypeForNotify, manageGetSchedule, manageHostDefaultAvail])

  const handleCancel = async () => {
    if (!bookingId || !token) return
    setIsCancelling(true)
    setShowCancelConfirm(false)

    try {
      const authToken = await getAuthToken()
      const res = await fetch('/api/actions/cancel-booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ bookingId, cancelToken: token }),
      })

      const result = await res.json() as { success: boolean; error?: string }
      if (result.success) {
        setActionResult({ type: 'success', message: 'Booking cancelled successfully.' })

        if (booking) {
          const hostEmailResolved =
            booking.hostEmail?.trim() || ''
          notifyCancellation({
            initiatedBy: 'guest',
            hostName: booking.hostName,
            hostEmail: hostEmailResolved,
            hostUserId: booking.hostUserId,
            guestName: booking.guestName,
            guestEmail: booking.guestEmail,
            guestUserId: booking.guestUserId,
            eventTitle: booking.eventTitle,
            startTime: booking.startTime,
            endTime: booking.endTime,
            sendDeepSpaceMail: eventTypeForNotify?.sendDeepSpaceMail ?? true,
            guestTimezone: booking.guestTimezone?.trim() || undefined,
            hostTimezone:
              booking.hostTimezone?.trim() ||
              (manageHostAvailability?.timezone ??
                manageHostDefaultAvail.timezone ??
                DEFAULT_AVAILABILITY.timezone),
          }).catch(err => {
            console.warn('[BookMe] Guest cancellation host notification failed:', err)
          })
        }
      } else {
        setActionResult({ type: 'error', message: result.error || 'Failed to cancel booking.' })
      }
    } catch {
      setActionResult({ type: 'error', message: 'An error occurred. Please try again.' })
    } finally {
      setIsCancelling(false)
    }
  }

  if (!bookingId || !token) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <EmptyState
          title="Invalid link"
          description="This manage booking link is invalid."
          icon={
            <svg className="w-12 h-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
      </div>
    )
  }

  // Action result screen
  if (actionResult) {
    return (
      <div className="min-h-screen bg-white py-12 px-4">
        <div className="max-w-lg mx-auto">
          <div className={`bg-white rounded-2xl border p-8 text-center shadow-lg ${
            actionResult.type === 'success' ? 'border-emerald-200' : 'border-red-200'
          }`}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              actionResult.type === 'success' ? 'bg-emerald-100' : 'bg-red-100'
            }`}>
              {actionResult.type === 'success' ? (
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {actionResult.type === 'success' ? 'Done!' : 'Error'}
            </h2>
            <p className="text-gray-600">{actionResult.message}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Manage Your Booking</h2>

          {booking ? (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-100">
                <div>
                  <p className="text-xs text-gray-500">Event</p>
                  <p className="text-gray-900">{booking.eventTitle}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">When</p>
                  <p className="text-gray-900">{formatDate(booking.startTime)}</p>
                  <p className="text-gray-600">
                    {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Status</p>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                    booking.status === 'confirmed'
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : booking.status === 'cancelled'
                        ? 'bg-red-100 text-red-700 border-red-200'
                        : booking.status === 'no_show'
                          ? 'bg-amber-100 text-amber-800 border-amber-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                  }`}>
                    {booking.status === 'no_show' ? 'No show' : booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                  </span>
                </div>
              </div>

              {booking.status === 'confirmed' && (
                <div className="flex gap-3">
                  <Button
                    variant="danger"
                    className="flex-1"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isCancelling}
                  >
                    {isCancelling ? 'Cancelling...' : 'Cancel Booking'}
                  </Button>
                </div>
              )}
            </div>
          ) : ready ? (
            <div className="text-center py-8">
              <p className="text-gray-900 font-medium mb-1">Booking not found</p>
              <p className="text-gray-600 text-sm">
                This booking may have been removed, or the link is no longer valid.
              </p>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-12 h-12 border-2 border-gray-200 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading booking details...</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleCancel}
        title="Cancel Booking"
        message="Are you sure you want to cancel this booking? The host will be notified."
        confirmLabel="Cancel Booking"
        variant="danger"
        isLoading={isCancelling}
      />
    </div>
  )
}
