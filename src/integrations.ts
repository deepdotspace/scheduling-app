/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default). Works for anonymous users.
 * - 'user': The calling user pays. Requires sign-in.
 *
 * Integrations not listed here default to 'developer'.
 */

export const integrations: Record<string, { billing: 'developer' | 'user' }> = {
  /** Resend (or provider) via api-worker `email/send` */
  email: { billing: 'developer' },

  /**
   * Google Workspace (Calendar, Gmail, Drive) — paths like `google/calendar-list-events`.
   * First path segment is `google`; user JWT is required.
   */
  google: { billing: 'user' },

  status: { billing: 'user' },
  /** Legacy path if still routed by api-worker */
  'google-disconnect': { billing: 'user' },
  'send-email': { billing: 'user' },
  'booking-create-event': { billing: 'developer' },
}
