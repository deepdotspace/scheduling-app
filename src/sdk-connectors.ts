/**
 * BookMe — connectors previously from @spaces/sdk/connectors.
 * Uses `integration` from deepspace (same-origin /api/integrations/* proxy).
 */
import { useState, useCallback, useEffect } from 'react'
import { integration } from 'deepspace'

/** Dev-only: helps fix Google `redirect_uri_mismatch` — register the printed URL in GCP OAuth client. */
function logGoogleRedirectUriFromAuthUrl(authUrl: string) {
  if (!import.meta.env.DEV) return
  try {
    const u = new URL(authUrl)
    const ru = u.searchParams.get('redirect_uri')
    if (ru) {
      console.info(
        '[BookMe] Google OAuth — add this exact Authorized redirect URI in Google Cloud Console (Credentials → OAuth 2.0 Client):\n',
        decodeURIComponent(ru),
      )
    }
  } catch {
    /* ignore */
  }
}

// ── Google connector (shared status) ───────────────────────────────
type GoogleService = 'calendar' | 'gmail' | 'drive'

interface IntegrationStatus {
  google: {
    connected: boolean
    gmail: boolean
    calendar: boolean
    drive: boolean
  }
}

type Listener = (status: IntegrationStatus | null, loading: boolean) => void

let sharedStatus: IntegrationStatus | null = null
let sharedLoading = true
let fetchInFlight: Promise<void> | null = null
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l(sharedStatus, sharedLoading)
}

async function doFetchStatus() {
  sharedLoading = true
  notify()
  try {
    const result = await integration.get<{
      google?: IntegrationStatus['google']
      data?: IntegrationStatus
    }>('status')
    const data = result.data ?? (result as unknown as { google?: IntegrationStatus['google'] })
    const g = (data as { data?: IntegrationStatus }).data?.google ?? (data as { google?: IntegrationStatus['google'] }).google
    if (g) {
      sharedStatus = { google: g }
    } else {
      sharedStatus = { google: { connected: false, gmail: false, calendar: false, drive: false } }
    }
  } catch {
    sharedStatus = { google: { connected: false, gmail: false, calendar: false, drive: false } }
  } finally {
    sharedLoading = false
    fetchInFlight = null
    notify()
  }
}

function ensureFetched() {
  if (!fetchInFlight && sharedStatus === null) {
    fetchInFlight = doFetchStatus()
  }
}

export function useGoogleConnector() {
  const [status, setStatus] = useState<IntegrationStatus | null>(sharedStatus)
  const [isLoading, setIsLoading] = useState(sharedLoading)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const listener: Listener = (s, l) => {
      setStatus(s)
      setIsLoading(l)
    }
    listeners.add(listener)
    ensureFetched()
    setStatus(sharedStatus)
    setIsLoading(sharedLoading)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    if (fetchInFlight) await fetchInFlight
    fetchInFlight = doFetchStatus()
    await fetchInFlight
  }, [])

  /**
   * There is no `google-auth-url` integration. OAuth is bootstrapped by POSTing to a Google
   * endpoint without `accessToken`; the response includes `requiresOAuth` + `authUrl`.
   * @see DeepSpace api-worker google handlers
   */
  const getAuthUrl = useCallback(async (service: GoogleService, returnUrl?: string) => {
    const body: Record<string, unknown> = {}
    if (returnUrl) body.returnUrl = returnUrl

    const endpoint =
      service === 'calendar'
        ? 'google/calendar-list-events'
        : service === 'gmail'
          ? 'google/gmail-list'
          : 'google/drive-list'

    try {
      const result = await integration.post<{
        requiresOAuth?: boolean
        authUrl?: string
        scopes?: string[]
      }>(endpoint, body)

      if (!result.success) return null
      const payload = result.data ?? result
      if (
        payload &&
        typeof payload === 'object' &&
        'requiresOAuth' in payload &&
        payload.requiresOAuth &&
        typeof (payload as { authUrl?: string }).authUrl === 'string'
      ) {
        const url = (payload as { authUrl: string }).authUrl
        logGoogleRedirectUriFromAuthUrl(url)
        return url
      }
      return null
    } catch {
      return null
    }
  }, [])

  const connect = useCallback(
    (service: GoogleService, returnUrl?: string) => getAuthUrl(service, returnUrl),
    [getAuthUrl],
  )

  const disconnect = useCallback(async () => {
    try {
      setIsDisconnecting(true)
      setError(null)
      await integration.delete('oauth/google/disconnect', {})
      await refreshStatus()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
      return false
    } finally {
      setIsDisconnecting(false)
    }
  }, [refreshStatus])

  return {
    status,
    isLoading,
    isDisconnecting,
    isCalendarConnected: status?.google?.calendar ?? false,
    isGmailConnected: status?.google?.gmail ?? false,
    isDriveConnected: status?.google?.drive ?? false,
    refreshStatus,
    getAuthUrl,
    connect,
    disconnect,
    error,
  }
}

export function useGoogleCalendar() {
  const [isCreating, setIsCreating] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createEvent = useCallback(
    async (event: {
      title: string
      description?: string
      start: string
      end: string
      allDay?: boolean
      addVideoConferencing?: boolean
      attendees?: string[]
    }) => {
      setIsCreating(true)
      setError(null)
      try {
        const result = await integration.post<{
          requiresOAuth?: boolean
          authUrl?: string
          id?: string
          htmlLink?: string
          meetLink?: string
          created?: Array<{
            id: string
            htmlLink?: string
            meetLink?: string
          }>
        }>('google/calendar-create-event', {
          title: event.title,
          description: event.description,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          addVideoConferencing: event.addVideoConferencing ?? false,
          attendees: event.attendees,
        })
        if (!result.success) return {}
        const payload = result.data ?? result
        if (payload && typeof payload === 'object' && 'requiresOAuth' in payload && payload.requiresOAuth) {
          return { requiresOAuth: true as const, authUrl: payload.authUrl }
        }
        const p = payload as {
          id?: string
          htmlLink?: string
          meetLink?: string
          created?: Array<{ id: string; htmlLink?: string; meetLink?: string }>
        }
        const first = p.created?.[0]
        return {
          eventId: first?.id ?? p.id,
          htmlLink: first?.htmlLink ?? p.htmlLink,
          meetLink: first?.meetLink ?? p.meetLink,
          created: p.created,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create event'
        setError(message)
        return {}
      } finally {
        setIsCreating(false)
      }
    },
    [],
  )

  const getEvents = useCallback(async (startDate: string, endDate: string) => {
    setIsFetching(true)
    setError(null)
    try {
      const result = await integration.post<{ events?: unknown[]; requiresOAuth?: boolean; authUrl?: string }>(
        'google/calendar-list-events',
        { timeMin: startDate, timeMax: endDate },
      )
      if (!result.success) return []
      const payload = result.data ?? result
      if (payload && typeof payload === 'object' && 'requiresOAuth' in payload && payload.requiresOAuth) {
        return []
      }
      return (payload as { events?: unknown[] }).events ?? []
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
      return []
    } finally {
      setIsFetching(false)
    }
  }, [])

  return { createEvent, getEvents, isCreating, isFetching, error }
}

export function useGmail() {
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function textToHtml(text: string): string {
    return text
      .replace(/\n/g, '<br/>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
  }

  const sendEmail = useCallback(
    async (email: { recipient: string; subject: string; content: string; html?: string }) => {
      setIsSending(true)
      setError(null)
      try {
        const result = await integration.post<{
          requiresOAuth?: boolean
          authUrl?: string
          messageId?: string
        }>('send-email', {
          recipient: email.recipient,
          subject: email.subject,
          content: email.content,
          html: email.html || textToHtml(email.content),
        })
        const payload = result.data ?? result
        if (payload && typeof payload === 'object' && 'requiresOAuth' in payload && payload.requiresOAuth) {
          return { success: false, requiresOAuth: true as const, authUrl: payload.authUrl }
        }
        return { success: true, messageId: (payload as { messageId?: string }).messageId }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send email'
        setError(message)
        return { success: false }
      } finally {
        setIsSending(false)
      }
    },
    [],
  )

  return { sendEmail, isSending, error }
}

export function useBookingCalendar() {
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createBookingEvent = useCallback(
    async (input: {
      hostClerkUserId: string
      title: string
      description?: string
      startTime: string
      endTime: string
      guestEmail: string
      addVideoConferencing?: boolean
    }) => {
      setIsCreating(true)
      setError(null)
      try {
        const result = await integration.post<{
          success?: boolean
          error?: string
          hostNotConnected?: boolean
          rateLimited?: boolean
          eventId?: string
          htmlLink?: string
          meetLink?: string
        }>('booking-create-event', input)
        const payload = result.data ?? result
        return payload as {
          success: boolean
          error?: string
          hostNotConnected?: boolean
          rateLimited?: boolean
          eventId?: string
          htmlLink?: string
          meetLink?: string
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create event'
        setError(errorMessage)
        return { success: false, error: errorMessage }
      } finally {
        setIsCreating(false)
      }
    },
    [],
  )

  return { createBookingEvent, isCreating, error }
}
