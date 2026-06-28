/**
 * Event Types Page
 *
 * Aura-scheduling inspired list layout: event type cards with preview modal.
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Clock, Plus, Users, ChevronLeft, ExternalLink, Share2, Video, Layers, Eye, Link2, Power, PowerOff, MoreVertical, Check } from 'lucide-react'
import { useEventTypes, useProfile, useAvailability } from '../hooks'
import { useUsers } from 'deepspace'
import { ConfirmDialog } from '../components/ui'
import { PageHeader } from '../components/PageHeader'
import { ShareModal } from '../components/ShareModal'
import { EventTypeDetailPanel, type EventTypeFormData, type PanelTab } from '../components/EventTypeDetailPanel'
import { useSidebar } from '../context/SidebarContext'
import { meetingLocationLabel, EVENT_COLORS } from '../constants'
import type { EventType } from '../constants'

/** Matches the dashed “Create New Event Type” row at the end of the list */
const createEventTypeDashedButtonClass =
  'group flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 p-2.5 text-xs font-bold text-gray-500 transition-all hover:border-gray-400 hover:bg-gray-50 hover:text-[#111827] md:rounded-xl md:p-4 md:text-sm'

const defaultFormData: EventTypeFormData = {
  title: '',
  description: '',
  duration: 30,
  location: 'deepspace-meets',
  color: EVENT_COLORS[0],
  sendGoogleCalendarInvite: false,
  sendDeepSpaceMail: false,
  sendExternalEmail: true,
  bufferBefore: 0,
  bufferAfter: 0,
  durations: [],
  availabilityScheduleId: '',
  maxAttendees: 0,
  isRoundRobin: false,
  teamMemberIds: [],
  bookingQuestions: [],
}

/** Aura-style event preview modal */
function EventPreviewModal({ event, hostName, onClose, onEdit }: {
  event: EventType
  hostName: string
  onClose: () => void
  onEdit: () => void
}) {
  const durationLabel = event.durations.length > 0
    ? event.durations.map(d => `${d}m`).join(' / ')
    : `${event.duration}m`
  const bookingUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/book/${hostName}/${event.id}`
    : ''
  const [linkCopied, setLinkCopied] = useState(false)
  const handleCopyLink = () => {
    if (!bookingUrl) return
    navigator.clipboard.writeText(bookingUrl)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden bg-white rounded-xl border border-gray-200 shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <h2 className="text-lg font-semibold text-[#111827]">Event Preview</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-8 overflow-y-auto max-h-[70vh]">
          <div className="flex items-start gap-5 mb-8">
            <div className="w-14 h-14 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-[#111827] shrink-0">
              <Clock className="w-7 h-7" />
            </div>
            <div>
              <p className="text-[12px] font-bold text-gray-500 uppercase tracking-widest mb-1">{hostName}</p>
              <h3 className="text-2xl font-bold text-[#111827] mb-1.5 tracking-tight">{event.title}</h3>
              <div className="flex items-center gap-3 text-sm font-medium text-gray-500">
                <span className="flex items-center gap-1.5 tracking-tight"><Clock className="w-4 h-4" /> {durationLabel}</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {event.maxAttendees > 1 ? 'Group' : '1-on-1'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <section>
              <h4 className="text-xs font-bold text-[#111827] uppercase tracking-widest mb-3 flex items-center gap-2">
                <Video className="w-3.5 h-3.5 text-gray-500" />
                Location
              </h4>
              <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-200">
                <p className="text-sm text-[#111827] font-medium">{meetingLocationLabel(event.location)}</p>
                <p className="text-xs text-gray-500 mt-0.5">Link will be provided after booking</p>
              </div>
            </section>

            <section>
              <h4 className="text-xs font-bold text-[#111827] uppercase tracking-widest mb-3 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-gray-500" />
                Description
              </h4>
              <p className="text-sm text-gray-500 leading-relaxed">
                {event.description || 'No description provided.'}
              </p>
            </section>

            <section>
              <h4 className="text-xs font-bold text-[#111827] uppercase tracking-widest mb-3 flex items-center gap-2">
                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                Event Link
              </h4>
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={!bookingUrl}
                aria-label={linkCopied ? 'Link copied' : 'Copy event link'}
                className="flex w-full items-center gap-2 p-3.5 rounded-lg bg-gray-50 border border-gray-200 group cursor-pointer hover:border-gray-300 transition-all text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                <code className="text-xs font-mono text-[#111827] flex-1 truncate">{bookingUrl.replace(/^https?:\/\//, '')}</code>
                {linkCopied
                  ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                  : <Share2 className="w-3.5 h-3.5 text-gray-500 group-hover:text-[#111827] transition-colors" />}
              </button>
            </section>

            {event.bookingQuestions && event.bookingQuestions.length > 0 && (
              <section>
                <h4 className="text-xs font-bold text-[#111827] uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5 text-gray-500" />
                  Attendee Questions
                </h4>
                <div className="space-y-2.5">
                  {event.bookingQuestions.map(q => (
                    <div key={q.id} className="p-3.5 rounded-lg border border-gray-200">
                      <p className="text-[12px] font-bold text-gray-500 mb-1">Question</p>
                      <p className="text-sm text-[#111827] font-medium">{q.label}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="app-btn-secondary text-sm">Close</button>
          <button type="button" onClick={onEdit} className="app-btn-primary text-sm">Edit Event Type</button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export default function EventTypesPage() {
  const { eventTypes, createEventType, updateEventType, deleteEventType, toggleEventType } = useEventTypes()
  const { profile } = useProfile()
  const { availability, schedules } = useAvailability()
  const { users } = useUsers()
  const sidebar = useSidebar()

  const [editingEvent, setEditingEvent] = useState<EventType | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const panelCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [formData, setFormData] = useState<EventTypeFormData>(defaultFormData)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [previewEvent, setPreviewEvent] = useState<EventType | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('basics')

  useEffect(() => {
    if (!openMenuId) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-event-menu]')) setOpenMenuId(null)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [openMenuId])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const openPanel = () => {
    if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
    setIsPanelOpen(true)
    setPanelVisible(true)
    sidebar?.closeSidebar()
  }

  const handleCreate = () => {
    setEditingEvent(null)
    setFormData({ ...defaultFormData, color: EVENT_COLORS[eventTypes.length % EVENT_COLORS.length] })
    setActiveTab('basics')
    openPanel()
  }

  const handleEdit = (eventType: EventType) => {
    setEditingEvent(eventType)
    setFormData({
      title: eventType.title,
      description: eventType.description,
      duration: eventType.duration,
      location: eventType.location,
      color: eventType.color,
      sendGoogleCalendarInvite: eventType.sendGoogleCalendarInvite,
      sendDeepSpaceMail: eventType.sendDeepSpaceMail,
      sendExternalEmail: eventType.sendExternalEmail,
      bufferBefore: eventType.bufferBefore,
      bufferAfter: eventType.bufferAfter,
      durations: eventType.durations,
      availabilityScheduleId: eventType.availabilityScheduleId,
      maxAttendees: eventType.maxAttendees,
      isRoundRobin: eventType.isRoundRobin,
      teamMemberIds: eventType.teamMemberIds,
      bookingQuestions: eventType.bookingQuestions,
    })
    setActiveTab('basics')
    openPanel()
  }

  const handleClosePanel = () => {
    setPanelVisible(false)
    panelCloseTimer.current = setTimeout(() => {
      setIsPanelOpen(false)
      setEditingEvent(null)
      setFormData(defaultFormData)
    }, 300)
  }
  
  const handleSubmit = () => {
    if (!formData.title) return

    if (editingEvent) {
      updateEventType(editingEvent.id, formData)
    } else {
      createEventType({
        ...formData,
        isActive: true,
      })
    }

    handleClosePanel()
  }
  
  const handleDelete = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = () => {
    if (deleteConfirmId) {
      deleteEventType(deleteConfirmId)
      setDeleteConfirmId(null)
    }
  }


  return (
    <div
      data-testid="event-types-page"
      className="flex flex-col min-h-0 overflow-hidden bg-[#F3F4F6] h-[calc(100vh-1px)]"
    >
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          className={`flex-1 flex flex-col min-h-0 p-2 min-w-0 md:p-4 ${
            panelVisible ? 'max-md:hidden' : ''
          }`}
        >
          <div className="max-w-[1600px] w-full flex flex-col min-h-0 px-1 flex-1 md:px-2">
      {previewEvent && profile?.username && (
        <EventPreviewModal
          event={previewEvent}
          hostName={profile.username}
          onClose={() => setPreviewEvent(null)}
          onEdit={() => { setPreviewEvent(null); handleEdit(previewEvent) }}
        />
      )}

      <PageHeader
        title={<h1 className="text-2xl font-bold text-[#111827] tracking-tight md:text-3xl">Event Types</h1>}
        subtitle={
          <p className="text-xs font-medium text-[#111827] md:text-sm">
            Create reusable links for your availability.
            {' '}
            <Link to="/availability" className="text-indigo-600 hover:underline">Set availability</Link>
          </p>
        }
        actions={
          eventTypes.length === 0 ? undefined : (
            <button
              data-testid="create-event-type-btn"
              type="button"
              onClick={handleCreate}
              className="app-btn-primary flex items-center gap-2 max-md:w-full max-md:justify-center max-md:py-2 max-md:text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              New Event Type
            </button>
          )
        }
      />

      {/* Aura-style list layout */}
      <div className="custom-scrollbar flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-200 bg-white p-2 md:rounded-xl md:p-4">
      {eventTypes.length === 0 ? (
        <div className="py-20 text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-gray-500 text-sm font-medium mb-4">No event types yet</p>
          <p className="text-gray-500 text-sm font-medium mb-6">Create your first event type to start accepting bookings.</p>
          <button
            data-testid="create-event-type-btn"
            type="button"
            onClick={handleCreate}
            className={`${createEventTypeDashedButtonClass} w-full max-w-sm mx-auto`}
          >
            <Plus className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span>Create New Event Type</span>
          </button>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2 md:gap-3">
          {eventTypes.map(eventType => {
            const durationLabel = eventType.durations.length > 0
              ? eventType.durations.map(d => `${d}m`).join(' / ')
              : `${eventType.duration}m`
            const bookingLink = profile?.username
              ? `${window.location.origin}/book/${profile.username}/${eventType.id}`
              : null

            return (
              <div
                key={eventType.id}
                data-testid={`event-type-card-${eventType.id}`}
                role="button"
                tabIndex={0}
                onClick={() => handleEdit(eventType)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEdit(eventType) } }}
                className={`group flex cursor-pointer flex-col gap-2 rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm transition-colors hover:bg-gray-50 max-md:min-w-0 md:flex-row md:items-center md:justify-between md:gap-0 md:rounded-xl md:p-4 ${!eventType.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 md:h-10 md:w-10">
                    <Clock className="h-4 w-4 text-gray-500 md:h-5 md:w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-1.5 md:gap-2">
                      <h3 className="truncate text-xs font-bold tracking-tight text-[#111827] md:text-sm">{eventType.title}</h3>
                      <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-bold uppercase tracking-tight text-gray-500 md:px-1.5 md:text-[12px]">
                        {durationLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 md:text-[12px]">
                      <Clock className="h-2.5 w-2.5 md:h-3 md:w-3" />
                      {eventType.maxAttendees > 1 ? 'Group' : '1-on-1'}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 max-md:w-full max-md:border-t max-md:border-gray-100 max-md:pt-2 md:ml-4 md:flex-nowrap md:gap-2 md:border-t-0 md:pt-0" onClick={e => e.stopPropagation()}>
                  {/* Hover-only action icons — appear to the left of Copy Link */}
                  <div className="hidden items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 md:flex">
                    <span className="relative group/icon">
                      <button
                        type="button"
                        className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 hover:text-[#111827] transition-colors"
                        aria-label="Preview"
                        onClick={() => setPreviewEvent(eventType)}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[11px] font-medium text-white bg-gray-900 rounded shadow-sm opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-opacity pointer-events-none whitespace-nowrap z-50">
                        Preview
                      </span>
                    </span>
                    <span className="relative group/icon">
                      <button
                        type="button"
                        className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 hover:text-[#111827] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Share"
                        disabled={!eventType.isActive || !bookingLink}
                        onClick={() => bookingLink && setShareUrl(bookingLink)}
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[11px] font-medium text-white bg-gray-900 rounded shadow-sm opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-opacity pointer-events-none whitespace-nowrap z-50">
                        Share
                      </span>
                    </span>
                    <span className="relative group/icon">
                      <button
                        type="button"
                        className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 hover:text-[#111827] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Book meeting"
                        disabled={!eventType.isActive || !bookingLink}
                        onClick={() => bookingLink && window.open(bookingLink, '_blank')}
                      >
                        <Link2 className="w-4 h-4" />
                      </button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[11px] font-medium text-white bg-gray-900 rounded shadow-sm opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-opacity pointer-events-none whitespace-nowrap z-50">
                        Book meeting
                      </span>
                    </span>
                    <span className="relative group/icon">
                      <button
                        type="button"
                        className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 hover:text-[#111827] transition-colors"
                        aria-label={eventType.isActive ? 'Deactivate' : 'Activate'}
                        onClick={() => { toggleEventType(eventType.id); setPreviewEvent(null) }}
                      >
                        {eventType.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[11px] font-medium text-white bg-gray-900 rounded shadow-sm opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-opacity pointer-events-none whitespace-nowrap z-50">
                        {eventType.isActive ? 'Deactivate' : 'Activate'}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="app-btn-secondary py-1 px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-50 md:py-1.5 md:px-3 md:text-[12px]"
                    onClick={() => bookingLink && handleCopy(bookingLink, eventType.id)}
                    disabled={!eventType.isActive || !bookingLink}
                  >
                    {copiedId === eventType.id ? 'Copied!' : 'Copy Link'}
                  </button>
                  <div className="relative" data-event-menu>
                    <button
                      type="button"
                      className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent md:p-1.5"
                      aria-label="More options"
                      aria-expanded={openMenuId === eventType.id}
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === eventType.id ? null : eventType.id) }}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {openMenuId === eventType.id && (
                      <div className="absolute right-0 top-full mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                        <button
                          type="button"
                          onClick={() => { handleEdit(eventType); setOpenMenuId(null) }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 text-[#111827]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => { toggleEventType(eventType.id); setPreviewEvent(null); setOpenMenuId(null) }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 text-[#111827]"
                        >
                          {eventType.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { handleDelete(eventType.id); setOpenMenuId(null) }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          <button
            type="button"
            onClick={handleCreate}
            className={createEventTypeDashedButtonClass}
          >
            <Plus className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span>Create New Event Type</span>
          </button>
        </div>
      )}
      </div>
          </div>
        </div>

        <div
          className={`flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out shrink-0 min-w-0 ${
            panelVisible ? 'w-full md:w-[480px]' : 'w-0'
          }`}
        >
          {isPanelOpen && (
            <EventTypeDetailPanel
              event={editingEvent}
              formData={formData}
              onFormDataChange={setFormData}
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              onClose={handleClosePanel}
              onSubmit={handleSubmit}
              onDelete={editingEvent ? () => handleDelete(editingEvent.id) : undefined}
              availability={availability}
              schedules={schedules}
              users={users}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDelete}
        title="Delete Event Type"
        message="Are you sure you want to delete this event type? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        modalVariant="light"
      />

      {/* Share Modal (QR code popup) */}
      {shareUrl && (
        <ShareModal
          isOpen={!!shareUrl}
          onClose={() => setShareUrl(null)}
          url={shareUrl}
          title="Share Booking Link"
        />
      )}
    </div>
  )
}

