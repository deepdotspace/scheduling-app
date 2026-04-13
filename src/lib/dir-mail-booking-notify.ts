/**
 * DeepSpace Mail directory (`dir:mail`) threads for BookMe — mirrors the host's
 * event-type "DeepSpace Mail notification" toggle (sendDeepSpaceMail).
 * Client WebSocket DMs (app:mail) are separate; keep behavior aligned.
 */

import type { ActionContext } from 'deepspace/worker'

export function getSendDeepSpaceMailFromEventTypeData(etData: Record<string, unknown>): boolean {
  return (etData.sendDeepSpaceMail as boolean) ?? false
}

export async function createDirMailBookingNotification(
  ctx: ActionContext,
  p: {
    sendDeepSpaceMail: boolean
    eventTypeId: string
    /** Stable-ish unique id for ParticipantHash (one thread per logical notification) */
    participantHash: string
    conversationTitle: string
    messageBody: string
    guestName: string
    hostUserId: string
    guestUserId?: string
  },
): Promise<void> {
  if (!p.sendDeepSpaceMail) return

  const mailDirScope = 'dir:mail'
  const mailParticipantList = Array.from(
    new Set([p.hostUserId, p.guestUserId, ctx.userId].filter(Boolean) as string[]),
  )
  const mailParticipants = JSON.stringify(mailParticipantList)

  const mailResult = await ctx.tools.create(mailDirScope, 'conversations', {
    Name: p.conversationTitle,
    Description: p.guestName,
    Type: 'dm',
    Visibility: 'private',
    CreatedBy: ctx.userId,
    ParticipantHash: p.participantHash,
    ParticipantIds: mailParticipants,
    Status: 'active',
    AssigneeId: '',
    LinkedRef: JSON.stringify({ source: 'book-me', eventTypeId: p.eventTypeId }),
    LastMessageAt: new Date().toISOString(),
    LastMessagePreview: p.messageBody.slice(0, 100),
    LastMessageAuthor: ctx.userId,
  })

  const mailConvId = (mailResult.data as { recordId?: string })?.recordId
  if (mailConvId) {
    await ctx.tools.create(`conv:${mailConvId}`, 'conv_messages', {
      Content: p.messageBody,
      AuthorId: ctx.userId,
      ParentId: '',
      Edited: 0,
      MessageType: 'system',
      Metadata: JSON.stringify({ source: 'book-me', eventTypeId: p.eventTypeId }),
    })
  }
}
