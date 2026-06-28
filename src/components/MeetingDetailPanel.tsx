/**
 * MeetingDetailPanel
 *
 * Right-side detail panel for a selected meeting. Details and Questions tabs.
 */

import { useState } from 'react'
import { X, Clock, Video, Mail, MapPin, Trash2 } from 'lucide-react'
import { QuickTooltip } from './ui'
import { formatDate, formatTime, meetingLocationLabel } from '../constants'
import type { BookingQuestion } from '../constants'
import type { BookingWithRole } from '../hooks/useBookings'
import type { CounterpartyDisplay } from '../lib/meeting-counterparty'

function getTimeRange(startTime: string, endTime: string): string {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`
}

function getDurationMinutes(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  return Math.round((end - start) / 60000)
}


interface EventTypeInfo {
  title: string
  description: string
  duration: number
  location: string
  bookingQuestions: BookingQuestion[]
}

function getMeetingStatusLabel(booking: BookingWithRole): string {
  if (booking.status === 'cancelled') return 'Cancelled'
  if (booking.status === 'no_show') return 'No show'
  const now = new Date()
  const start = new Date(booking.startTime)
  if (booking.status === 'confirmed') {
    return start.getTime() > now.getTime() ? 'Upcoming' : 'Past'
  }
  return 'Past'
}

interface MeetingDetailPanelProps {
  booking: BookingWithRole
  /** The other participant (guest if you host, host if you're the guest) */
  counterparty: CounterpartyDisplay
  eventType?: EventTypeInfo
  onClose: () => void
  onCancel: () => void
  canCancel: boolean
  /** Optional: when provided, a Reschedule button is shown for confirmed, upcoming meetings */
  onReschedule?: () => void
  /** Host opens confirm modal to mark past confirmed meeting as no-show */
  onRequestMarkNoShow?: () => void
  canMarkNoShow?: boolean
  isMarkNoShowPending?: boolean
  /** Host: revert no-show immediately (no modal) */
  onUndoNoShow?: () => void
  canUndoNoShow?: boolean
  isUndoNoShowPending?: boolean
  /** Past, cancelled, or no-show: open confirm to permanently remove booking for everyone */
  onRequestPermanentDelete?: () => void
  canDeletePermanently?: boolean
  isPermanentDeletePending?: boolean
}

export { getMeetingStatusLabel }

type PanelTab = 'details' | 'questions' | 'additionalInfo'

export function MeetingDetailPanel({
  booking,
  counterparty,
  eventType,
  onClose,
  onCancel,
  canCancel,
  onReschedule,
  onRequestMarkNoShow,
  canMarkNoShow,
  isMarkNoShowPending,
  onUndoNoShow,
  canUndoNoShow,
  isUndoNoShowPending,
  onRequestPermanentDelete,
  canDeletePermanently,
  isPermanentDeletePending,
}: MeetingDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('details')
  const duration = getDurationMinutes(booking.startTime, booking.endTime)
  const isPast = new Date(booking.startTime) <= new Date()
  const wasRescheduled = Boolean(booking.reasonForChange?.trim() || booking.rescheduleEmail?.trim())
  const timeStatusLabel = getMeetingStatusLabel(booking)
  const dateTimeStr = `${formatDate(booking.startTime)} at ${formatTime(booking.startTime)}`
  const locationLabel = meetingLocationLabel(eventType?.location)
  const bookingQuestions = eventType?.bookingQuestions ?? []

  return (
    <div className="flex flex-col h-full min-h-0 bg-white border-l border-[var(--color-app-border)] w-full min-w-[380px] max-w-[480px] shrink-0 overflow-hidden self-stretch">
      {/* Header: Meeting, event name, status — X on right */}
      <div className="flex items-start justify-between gap-4 px-6 py-4 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1">
            Meeting
          </p>
          <h2 className="text-xl font-bold text-[var(--color-app-text)] tracking-tight truncate">
            {booking.eventTitle}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {booking.status === 'confirmed' && wasRescheduled && (
              <span className="px-2.5 py-1 text-[12px] font-bold rounded-md uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
                Rescheduled
              </span>
            )}
            <span
              className={`px-2.5 py-1 text-[12px] font-bold rounded-md uppercase tracking-wider ${
                timeStatusLabel === 'Upcoming'
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                  : timeStatusLabel === 'No show'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : timeStatusLabel === 'Past'
                      ? 'bg-gray-100 text-gray-600 border border-gray-200'
                      : 'bg-red-50 text-red-600 border border-red-100'
              }`}
            >
              {timeStatusLabel}
            </span>
            <span className="text-[12px] font-medium text-[var(--color-app-text-muted)]">
              {dateTimeStr}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-50 transition-colors text-[var(--color-app-text-muted)] shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Details / Questions / Additional Information tabs */}
      <div className="flex items-center gap-1 px-6 pt-4 border-b border-[var(--color-app-border)] shrink-0">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-3 py-2 text-[12px] font-bold rounded-t-md transition-colors focus-visible:outline-none ${
            activeTab === 'details'
              ? 'border-b-2 border-[var(--color-app-text)] -mb-px text-[var(--color-app-text)]'
              : 'text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)]'
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setActiveTab('questions')}
          className={`px-3 py-2 text-[12px] font-bold rounded-t-md transition-colors focus-visible:outline-none ${
            activeTab === 'questions'
              ? 'border-b-2 border-[var(--color-app-text)] -mb-px text-[var(--color-app-text)]'
              : 'text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)]'
          }`}
        >
          Questions
        </button>
        <button
          onClick={() => setActiveTab('additionalInfo')}
          className={`px-3 py-2 text-[12px] font-bold rounded-t-md transition-colors focus-visible:outline-none ${
            activeTab === 'additionalInfo'
              ? 'border-b-2 border-[var(--color-app-text)] -mb-px text-[var(--color-app-text)]'
              : 'text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)]'
          }`}
        >
          Additional Information
        </button>
      </div>

      {/* Tab content — independent scroll, does not affect middle section */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide px-6 py-4">
        {activeTab === 'details' && (
          <div className="space-y-3">
            {/* Date & Time */}
            <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30">
              <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">Date & Time</p>
              <p className="text-sm font-semibold text-[var(--color-app-text)]">{formatDate(booking.startTime)}</p>
              <p className="text-sm text-[var(--color-app-text-muted)] flex items-center gap-1.5 mt-0.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {getTimeRange(booking.startTime, booking.endTime)}
                <span className="text-[var(--color-app-border)]">·</span>
                {duration} min
              </p>
            </div>

            {/* Attendee */}
            <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30">
              <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">
                {booking.role === 'host' ? 'Guest' : 'Host'}
              </p>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white border border-[var(--color-app-border)] flex items-center justify-center text-sm font-bold text-[var(--color-app-text)] shrink-0 overflow-hidden">
                  {counterparty.imageUrl ? (
                    <img
                      src={counterparty.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span aria-hidden>{counterparty.name.charAt(0) || counterparty.email.charAt(0) || '?'}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-app-text)] truncate">{counterparty.name}</p>
                  <p className="text-xs text-[var(--color-app-text-muted)] flex items-center gap-1.5 mt-0.5 truncate">
                    <Mail className="w-3 h-3 shrink-0" />
                    {counterparty.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30">
              <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">Location</p>
              <p className="text-sm font-medium text-[var(--color-app-text)] flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-[var(--color-app-text-muted)] shrink-0" />
                {locationLabel}
              </p>
            </div>

            {/* DeepSpace video meeting link */}
            <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30">
              <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">
                DeepSpace meeting
              </p>
              {booking.meetingLink?.trim() ? (
                <p className="text-sm font-medium text-[var(--color-app-text)] flex items-start gap-2 m-0">
                  <Video className="w-3.5 h-3.5 text-[var(--color-app-text-muted)] shrink-0 mt-0.5" aria-hidden />
                  <span className="break-all min-w-0 select-text">{booking.meetingLink.trim()}</span>
                </p>
              ) : (
                <p className="text-sm font-medium text-[var(--color-app-text-muted)] flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  —
                </p>
              )}
            </div>

            {/* Reschedule audit — single card below location (email + reason) */}
            {wasRescheduled && (booking.rescheduleEmail?.trim() || booking.reasonForChange?.trim()) && (
              <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30 space-y-3">
                {booking.rescheduleEmail?.trim() && (
                  <div>
                    <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">
                      Reschedule request email
                    </p>
                    <p className="text-sm text-[var(--color-app-text)] flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3.5 h-3.5 shrink-0 text-[var(--color-app-text-muted)]" />
                      <span className="break-all">{booking.rescheduleEmail.trim()}</span>
                    </p>
                  </div>
                )}
                {booking.reasonForChange?.trim() && (
                  <div className={booking.rescheduleEmail?.trim() ? 'pt-2 border-t border-[var(--color-app-border)]' : ''}>
                    <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">
                      Reason for reschedule
                    </p>
                    <p className="text-sm text-[var(--color-app-text)] leading-relaxed whitespace-pre-wrap">
                      {booking.reasonForChange.trim()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Description — only shown if the event type has one */}
            {eventType?.description && (
              <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30">
                <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-1.5">About this meeting</p>
                <p className="text-sm text-[var(--color-app-text)] leading-relaxed">{eventType.description}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="space-y-4">
            <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">Attendee Questions</p>
            {bookingQuestions.length === 0 ? (
              <p className="text-sm font-medium text-[var(--color-app-text-muted)]">
                No questions for this event type.
              </p>
            ) : (
              <div className="space-y-3">
                {bookingQuestions.map((q) => {
                  const raw = booking.answers?.[q.id]
                  const hasAnswer = raw !== undefined && raw !== null && raw !== ''
                  const displayAnswer = hasAnswer
                    ? typeof raw === 'boolean'
                      ? raw ? 'Yes' : 'No'
                      : String(raw)
                    : null
                  return (
                    <div key={q.id} className="rounded-xl border border-[var(--color-app-border)] bg-gray-50/30 overflow-hidden">
                      <div className="px-3 py-2 border-b border-[var(--color-app-border)] bg-gray-100/60">
                        <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">Question</p>
                        <p className="text-sm font-semibold text-[var(--color-app-text)] mt-0.5">{q.label}</p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">Answer</p>
                        <p className={`text-sm mt-0.5 ${hasAnswer ? 'font-medium text-[var(--color-app-text)]' : 'italic text-[var(--color-app-text-muted)]'}`}>
                          {hasAnswer ? displayAnswer : 'Answer not provided'}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'additionalInfo' && (
          <div className="space-y-4">
            <p className="text-[11px] font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest">Additional Information</p>
            <div className="p-3 rounded-xl border border-[var(--color-app-border)] bg-gray-50/30">
              <p className={`text-sm leading-relaxed ${booking.additionalInfo?.trim() ? 'font-medium text-[var(--color-app-text)]' : 'italic text-[var(--color-app-text-muted)]'}`}>
                {booking.additionalInfo?.trim() || 'No additional information provided.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer: Join / Reschedule / Cancel — always one row, compact on narrow widths */}
      <div className="px-3 sm:px-6 py-3 border-t border-[var(--color-app-border)] bg-gray-50/30 shrink-0 flex flex-nowrap items-stretch gap-1 w-full min-w-0">
        {booking.status !== 'cancelled' && booking.meetingLink && (
          <QuickTooltip label={isPast ? 'Meeting link' : 'Join meeting'}>
            <a
              href={booking.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[2.25rem] w-full min-w-0 flex-1 flex-col"
            >
              <button
                type="button"
                className={
                  isPast
                    ? 'app-btn-secondary flex h-full min-h-[2.25rem] w-full flex-1 items-center justify-center gap-0.5 py-1.5 px-1 text-[9px] font-bold uppercase leading-tight tracking-wider sm:gap-1 sm:px-1.5 sm:text-[10px]'
                    : 'app-btn-primary flex h-full min-h-[2.25rem] w-full flex-1 items-center justify-center gap-0.5 py-1.5 px-1 text-[9px] font-bold uppercase leading-tight tracking-wider sm:gap-1 sm:px-1.5 sm:text-[10px]'
                }
              >
                <Video className="h-3 w-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{isPast ? 'Meeting link' : 'Join meeting'}</span>
              </button>
            </a>
          </QuickTooltip>
        )}
        {booking.status === 'confirmed' && !isPast && onReschedule && (
          <QuickTooltip label="Reschedule this meeting">
            <button
              type="button"
              onClick={onReschedule}
              aria-label="Reschedule this meeting"
              className="app-btn-secondary min-h-[2.25rem] w-full flex-1 py-1.5 px-1 text-[9px] font-bold uppercase tracking-wider sm:px-1.5 sm:text-[10px]"
            >
              <span className="block truncate">Reschedule</span>
            </button>
          </QuickTooltip>
        )}
        {booking.status === 'confirmed' && !isPast && canCancel && (
          <QuickTooltip label="Cancel meeting">
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel meeting"
              className="app-btn-secondary min-h-[2.25rem] w-full flex-1 border-red-200 py-1.5 px-1 text-[9px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-50 sm:px-1.5 sm:text-[10px]"
            >
              <span className="block truncate">Cancel meeting</span>
            </button>
          </QuickTooltip>
        )}
        {canMarkNoShow && onRequestMarkNoShow && (
          <QuickTooltip label="Mark as no-show" interactionBlocked={Boolean(isMarkNoShowPending)}>
            <button
              type="button"
              onClick={onRequestMarkNoShow}
              disabled={isMarkNoShowPending}
              aria-label="Mark meeting as no-show"
              className="app-btn-primary min-h-[2.25rem] w-full flex-1 py-1.5 px-1 text-[9px] font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50 sm:px-1.5 sm:text-[10px]"
            >
              <span className="block truncate">Mark as no-show</span>
            </button>
          </QuickTooltip>
        )}
        {canUndoNoShow && onUndoNoShow && (
          <QuickTooltip label="Undo no-show" interactionBlocked={Boolean(isUndoNoShowPending)}>
            <button
              type="button"
              onClick={onUndoNoShow}
              disabled={isUndoNoShowPending}
              aria-label="Undo no-show"
              className="app-btn-secondary min-h-[2.25rem] w-full flex-1 border-gray-300 py-1.5 px-1 text-[9px] font-bold uppercase tracking-wider text-gray-800 hover:bg-gray-100 disabled:opacity-50 sm:px-1.5 sm:text-[10px]"
            >
              <span className="block truncate">{isUndoNoShowPending ? '…' : 'Undo no-show'}</span>
            </button>
          </QuickTooltip>
        )}
        {canDeletePermanently && onRequestPermanentDelete && (
          <QuickTooltip label="Delete permanently" interactionBlocked={Boolean(isPermanentDeletePending)}>
            <button
              type="button"
              onClick={onRequestPermanentDelete}
              disabled={isPermanentDeletePending}
              aria-label="Permanently delete this meeting from BookWithMe"
              className="app-btn-secondary flex min-h-[2.25rem] w-full flex-1 items-center justify-center gap-0.5 border-red-200 py-1.5 px-1 text-[9px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:gap-1 sm:px-1.5 sm:text-[10px]"
            >
              <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
              <span className="block truncate">Delete</span>
            </button>
          </QuickTooltip>
        )}
      </div>
    </div>
  )
}
