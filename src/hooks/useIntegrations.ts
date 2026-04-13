/**
 * Integrations Hook
 * 
 * BookMe-specific integrations wrapper (DeepSpace integration proxy).
 * Provides booking-specific email templates and convenience methods.
 */

import { useCallback } from 'react'
import {
  useGoogleConnector,
  useGoogleCalendar,
  useGmail,
} from '../sdk-connectors'

interface BookingEmailData {
  title: string
  hostName: string
  guestName: string
  startTime: string
  endTime?: string
  meetLink?: string
}

interface BookingRescheduleEmailData extends BookingEmailData {
  oldStartTime: string
  oldEndTime?: string
  reasonForChange: string
}

interface UseIntegrationsReturn {
  // Integration status (from SDK)
  isCalendarConnected: boolean
  isGmailConnected: boolean
  isLoading: boolean
  
  // Refresh status from DeepSpace
  refreshStatus: () => Promise<void>
  
  // Get OAuth URLs for connecting integrations
  getCalendarAuthUrl: (returnUrl?: string) => Promise<string | null>
  getGmailAuthUrl: (returnUrl?: string) => Promise<string | null>
  
  // Disconnect Google integration
  disconnectGoogle: () => Promise<boolean>
  
  // Calendar operations
  createCalendarEvent: (event: {
    title: string
    description: string
    startTime: string
    endTime: string
    attendeeEmail?: string
    addVideoConferencing?: boolean
  }) => Promise<{ meetLink?: string; eventId?: string; htmlLink?: string; requiresOAuth?: boolean; authUrl?: string }>
  
  // Email operations (with booking-specific templates)
  sendConfirmationEmail: (to: string, booking: BookingEmailData) => Promise<{ success: boolean; requiresOAuth?: boolean; authUrl?: string }>
  sendCancellationEmail: (to: string, booking: BookingEmailData) => Promise<{ success: boolean; requiresOAuth?: boolean; authUrl?: string }>
  sendRescheduleEmail: (to: string, booking: BookingRescheduleEmailData) => Promise<{ success: boolean; requiresOAuth?: boolean; authUrl?: string }>
  
  // Loading states
  isCreatingEvent: boolean
  isSendingEmail: boolean
  isDisconnecting: boolean
  error: string | null
}

export function useIntegrations(): UseIntegrationsReturn {
  // Use SDK hooks
  const {
    isCalendarConnected,
    isGmailConnected,
    isLoading,
    isDisconnecting,
    refreshStatus,
    connect,
    disconnect,
    error: connectorError,
  } = useGoogleConnector()
  
  const {
    createEvent,
    isCreating: isCreatingEvent,
    error: calendarError,
  } = useGoogleCalendar()
  
  const {
    sendEmail,
    isSending: isSendingEmail,
    error: gmailError,
  } = useGmail()
  
  // Convenience wrappers for auth URLs
  const getCalendarAuthUrl = useCallback(async (returnUrl?: string): Promise<string | null> => {
    return connect('calendar', returnUrl)
  }, [connect])
  
  const getGmailAuthUrl = useCallback(async (returnUrl?: string): Promise<string | null> => {
    return connect('gmail', returnUrl)
  }, [connect])
  
  // Wrapper for calendar event creation with BookMe-specific interface
  const createCalendarEvent = useCallback(async (event: {
    title: string
    description: string
    startTime: string
    endTime: string
    attendeeEmail?: string
    addVideoConferencing?: boolean
  }): Promise<{
    meetLink?: string
    eventId?: string
    htmlLink?: string
    requiresOAuth?: boolean
    authUrl?: string
  }> => {
    const result = await createEvent({
      title: event.title,
      description: event.description,
      start: event.startTime,
      end: event.endTime,
      addVideoConferencing: event.addVideoConferencing ?? true,
      attendees: event.attendeeEmail ? [event.attendeeEmail] : undefined,
    })
    
    return {
      meetLink: result.meetLink,
      eventId: result.eventId,
      htmlLink: result.htmlLink,
      requiresOAuth: result.requiresOAuth,
      authUrl: result.authUrl,
    }
  }, [createEvent])
  
  // Booking confirmation email
  const sendConfirmationEmail = useCallback(async (
    to: string,
    booking: BookingEmailData
  ): Promise<{ success: boolean; requiresOAuth?: boolean; authUrl?: string }> => {
    const startDate = new Date(booking.startTime)
    const endDate = booking.endTime ? new Date(booking.endTime) : null
    
    const subject = `Booking Confirmed: ${booking.title} with ${booking.hostName}`
    const content = `Hi ${booking.guestName},

Your booking has been confirmed!

**${booking.title}**
With: ${booking.hostName}
Date: ${startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Time: ${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${endDate ? ` - ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
${booking.meetLink ? `\nJoin meeting: ${booking.meetLink}` : ''}

Looking forward to meeting with you!

Best,
${booking.hostName}`
    
    const result = await sendEmail({
      recipient: to,
      subject,
      content,
    })
    
    return {
      success: result.success ?? false,
      requiresOAuth: result.requiresOAuth,
      authUrl: result.authUrl,
    }
  }, [sendEmail])
  
  // Booking cancellation email
  const sendCancellationEmail = useCallback(async (
    to: string,
    booking: BookingEmailData
  ): Promise<{ success: boolean; requiresOAuth?: boolean; authUrl?: string }> => {
    const startDate = new Date(booking.startTime)
    
    const subject = `Booking Cancelled: ${booking.title}`
    const content = `Hi ${booking.guestName},

Your booking has been cancelled.

**${booking.title}**
With: ${booking.hostName}
Date: ${startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

We hope to connect with you another time.

Best,
${booking.hostName}`
    
    const result = await sendEmail({
      recipient: to,
      subject,
      content,
    })
    
    return {
      success: result.success ?? false,
      requiresOAuth: result.requiresOAuth,
      authUrl: result.authUrl,
    }
  }, [sendEmail])

  const sendRescheduleEmail = useCallback(async (
    to: string,
    booking: BookingRescheduleEmailData
  ): Promise<{ success: boolean; requiresOAuth?: boolean; authUrl?: string }> => {
    const newStart = new Date(booking.startTime)
    const newEnd = booking.endTime ? new Date(booking.endTime) : null
    const oldStart = new Date(booking.oldStartTime)
    const oldEnd = booking.oldEndTime ? new Date(booking.oldEndTime) : null

    const subject = `Meeting Rescheduled: ${booking.title}`
    const content = `Hi,

This meeting has been rescheduled.

**${booking.title}**
With: ${booking.hostName} & ${booking.guestName}

**Former time**
${oldStart.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
${oldStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${oldEnd ? ` - ${oldEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}

**New time**
${newStart.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
${newStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${newEnd ? ` - ${newEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}

**Reason for change**
${booking.reasonForChange}

${booking.meetLink ? `Join meeting: ${booking.meetLink}` : ''}

Best,
${booking.hostName}`

    const result = await sendEmail({
      recipient: to,
      subject,
      content,
    })

    return {
      success: result.success ?? false,
      requiresOAuth: result.requiresOAuth,
      authUrl: result.authUrl,
    }
  }, [sendEmail])
  
  // Combine errors
  const error = connectorError || calendarError || gmailError
  
  return {
    isCalendarConnected,
    isGmailConnected,
    isLoading,
    
    refreshStatus,
    getCalendarAuthUrl,
    getGmailAuthUrl,
    disconnectGoogle: disconnect,
    
    createCalendarEvent,
    
    sendConfirmationEmail,
    sendCancellationEmail,
    sendRescheduleEmail,
    
    isCreatingEvent,
    isSendingEmail,
    isDisconnecting,
    error,
  }
}
