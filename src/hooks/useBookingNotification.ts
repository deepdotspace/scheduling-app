/**
 * useBookingNotification — DeepSpace Mail DM side effects after booking lifecycle events.
 *
 * Transactional email (confirm / reschedule / cancel) is sent from server actions via
 * `tools.integration('email/send', …)` — see schedule-event, reschedule-booking, cancel-booking.
 *
 * This hook only handles optional in-app DeepSpace Mail DMs when both parties are platform users.
 */

import { useCallback } from 'react'
import { useUser } from 'deepspace'
import { formatDualPartyOptionalEndForDm, formatDualPartyTimeRangeForDm } from '../constants'

const DEEPSPACE_MAIL_SCOPE = 'app:mail'

function resolveIanaTimezone(explicit: string | undefined): string {
  const t = explicit?.trim()
  if (t) return t
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

// WebSocket protocol message types
const MSG_PUT = 5

interface BookingNotificationParams {
  hostUserId: string
  hostName: string
  hostEmail: string
  guestName: string
  guestEmail: string
  guestUserId?: string
  eventTitle: string
  startTime: string
  endTime: string
  meetingLink: string
  additionalInfo?: string
  sendDeepSpaceMail?: boolean
  guestTimezone?: string
  hostTimezone?: string
}

/** Cancel → optional DeepSpace Mail DM (internal guests only). */
export interface CancellationNotificationParams {
  initiatedBy?: 'host' | 'guest'
  hostName: string
  hostEmail: string
  hostUserId?: string
  guestName: string
  guestEmail: string
  guestUserId?: string
  eventTitle: string
  startTime: string
  endTime?: string
  cancelledEntireSeries?: boolean
  sendDeepSpaceMail?: boolean
  guestTimezone?: string
  hostTimezone?: string
}

export interface CancellationEmailResult {
  success: boolean
  error?: string
  skipped?: boolean
}

/** Reschedule → optional DeepSpace Mail DM (internal guests only). */
export interface RescheduleNotificationParams {
  initiatedBy: 'host' | 'guest'
  hostName: string
  hostEmail: string
  hostUserId?: string
  guestName: string
  guestEmail: string
  guestUserId?: string
  eventTitle: string
  oldStartTime: string
  oldEndTime: string
  newStartTime: string
  newEndTime: string
  meetingLink: string
  additionalInfo?: string
  reasonForChange: string
  sendDeepSpaceMail?: boolean
  guestTimezone?: string
  hostTimezone?: string
}

export type RescheduleEmailResult = CancellationEmailResult

async function withWebSocket(
  scopeId: string,
  token: string,
  userName: string | undefined,
  onReady: (ws: WebSocket) => void,
): Promise<void> {
  const params = new URLSearchParams()
  params.set('token', token)
  if (userName) params.set('userName', userName)

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${window.location.host}/platform/ws/${scopeId}?${params}`)

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`WebSocket timeout for ${scopeId}`))
    }, 10_000)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string)
      if (msg.type === 8) {
        onReady(ws)
        setTimeout(() => {
          clearTimeout(timeout)
          ws.close()
          resolve()
        }, 500)
      }
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket error for ${scopeId}`))
    }
  })
}

/**
 * Create a DeepSpace Mail DM conversation and post its single message over the WS protocol.
 * All branch-specific values (prefixes, ids, author fallbacks) are passed in explicitly so the
 * behaviour of each caller is preserved exactly.
 */
async function sendDmThread(opts: {
  token: string
  userName: string | undefined
  /** Prefix used for both the conversation Name and the message subject (e.g. 'Booking'). */
  namePrefix: string
  eventTitle: string
  createdBy: string
  participantHash: string
  participantIds: Array<string | undefined>
  lastMessageAt: string
  lastMessageAuthor: string
  authorId: string
  messageContent: string
  hostName: string
  guestName: string
}): Promise<void> {
  const convId = `dm-${crypto.randomUUID()}`

  await withWebSocket(DEEPSPACE_MAIL_SCOPE, opts.token, opts.userName, (ws) => {
    ws.send(
      JSON.stringify({
        type: MSG_PUT,
        payload: {
          collection: 'conversations',
          recordId: convId,
          data: {
            Name: `${opts.namePrefix}: ${opts.eventTitle}`,
            Description: '',
            Type: 'dm',
            CreatedBy: opts.createdBy,
            ParticipantHash: opts.participantHash,
            ParticipantIds: JSON.stringify(opts.participantIds),
            LastMessageAt: opts.lastMessageAt,
            LastMessagePreview: opts.messageContent.slice(0, 100),
            LastMessageAuthor: opts.lastMessageAuthor,
          },
        },
      }),
    )
  })

  await withWebSocket(`conv:${convId}`, opts.token, opts.userName, (ws) => {
    const metadata = {
      subject: `${opts.namePrefix}: ${opts.eventTitle}`,
      to: [opts.hostName, opts.guestName],
      cc: [] as string[],
      bcc: [] as string[],
      priority: 'normal',
    }

    ws.send(
      JSON.stringify({
        type: MSG_PUT,
        payload: {
          collection: 'conv_messages',
          recordId: `msg-${crypto.randomUUID()}`,
          data: {
            Content: opts.messageContent,
            AuthorId: opts.authorId,
            ParentId: '',
            Edited: 0,
            MessageType: 'email',
            Metadata: JSON.stringify(metadata),
          },
        },
      }),
    )
  })
}

function formatBookingMessage(p: BookingNotificationParams): string {
  const guestTz = resolveIanaTimezone(p.guestTimezone)
  const hostTz = resolveIanaTimezone(p.hostTimezone)
  const when = formatDualPartyTimeRangeForDm(p.startTime, p.endTime, guestTz, hostTz)
  return [
    `Booking Confirmed: ${p.eventTitle}`,
    '',
    `With: ${p.hostName} & ${p.guestName}`,
    '',
    when,
    '',
    `Join meeting: ${p.meetingLink}`,
  ].join('\n')
}

function formatCancellationMessage(p: CancellationNotificationParams): string {
  const guestTz = resolveIanaTimezone(p.guestTimezone)
  const hostTz = resolveIanaTimezone(p.hostTimezone)
  const when = formatDualPartyOptionalEndForDm(p.startTime, p.endTime, guestTz, hostTz)
  const actor = p.initiatedBy === 'guest' ? p.guestName : p.hostName
  const lines = [
    `Booking cancelled: ${p.eventTitle}`,
    '',
    `${actor} has cancelled this booking.`,
    `With: ${p.hostName} & ${p.guestName}`,
    '',
    when,
  ]
  if (p.cancelledEntireSeries) {
    lines.push('', 'All sessions in this recurring booking have been cancelled.')
  }
  return lines.join('\n')
}

function formatRescheduleMessage(p: RescheduleNotificationParams): string {
  const actor = p.initiatedBy === 'host' ? p.hostName : p.guestName
  const guestTz = resolveIanaTimezone(p.guestTimezone)
  const hostTz = resolveIanaTimezone(p.hostTimezone)
  const former = formatDualPartyTimeRangeForDm(p.oldStartTime, p.oldEndTime, guestTz, hostTz)
  const next = formatDualPartyTimeRangeForDm(p.newStartTime, p.newEndTime, guestTz, hostTz)
  const lines = [
    `Meeting rescheduled: ${p.eventTitle}`,
    '',
    `${actor} rescheduled this booking.`,
    `With: ${p.hostName} & ${p.guestName}`,
    '',
    'Former time:',
    former.replace(/^/gm, '  '),
    '',
    'New time:',
    next.replace(/^/gm, '  '),
    '',
    'Reason for change:',
    p.reasonForChange.trim() || '(none given)',
    '',
    `Join meeting: ${p.meetingLink}`,
  ]
  return lines.join('\n')
}

export function useBookingNotification() {
  const { user } = useUser()

  const sendInternalDM = useCallback(
    async (p: BookingNotificationParams) => {
      const { getAuthToken } = await import('deepspace')
      const token = await getAuthToken()
      if (!token) {
        console.warn('[BookMe] No auth token — skipping DM notification')
        return
      }

      const hash = [p.hostUserId, p.guestUserId!].sort().join(':')
      const messageContent = formatBookingMessage(p)

      await sendDmThread({
        token,
        userName: user?.name ?? undefined,
        namePrefix: 'Booking',
        eventTitle: p.eventTitle,
        createdBy: user?.id ?? p.guestUserId ?? '',
        participantHash: hash,
        participantIds: [p.hostUserId, p.guestUserId],
        lastMessageAt: new Date().toISOString(),
        lastMessageAuthor: user?.id ?? p.guestUserId ?? '',
        authorId: user?.id ?? '',
        messageContent,
        hostName: p.hostName,
        guestName: p.guestName,
      })
    },
    [user],
  )

  const sendInternalCancellationDM = useCallback(
    async (p: CancellationNotificationParams): Promise<void> => {
      const hostUserId = p.hostUserId?.trim() ?? ''
      const guestUserId = p.guestUserId?.trim() ?? ''
      if (!hostUserId || !guestUserId) {
        throw new Error('Missing host or guest user id for cancellation DM')
      }

      const { getAuthToken } = await import('deepspace')
      const token = await getAuthToken()
      if (!token) {
        throw new Error('No auth token for cancellation DM')
      }

      const hash = [hostUserId, guestUserId].sort().join(':')
      const messageContent = formatCancellationMessage(p)

      await sendDmThread({
        token,
        userName: user?.name ?? undefined,
        namePrefix: 'Cancelled',
        eventTitle: p.eventTitle,
        createdBy: user?.id ?? guestUserId,
        participantHash: hash,
        participantIds: [hostUserId, guestUserId],
        lastMessageAt: new Date().toISOString(),
        lastMessageAuthor: user?.id ?? '',
        authorId: user?.id ?? '',
        messageContent,
        hostName: p.hostName,
        guestName: p.guestName,
      })
    },
    [user],
  )

  const sendInternalRescheduleDM = useCallback(
    async (p: RescheduleNotificationParams): Promise<void> => {
      const hostUserId = p.hostUserId?.trim() ?? ''
      const guestUserId = p.guestUserId?.trim() ?? ''
      if (!hostUserId || !guestUserId) {
        throw new Error('Missing host or guest user id for reschedule DM')
      }

      const { getAuthToken } = await import('deepspace')
      const token = await getAuthToken()
      if (!token) {
        throw new Error('No auth token for reschedule DM')
      }

      const hash = [hostUserId, guestUserId].sort().join(':')
      const messageContent = formatRescheduleMessage(p)

      await sendDmThread({
        token,
        userName: user?.name ?? undefined,
        namePrefix: 'Rescheduled',
        eventTitle: p.eventTitle,
        createdBy: user?.id ?? guestUserId,
        participantHash: hash,
        participantIds: [hostUserId, guestUserId],
        lastMessageAt: new Date().toISOString(),
        lastMessageAuthor: user?.id ?? '',
        authorId: user?.id ?? '',
        messageContent,
        hostName: p.hostName,
        guestName: p.guestName,
      })
    },
    [user],
  )

  const notify = useCallback(
    async (p: BookingNotificationParams) => {
      if (!p.guestUserId) {
        return
      }
      if (p.sendDeepSpaceMail === false) {
        return
      }
      try {
        await sendInternalDM(p)
      } catch (err) {
        console.warn('[BookMe] DM notification failed:', err)
      }
    },
    [sendInternalDM],
  )

  const notifyCancellation = useCallback(
    async (p: CancellationNotificationParams): Promise<CancellationEmailResult> => {
      const hostUserId = p.hostUserId?.trim() ?? ''
      const guestUserId = p.guestUserId?.trim() ?? ''
      const isInternal = Boolean(hostUserId && guestUserId)

      if (!isInternal) {
        return { success: true }
      }

      if (p.sendDeepSpaceMail === false) {
        return { success: true }
      }

      try {
        await sendInternalCancellationDM(p)
        return { success: true }
      } catch (err) {
        console.warn('[BookMe] Cancellation DM notification failed:', err)
        return {
          success: false,
          error:
            'Could not notify the other participant in DeepSpace Mail. Your cancellation was saved.',
        }
      }
    },
    [sendInternalCancellationDM],
  )

  const notifyReschedule = useCallback(
    async (p: RescheduleNotificationParams): Promise<RescheduleEmailResult> => {
      const hostUserId = p.hostUserId?.trim() ?? ''
      const guestUserId = p.guestUserId?.trim() ?? ''
      const isInternal = Boolean(hostUserId && guestUserId)

      if (!isInternal) {
        return { success: true }
      }

      if (p.sendDeepSpaceMail === false) {
        return { success: true }
      }

      try {
        await sendInternalRescheduleDM(p)
        return { success: true }
      } catch (err) {
        console.warn('[BookMe] Reschedule DM notification failed:', err)
        return {
          success: false,
          error:
            'Could not notify the other participant in DeepSpace Mail. Your reschedule was saved.',
        }
      }
    },
    [sendInternalRescheduleDM],
  )

  return { notify, notifyCancellation, notifyReschedule, isSendingEmail: false }
}
