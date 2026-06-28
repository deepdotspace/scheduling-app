/**
 * Integrations Hook
 *
 * BookMe-specific wrapper over the DeepSpace Google connector. Exposes Google connection
 * status plus connect/disconnect helpers. Transactional booking email is sent server-side
 * from the schedule / cancel / reschedule actions (see lib/booking-email-server.ts), not here.
 */

import { useCallback } from 'react'
import { useGoogleConnector } from '../sdk-connectors'

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

  // Loading / error states
  isDisconnecting: boolean
  error: string | null
}

export function useIntegrations(): UseIntegrationsReturn {
  const {
    isCalendarConnected,
    isGmailConnected,
    isLoading,
    isDisconnecting,
    refreshStatus,
    connect,
    disconnect,
    error,
  } = useGoogleConnector()

  const getCalendarAuthUrl = useCallback(async (returnUrl?: string): Promise<string | null> => {
    return connect('calendar', returnUrl)
  }, [connect])

  const getGmailAuthUrl = useCallback(async (returnUrl?: string): Promise<string | null> => {
    return connect('gmail', returnUrl)
  }, [connect])

  return {
    isCalendarConnected,
    isGmailConnected,
    isLoading,

    refreshStatus,
    getCalendarAuthUrl,
    getGmailAuthUrl,
    disconnectGoogle: disconnect,

    isDisconnecting,
    error,
  }
}
