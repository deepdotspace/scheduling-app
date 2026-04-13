/**
 * Transactional booking email HTML — shared by server actions (email/send) and client DM copy.
 */

import {
  generateGoogleCalendarUrl,
  formatEmailDateAndTimeRange,
  formatEmailDateAndOptionalEndRange,
} from '../constants'

function resolveIanaTimezone(explicit: string | undefined): string {
  const t = explicit?.trim()
  if (t) return t
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface EmailActionButton {
  href: string
  label: string
  primary: boolean
}

interface BookMeEmailOptions {
  headline: string
  badge: { label: string; color: string }
  recipientName: string
  introHtml: string
  cardTitle: string
  detailRows: ReadonlyArray<{ label: string; value: string }>
  extraCardHtml?: string
  actionButtons?: ReadonlyArray<EmailActionButton>
  closingLine: string
  hostName: string
  hostEmail?: string
  footerReplyEmail?: string
}

export function buildBookMeEmail(opts: BookMeEmailOptions): string {
  const {
    headline,
    badge,
    recipientName,
    introHtml,
    cardTitle,
    detailRows,
    extraCardHtml,
    actionButtons,
    closingLine,
    hostName,
    hostEmail,
    footerReplyEmail,
  } = opts

  const footerMailTarget = footerReplyEmail ?? hostEmail

  const detailRowsHtml = detailRows
    .map(
      r =>
        `<tr>
          <td style="padding:5px 16px 5px 0;font-size:13px;color:#6B7280;font-weight:600;white-space:nowrap;vertical-align:top;">${r.label}</td>
          <td style="padding:5px 0;font-size:13px;color:#111827;vertical-align:top;">${r.value}</td>
        </tr>`,
    )
    .join('')

  const buttonsHtml =
    actionButtons
      ?.map(
        btn =>
          `<a href="${btn.href}" style="display:inline-block;background:${btn.primary ? '#111111' : '#F3F4F6'};color:${btn.primary ? '#ffffff' : '#111827'};padding:11px 22px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;border:1px solid ${btn.primary ? '#111111' : '#E5E7EB'};margin:0 8px 8px 0;">${btn.label}</a>`,
      )
      .join('') ?? ''

  const footerReply = footerMailTarget
    ? ` You can reply directly to <a href="mailto:${footerMailTarget}" style="color:#6B7280;text-decoration:underline;">${footerMailTarget}</a>.`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${headline}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;">
        <tr><td style="background:#111111;border-radius:8px 8px 0 0;padding:18px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <span style="font-size:17px;font-weight:900;font-style:italic;color:#ffffff;letter-spacing:-0.3px;">Book Me</span>
            </td>
            <td align="right" style="vertical-align:middle;"><span style="display:inline-block;background:${badge.color};color:#ffffff;font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">${badge.label}</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#ffffff;padding:32px 28px 28px;">
          <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:#111827;letter-spacing:-0.4px;">${headline}</h1>
          <p style="margin:0 0 6px 0;font-size:15px;color:#374151;line-height:1.6;">Hi ${recipientName},</p>
          <p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">${introHtml}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#111827;">${cardTitle}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${detailRowsHtml}</table>
              ${extraCardHtml ?? ''}
              ${buttonsHtml ? `<div style="margin-top:20px;">${buttonsHtml}</div>` : ''}
            </td></tr>
          </table>
          <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">${closingLine}</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;border-radius:0 0 8px 8px;padding:16px 28px;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">
            This email was sent by <strong style="color:#6B7280;">BookMe</strong> on behalf of ${hostName}.${footerReply}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()
}

export interface TransactionalEmailSend {
  to: string
  subject: string
  html: string
  replyTo?: string
}

export interface ConfirmedBookingEmailInput {
  hostName: string
  hostEmail: string
  guestName: string
  guestEmail: string
  eventTitle: string
  startTime: string
  endTime: string
  meetingLink: string
  additionalInfo?: string
  guestTimezone?: string
  hostTimezone?: string
}

/** One or two sends (guest + host) for booking confirmed — mirrors prior client behavior. */
export function buildConfirmedBookingSends(p: ConfirmedBookingEmailInput): TransactionalEmailSend[] {
  const guestTz = resolveIanaTimezone(p.guestTimezone)
  const hostTz = resolveIanaTimezone(p.hostTimezone)
  const guestSlot = formatEmailDateAndTimeRange(p.startTime, p.endTime, guestTz)
  const hostSlot = formatEmailDateAndTimeRange(p.startTime, p.endTime, hostTz)
  const detailRowsGuest: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Date', value: guestSlot.dateLine },
    { label: 'Time', value: guestSlot.timeLine },
  ]
  const detailRowsHost: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Date', value: hostSlot.dateLine },
    { label: 'Time', value: hostSlot.timeLine },
  ]
  const calendarUrl = generateGoogleCalendarUrl({
    title: `${p.eventTitle} with ${p.hostName}`,
    startTime: p.startTime,
    endTime: p.endTime,
    description: `Join meeting: ${p.meetingLink}${p.additionalInfo ? `\n\n${p.additionalInfo}` : ''}`,
    location: p.meetingLink,
  })
  const guestTo = p.guestEmail.trim()
  const hostTo = p.hostEmail.trim()
  if (!guestTo) return []

  const sameAddress =
    hostTo !== '' && guestTo !== '' && guestTo.toLowerCase() === hostTo.toLowerCase()

  if (sameAddress) {
    const combinedHtml = buildBookMeEmail({
      headline: 'Booking Confirmed',
      badge: { label: 'Confirmed', color: '#10b981' },
      recipientName: p.guestName,
      introHtml: `Your booking with <strong>${p.hostName}</strong> has been confirmed. You are seeing one message because guest and host use the same email address.`,
      cardTitle: p.eventTitle,
      detailRows: [
        { label: 'Guest', value: escapeHtmlForEmail(p.guestName) },
        { label: 'Guest email', value: escapeHtmlForEmail(guestTo) },
        { label: 'Host', value: escapeHtmlForEmail(p.hostName) },
        ...detailRowsGuest,
      ],
      actionButtons: [
        { href: p.meetingLink, label: 'Join Meeting', primary: true },
        { href: calendarUrl, label: 'Add to Google Calendar', primary: false },
      ],
      closingLine: 'Looking forward to the meeting.',
      hostName: p.hostName,
      hostEmail: p.hostEmail,
    })
    return [
      {
        to: guestTo,
        subject: `Booking Confirmed: ${p.eventTitle} with ${p.hostName}`,
        html: combinedHtml,
        replyTo: p.hostEmail,
      },
    ]
  }

  const guestHtml = buildBookMeEmail({
    headline: 'Booking Confirmed',
    badge: { label: 'Confirmed', color: '#10b981' },
    recipientName: p.guestName,
    introHtml: `Your booking with <strong>${p.hostName}</strong> has been confirmed.`,
    cardTitle: p.eventTitle,
    detailRows: [...detailRowsGuest, { label: 'Host', value: p.hostName }],
    actionButtons: [
      { href: p.meetingLink, label: 'Join Meeting', primary: true },
      { href: calendarUrl, label: 'Add to Google Calendar', primary: false },
    ],
    closingLine: 'Looking forward to meeting with you!',
    hostName: p.hostName,
    hostEmail: p.hostEmail,
  })

  const out: TransactionalEmailSend[] = [
    {
      to: guestTo,
      subject: `Booking Confirmed: ${p.eventTitle} with ${p.hostName}`,
      html: guestHtml,
      replyTo: p.hostEmail,
    },
  ]

  if (hostTo && hostTo.toLowerCase() !== guestTo.toLowerCase()) {
    const hostHtml = buildBookMeEmail({
      headline: 'New booking',
      badge: { label: 'Confirmed', color: '#10b981' },
      recipientName: escapeHtmlForEmail(p.hostName),
      introHtml: `<strong>${escapeHtmlForEmail(p.guestName)}</strong> (${escapeHtmlForEmail(guestTo)}) booked a meeting with you.`,
      cardTitle: p.eventTitle,
      detailRows: [
        { label: 'Guest', value: escapeHtmlForEmail(p.guestName) },
        { label: 'Guest email', value: escapeHtmlForEmail(guestTo) },
        ...detailRowsHost,
      ],
      actionButtons: [
        { href: p.meetingLink, label: 'Join Meeting', primary: true },
        { href: calendarUrl, label: 'Add to Google Calendar', primary: false },
      ],
      closingLine: 'You will see this meeting in your BookMe calendar.',
      hostName: p.hostName,
      hostEmail: p.hostEmail,
      footerReplyEmail: guestTo,
    })
    out.push({
      to: hostTo,
      subject: `New booking: ${p.eventTitle} — ${p.guestName}`,
      html: hostHtml,
      replyTo: guestTo,
    })
  }

  return out
}

export interface CancellationTransactionalInput {
  initiatedBy?: 'host' | 'guest'
  hostName: string
  hostEmail: string
  guestName: string
  guestEmail: string
  eventTitle: string
  startTime: string
  endTime?: string
  cancelledEntireSeries?: boolean
  guestTimezone?: string
  hostTimezone?: string
}

export function buildCancellationEmailSend(p: CancellationTransactionalInput): TransactionalEmailSend | null {
  const to =
    p.initiatedBy === 'host' || p.initiatedBy === undefined
      ? p.guestEmail.trim()
      : p.hostEmail.trim()
  if (!to) return null

  const isGuestCancel = p.initiatedBy === 'guest'
  const guestTz = resolveIanaTimezone(p.guestTimezone)
  const hostTz = resolveIanaTimezone(p.hostTimezone)
  const recipientTz = isGuestCancel ? hostTz : guestTz
  const cancelSlot = formatEmailDateAndOptionalEndRange(p.startTime, p.endTime, recipientTz)
  const seriesNoteHtml = p.cancelledEntireSeries
    ? `<p style="margin:12px 0 0 0;padding-top:12px;border-top:1px solid #E5E7EB;font-size:13px;color:#6B7280;"><strong style="color:#111827;">All sessions</strong> in this recurring booking have been cancelled.</p>`
    : ''

  const emailHtml = isGuestCancel
    ? buildBookMeEmail({
        headline: 'Booking Cancelled',
        badge: { label: 'Cancelled', color: '#ef4444' },
        recipientName: escapeHtmlForEmail(p.hostName),
        introHtml: `<strong>${escapeHtmlForEmail(p.guestName)}</strong> has cancelled their booking with you.`,
        cardTitle: p.eventTitle,
        detailRows: [
          { label: 'Date', value: cancelSlot.dateLine },
          { label: 'Time', value: cancelSlot.timeLine },
          { label: 'Guest', value: escapeHtmlForEmail(p.guestName) },
          { label: 'Guest email', value: escapeHtmlForEmail(p.guestEmail) },
        ],
        extraCardHtml: seriesNoteHtml,
        closingLine: 'The time slot has been freed up for new bookings.',
        hostName: p.hostName,
        hostEmail: p.hostEmail || undefined,
        footerReplyEmail: p.guestEmail || undefined,
      })
    : buildBookMeEmail({
        headline: 'Booking Cancelled',
        badge: { label: 'Cancelled', color: '#ef4444' },
        recipientName: p.guestName,
        introHtml: `<strong>${p.hostName}</strong> has cancelled your booking.`,
        cardTitle: p.eventTitle,
        detailRows: [
          { label: 'Date', value: cancelSlot.dateLine },
          { label: 'Time', value: cancelSlot.timeLine },
          { label: 'Host', value: p.hostName },
        ],
        extraCardHtml: seriesNoteHtml,
        closingLine: "If you'd like to book another time, visit your host's booking page when you're ready.",
        hostName: p.hostName,
        hostEmail: p.hostEmail || undefined,
      })

  const replyTo =
    p.initiatedBy === 'host' || p.initiatedBy === undefined
      ? (p.hostEmail.trim() || undefined)
      : (p.guestEmail.trim() || undefined)

  return {
    to,
    subject: `Booking cancelled: ${p.eventTitle}`,
    html: emailHtml,
    replyTo,
  }
}

export interface RescheduleTransactionalInput {
  initiatedBy: 'host' | 'guest'
  hostName: string
  hostEmail: string
  guestName: string
  guestEmail: string
  eventTitle: string
  oldStartTime: string
  oldEndTime: string
  newStartTime: string
  newEndTime: string
  meetingLink: string
  additionalInfo?: string
  reasonForChange: string
  guestTimezone?: string
  hostTimezone?: string
}

export function buildRescheduleEmailSend(p: RescheduleTransactionalInput): TransactionalEmailSend | null {
  const to = p.initiatedBy === 'host' ? p.guestEmail.trim() : p.hostEmail.trim()
  if (!to) return null

  const recipientName = p.initiatedBy === 'host' ? p.guestName : p.hostName
  const safeRecipient = escapeHtmlForEmail(recipientName)
  const safeTitle = escapeHtmlForEmail(p.eventTitle)
  const safeHost = escapeHtmlForEmail(p.hostName)
  const replyTo =
    p.initiatedBy === 'host'
      ? (p.hostEmail.trim() || undefined)
      : (p.guestEmail.trim() || undefined)

  const actorNameSafe =
    p.initiatedBy === 'host' ? safeHost : escapeHtmlForEmail(p.guestName)
  const actorSentence =
    p.initiatedBy === 'host'
      ? `<strong>${actorNameSafe}</strong> has rescheduled your meeting to a new time.`
      : `<strong>${actorNameSafe}</strong> has rescheduled this meeting to a new time.`

  const guestTz = resolveIanaTimezone(p.guestTimezone)
  const hostTz = resolveIanaTimezone(p.hostTimezone)
  const recipientTz = p.initiatedBy === 'host' ? guestTz : hostTz

  const former = formatEmailDateAndTimeRange(p.oldStartTime, p.oldEndTime, recipientTz)
  const next = formatEmailDateAndTimeRange(p.newStartTime, p.newEndTime, recipientTz)
  const oldCombined = `${former.dateLine}, ${former.timeLine}`
  const calendarUrl = generateGoogleCalendarUrl({
    title: `${p.eventTitle} with ${p.hostName}`,
    startTime: p.newStartTime,
    endTime: p.newEndTime,
    description: `Join meeting: ${p.meetingLink}${p.additionalInfo ? `\n\n${p.additionalInfo}` : ''}`,
    location: p.meetingLink,
  })

  const reasonHtml = escapeHtmlForEmail(p.reasonForChange.trim())
  const reasonCardHtml = `<div style="margin-top:14px;padding-top:14px;border-top:1px solid #E5E7EB;">
        <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#111827;">Reason for change</p>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap;">${reasonHtml}</p>
      </div>`

  const emailHtml = buildBookMeEmail({
    headline: 'Meeting Rescheduled',
    badge: { label: 'Rescheduled', color: '#f59e0b' },
    recipientName: safeRecipient,
    introHtml: actorSentence,
    cardTitle: safeTitle,
    detailRows: [
      { label: 'Former time', value: oldCombined },
      { label: 'New date', value: next.dateLine },
      { label: 'New time', value: next.timeLine },
      { label: 'Host', value: safeHost },
    ],
    extraCardHtml: reasonCardHtml,
    actionButtons: [
      { href: p.meetingLink, label: 'Join Meeting', primary: true },
      { href: calendarUrl, label: 'Add to Google Calendar', primary: false },
    ],
    closingLine: 'See you at the new time.',
    hostName: p.hostName,
    hostEmail: replyTo,
  })

  return {
    to,
    subject: `Meeting rescheduled: ${p.eventTitle}`,
    html: emailHtml,
    replyTo,
  }
}
