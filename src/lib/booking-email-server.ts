/**
 * Send transactional mail via DeepSpace api-worker integration `email/send`
 * (called from server actions with tools.integration).
 */
import type { ActionTools } from './action-types'
import type { TransactionalEmailSend } from './booking-email-templates'

const ENDPOINT = 'email/send'

function integrationServiceError(data: unknown): string | undefined {
  if (data && typeof data === 'object' && data !== null && 'error' in data) {
    const e = (data as { error?: unknown }).error
    return typeof e === 'string' ? e : undefined
  }
  return undefined
}

export async function sendTransactionalEmail(
  tools: ActionTools,
  send: TransactionalEmailSend,
): Promise<{ ok: boolean; error?: string }> {
  const res = await tools.integration(ENDPOINT, {
    to: send.to,
    subject: send.subject,
    html: send.html,
    ...(send.replyTo ? { replyTo: send.replyTo } : {}),
  })
  const nested = integrationServiceError(res.data)
  if (res.success && !nested) return { ok: true }
  return { ok: false, error: nested ?? res.error ?? 'email/send failed' }
}

export async function sendTransactionalEmailBatch(
  tools: ActionTools,
  sends: TransactionalEmailSend[],
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  for (const s of sends) {
    const r = await sendTransactionalEmail(tools, s)
    if (!r.ok && r.error) errors.push(`${s.to}: ${r.error}`)
  }
  return { ok: errors.length === 0, errors }
}
