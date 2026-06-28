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
  /**
   * Resend (or provider) via api-worker `email/send`. Billed to the signed-in caller: booking is
   * sign-in-only, so the user who triggers a send (the booker on schedule, the initiator on
   * cancel/reschedule) pays from their own credits rather than the app owner footing every email.
   * Note: cron reminder sends have no caller and stay on the app-owner identity (see src/cron.ts).
   */
  email: { billing: 'user' },

  /**
   * Google Workspace (Calendar, Gmail, Drive) — paths like `google/calendar-list-events`.
   * First path segment is `google`; user JWT is required.
   */
  google: { billing: 'user' },

  status: { billing: 'user' },
  'oauth': { billing: 'user' },
  'booking-create-event': { billing: 'developer' },
}
