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
   * Resend (or provider) via api-worker `email/send`. Billed to the caller when there is one — the
   * booker on schedule, the initiator on cancel/reschedule — so a signed-in user pays for their own
   * mail rather than the app owner footing every email.
   *
   * Sends with no caller fall back to the app-owner identity in `createActionTools`: cron reminders
   * (see src/cron.ts) and the public booking path, where a signed-out guest has no credits to spend
   * and their confirmation carries the only cancel link they will ever get.
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
