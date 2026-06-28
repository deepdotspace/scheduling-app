/**
 * Meetings Page
 *
 * Aura-scheduling inspired layout: filter tabs, meeting cards, right-side detail panel.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useUser, useUserLookup } from 'deepspace'
import { Plus, Search, Mail } from 'lucide-react'
import { useBookings, useEventTypes, useBookingNotification, useProfile, showToast, useAvailability } from '../hooks'
import { Modal } from '../components/ui'
import { PageHeader } from '../components/PageHeader'
import { MeetingDetailPanel, getMeetingStatusLabel } from '../components/MeetingDetailPanel'
import { useSidebar } from '../context/SidebarContext'
import { formatDate, formatTime, DEFAULT_AVAILABILITY } from '../constants'
import type { BookingWithRole } from '../hooks/useBookings'
import {
  mergeBookingWithStoredRescheduleAudit,
  saveBookingRescheduleAudit,
} from '../lib/reschedule-audit-storage'
import { getCounterpartyDisplay } from '../lib/meeting-counterparty'
import { isBookingEligibleForPermanentDelete } from '../lib/booking-permanent-delete-eligibility'

type TabType = 'all' | 'upcoming' | 'past' | 'cancelled'

/** Passed from ReschedulePage via `<Link state={…} />` so the detail panel shows audit text immediately */
interface MeetingsNavigateState {
  rescheduleAudit?: {
    bookingId: string
    rescheduleEmail: string
    reasonForChange: string
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0] ?? '')
    .join('')
    .toUpperCase()
}

export default function MeetingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useUser()
  const {
    upcomingBookings,
    pastBookings,
    cancelledBookings,
    cancelBooking,
    markBookingNoShow,
    undoBookingNoShow,
    deleteBookingPermanently,
    bookings,
  } = useBookings()
  const { profile, profiles } = useProfile()
  const { userMap } = useUserLookup()
  const roomUsersById = useMemo(() => {
    const o: Record<string, { name: string; imageUrl?: string; email?: string }> = {}
    for (const [id, u] of userMap.entries()) {
      o[id] = { name: u.name, imageUrl: u.imageUrl, email: u.email }
    }
    return o
  }, [userMap])
  const { notifyCancellation, isSendingEmail } = useBookingNotification()
  const sidebar = useSidebar()

  const MEETINGS_PER_PAGE = 15
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cancelModalBooking, setCancelModalBooking] = useState<BookingWithRole | null>(null)
  const [cancelSeries, setCancelSeries] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelActionError, setCancelActionError] = useState<string | null>(null)
  const [noShowModal, setNoShowModal] = useState<null | { bookingId: string; guestName: string }>(null)
  const [isMarkNoShowPending, setIsMarkNoShowPending] = useState(false)
  const [isUndoNoShowPending, setIsUndoNoShowPending] = useState(false)
  const [deleteModalBooking, setDeleteModalBooking] = useState<BookingWithRole | null>(null)
  const [isDeletingPermanent, setIsDeletingPermanent] = useState(false)
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null)

  const allMeetings =
    activeTab === 'all'
      ? [...upcomingBookings, ...pastBookings, ...cancelledBookings]
      : activeTab === 'upcoming'
        ? upcomingBookings
        : activeTab === 'past'
          ? pastBookings
          : cancelledBookings

  /** All bookings with role (for URL param lookup) */
  const allBookingsWithRole = useMemo(
    () => [...upcomingBookings, ...pastBookings, ...cancelledBookings],
    [upcomingBookings, pastBookings, cancelledBookings]
  )

  // Derive live booking from the reactive list so reschedule/cancel changes are reflected immediately
  const selectedMeeting = useMemo(
    () => allBookingsWithRole.find(b => b.id === selectedMeetingId) ?? null,
    [allBookingsWithRole, selectedMeetingId]
  )

  /** Merge persisted reschedule audit (localStorage) so indicator survives panel close/reopen */
  const detailPanelBooking = useMemo((): BookingWithRole | null => {
    if (!selectedMeeting) return null
    return mergeBookingWithStoredRescheduleAudit(selectedMeeting)
  }, [selectedMeeting])

  const eventTypesOwnerId =
    detailPanelBooking?.hostUserId ??
    cancelModalBooking?.hostUserId ??
    user?.id
  const { eventTypes } = useEventTypes(eventTypesOwnerId)

  const cancelHostUserIdForAv = cancelModalBooking?.hostUserId ?? user?.id
  const { availability: cancelHostDefaultAvail, getScheduleById: cancelGetSchedule } = useAvailability(
    cancelHostUserIdForAv,
  )
  const cancelHostAvailability = useMemo(() => {
    if (!cancelModalBooking) return null
    const et = eventTypes.find(e => e.id === cancelModalBooking.eventTypeId)
    if (et?.availabilityScheduleId) {
      const s = cancelGetSchedule(et.availabilityScheduleId)
      if (s) return s
    }
    return cancelHostDefaultAvail
  }, [cancelModalBooking, eventTypes, cancelGetSchedule, cancelHostDefaultAvail])

  const eventTypeMap = useMemo(() => {
    const map = new Map<string, { title: string; description: string; duration: number; location: string; bookingQuestions: (typeof eventTypes)[number]['bookingQuestions'] }>()
    for (const et of eventTypes) map.set(et.id, { title: et.title, description: et.description, duration: et.duration, location: et.location, bookingQuestions: et.bookingQuestions })
    return map
  }, [eventTypes])

  const filteredMeetings = useMemo(() => {
    if (!searchQuery.trim()) return allMeetings
    const q = searchQuery.toLowerCase()
    return allMeetings.filter(b => {
      const cp = getCounterpartyDisplay(b, profiles, roomUsersById)
      return (
        b.eventTitle.toLowerCase().includes(q) ||
        b.guestName.toLowerCase().includes(q) ||
        b.hostName.toLowerCase().includes(q) ||
        b.guestEmail.toLowerCase().includes(q) ||
        (b.hostEmail?.toLowerCase().includes(q) ?? false) ||
        cp.name.toLowerCase().includes(q) ||
        cp.email.toLowerCase().includes(q)
      )
    })
  }, [allMeetings, searchQuery, profiles, roomUsersById])

  const totalPages = Math.max(1, Math.ceil(filteredMeetings.length / MEETINGS_PER_PAGE))
  const meetings = useMemo(() => {
    const start = (page - 1) * MEETINGS_PER_PAGE
    return filteredMeetings.slice(start, start + MEETINGS_PER_PAGE)
  }, [filteredMeetings, page])

  const handleCancel = async () => {
    if (!cancelModalBooking) return
    setIsCancelling(true)
    setCancelActionError(null)
    try {
      let allSucceeded = true
      if (cancelSeries && cancelModalBooking.seriesId) {
        const seriesBookings = bookings.filter(b =>
          b.seriesId === cancelModalBooking.seriesId && b.status === 'confirmed'
        )
        for (const b of seriesBookings) {
          const result = await cancelBooking(b.id)
          if (!result.success) {
            allSucceeded = false
            setCancelActionError(result.error ?? 'Failed to cancel one or more meetings')
            break
          }
        }
      } else {
        const result = await cancelBooking(cancelModalBooking.id)
        if (!result.success) {
          allSucceeded = false
          setCancelActionError(result.error ?? 'Failed to cancel meeting')
        }
      }
      if (!allSucceeded) return

      const eventTypeForCancel = eventTypes.find(et => et.id === cancelModalBooking.eventTypeId)
      const initiatedBy = cancelModalBooking.role === 'host' ? 'host' : 'guest'
      const hostEmailResolved =
        cancelModalBooking.hostEmail?.trim() ||
        (cancelModalBooking.role === 'host'
          ? profile?.email?.trim()
          : roomUsersById[cancelModalBooking.hostUserId]?.email?.trim()) ||
        ''

      const emailResult = await notifyCancellation({
        initiatedBy,
        hostName: cancelModalBooking.hostName,
        hostEmail: hostEmailResolved,
        hostUserId: cancelModalBooking.hostUserId,
        guestName: cancelModalBooking.guestName,
        guestEmail: cancelModalBooking.guestEmail,
        guestUserId: cancelModalBooking.guestUserId,
        eventTitle: cancelModalBooking.eventTitle,
        startTime: cancelModalBooking.startTime,
        endTime: cancelModalBooking.endTime,
        cancelledEntireSeries: cancelSeries && Boolean(cancelModalBooking.seriesId),
        sendDeepSpaceMail: eventTypeForCancel?.sendDeepSpaceMail ?? true,
        /** Stored at booking time (same as confirmation); do not use viewer browser for the guest. */
        guestTimezone: cancelModalBooking.guestTimezone?.trim() || undefined,
        /** Host’s schedule TZ; prefer value stored on booking, then loaded availability. */
        hostTimezone:
          cancelModalBooking.hostTimezone?.trim() ||
          (cancelHostAvailability?.timezone ??
            cancelHostDefaultAvail.timezone ??
            DEFAULT_AVAILABILITY.timezone),
      })
      if (!emailResult.success) {
        showToast(
          emailResult.error ??
            'Meeting was cancelled but the other participant could not be notified.',
          'info',
        )
      }
      setCancelModalBooking(null)
      setCancelSeries(false)
      setCancelActionError(null)
    } finally {
      setIsCancelling(false)
    }
  }

  const tabs: TabType[] = ['all', 'upcoming', 'past', 'cancelled']

  const handleSelectMeeting = (booking: BookingWithRole) => {
    if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
    setSelectedMeetingId(booking.id)
    setPanelOpen(true)
    sidebar?.closeSidebar()
  }

  const handleClosePanel = () => {
    setPanelOpen(false)
    panelCloseTimer.current = setTimeout(() => setSelectedMeetingId(null), 300)
  }

  const openMarkNoShowModal = () => {
    if (!detailPanelBooking || detailPanelBooking.role !== 'host') return
    setNoShowModal({
      bookingId: detailPanelBooking.id,
      guestName: detailPanelBooking.guestName,
    })
  }

  const confirmMarkNoShowModal = async () => {
    if (!noShowModal) return
    setIsMarkNoShowPending(true)
    try {
      const result = await markBookingNoShow(noShowModal.bookingId)
      if (result.success) {
        setNoShowModal(null)
        showToast('Marked as no-show', 'success')
      } else {
        showToast(result.error ?? 'Could not update meeting', 'error')
      }
    } finally {
      setIsMarkNoShowPending(false)
    }
  }

  const handleUndoNoShow = async () => {
    if (!detailPanelBooking || detailPanelBooking.role !== 'host') return
    setIsUndoNoShowPending(true)
    try {
      const result = await undoBookingNoShow(detailPanelBooking.id)
      if (result.success) {
        showToast('No-show reverted', 'success')
      } else {
        showToast(result.error ?? 'Could not update meeting', 'error')
      }
    } finally {
      setIsUndoNoShowPending(false)
    }
  }

  const canMarkNoShow =
    !!detailPanelBooking &&
    detailPanelBooking.role === 'host' &&
    detailPanelBooking.status === 'confirmed' &&
    new Date(detailPanelBooking.endTime).getTime() <= Date.now()

  const canUndoNoShow =
    !!detailPanelBooking &&
    detailPanelBooking.role === 'host' &&
    detailPanelBooking.status === 'no_show'

  const canDeletePermanently =
    !!detailPanelBooking && isBookingEligibleForPermanentDelete(detailPanelBooking)

  const openPermanentDeleteModal = () => {
    if (!detailPanelBooking || !isBookingEligibleForPermanentDelete(detailPanelBooking)) return
    setPermanentDeleteError(null)
    setDeleteModalBooking(detailPanelBooking)
  }

  const confirmPermanentDelete = async () => {
    if (!deleteModalBooking) return
    setIsDeletingPermanent(true)
    setPermanentDeleteError(null)
    try {
      const result = await deleteBookingPermanently(deleteModalBooking.id)
      if (result.success) {
        setDeleteModalBooking(null)
        showToast('Meeting removed from BookWithMe', 'success')
        if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
        setPanelOpen(false)
        setSelectedMeetingId(null)
      } else {
        setPermanentDeleteError(result.error ?? 'Could not delete meeting')
      }
    } finally {
      setIsDeletingPermanent(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [activeTab, searchQuery])

  /** After reschedule, open the meeting; duplicate-save audit (ReschedulePage already persists) */
  useEffect(() => {
    const audit = (location.state as MeetingsNavigateState | null)?.rescheduleAudit
    if (!audit?.bookingId) return
    saveBookingRescheduleAudit(audit.bookingId, {
      rescheduleEmail: audit.rescheduleEmail,
      reasonForChange: audit.reasonForChange,
    })
    if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
    setSelectedMeetingId(audit.bookingId)
    setPanelOpen(true)
    sidebar?.closeSidebar()
    navigate('/meetings', { replace: true, state: null })
  }, [location.state, navigate, sidebar])

  /** Open meeting panel when navigating from dashboard with ?meeting=id */
  useEffect(() => {
    const meetingId = searchParams.get('meeting')
    if (!meetingId || allBookingsWithRole.length === 0) return
    const booking = allBookingsWithRole.find(b => b.id === meetingId)
    if (booking) {
      if (panelCloseTimer.current) clearTimeout(panelCloseTimer.current)
      setSelectedMeetingId(meetingId)
      setPanelOpen(true)
      sidebar?.closeSidebar()
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, allBookingsWithRole, setSearchParams])

  return (
    <div
      data-testid="meetings-page"
      className="flex flex-col min-h-0 overflow-hidden bg-[#F3F4F6] h-[calc(100vh-1px)]"
    >
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          className={`flex-1 flex flex-col min-h-0 p-2 min-w-0 md:p-4 ${
            panelOpen ? 'max-md:hidden' : ''
          }`}
        >
          <div className="max-w-[1600px] w-full flex flex-col min-h-0 px-1 flex-1 md:px-2">
            <PageHeader
              title={<h1 className="text-2xl font-bold text-[#111827] tracking-tight md:text-3xl">Meetings</h1>}
              subtitle={<p className="text-xs font-medium text-[#111827] md:text-sm">Manage your schedule</p>}
              actions={
                <div className="flex w-full flex-col gap-2 max-md:items-stretch md:w-auto md:flex-row md:items-center md:gap-4">
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-3 text-[11px] font-medium transition-all focus:ring-1 focus:ring-black md:text-[12px]"
                    />
                  </div>
                  <button
                    type="button"
                    className="app-btn-primary max-md:justify-center max-md:text-xs max-md:py-2"
                    onClick={() => navigate('/events')}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Meeting
                  </button>
                </div>
              }
            />

            {/* Tabs */}
            <div className="mb-3 flex shrink-0 flex-col gap-2 md:mb-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
                {tabs.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold capitalize transition-all md:px-3 md:py-1.5 md:text-[12px] ${
                      activeTab === tab ? 'bg-white shadow-sm text-black' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[10px] font-medium text-gray-500 md:text-[12px]">
                <span>Showing</span>
                <span className="text-[#111827] font-bold">
                  {(page - 1) * MEETINGS_PER_PAGE + 1}-{Math.min(page * MEETINGS_PER_PAGE, filteredMeetings.length)}
                </span>
                <span>of {filteredMeetings.length} results</span>
              </div>
            </div>

            {/* Scrollable table block — flexes to fill, scrolls inside */}
            <div
              className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-200 bg-white md:rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {meetings.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-gray-500 text-sm font-medium">No meetings scheduled.</p>
                </div>
              ) : (
                <table className="w-full table-fixed border-collapse text-left md:table-auto">
                  <thead>
                    <tr className="border-b border-gray-200 text-[9px] font-bold uppercase tracking-wider text-[#111827] md:text-xs md:tracking-widest">
                      <th className="w-[39%] px-2 py-2 md:w-auto md:px-6 md:py-4">Profile</th>
                      <th className="w-[39%] px-1 py-2 text-left md:w-auto md:pl-2 md:pr-6 md:py-4">Contact</th>
                      <th className="w-[22%] px-1 py-2 text-left md:w-auto md:px-6 md:py-4">Status</th>
                      <th className="hidden w-[11%] px-1 py-2 text-right md:table-cell md:w-auto md:px-6 md:py-4">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {meetings.map(booking => {
                      const cp = getCounterpartyDisplay(booking, profiles, roomUsersById)
                      const d = new Date(booking.startTime)
                      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      const timeStr = formatTime(booking.startTime)
                      const statusLabel = getMeetingStatusLabel(booking)

                      return (
                        <tr
                          key={booking.id}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer transition-colors hover:bg-gray-100 group"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleSelectMeeting(booking)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleSelectMeeting(booking)
                            }
                          }}
                        >
                          <td className="min-w-0 px-2 py-2 align-top md:px-6 md:py-4">
                            <div className="flex min-w-0 items-center gap-2 md:gap-3">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100 text-[10px] font-bold text-[#111827] md:h-8 md:w-8 md:text-[12px]">
                                {cp.imageUrl ? (
                                  <img src={cp.imageUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  getInitials(cp.name || cp.email)
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-[10px] font-bold text-indigo-600 hover:underline md:text-[12px]">{cp.name}</p>
                                <p className="truncate text-[10px] font-medium text-gray-500 md:text-[12px]">{dateStr} at {timeStr}</p>
                              </div>
                            </div>
                          </td>
                          <td className="min-w-0 px-1 py-2 align-top md:pl-2 md:pr-6 md:py-4">
                            <div className="min-w-0 space-y-0.5">
                              <p className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-[#111827] md:gap-1.5 md:text-[12px]">
                                <Mail className="hidden h-3.5 w-3.5 shrink-0 text-gray-400 md:block" />
                                <span className="truncate">{cp.email}</span>
                              </p>
                            </div>
                          </td>
                          <td className="min-w-0 px-1 py-2 align-top text-left md:px-6 md:py-4">
                            <span
                              className={`inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide whitespace-nowrap md:px-2.5 md:py-0.5 md:text-[12px] md:tracking-wider ${
                                statusLabel === 'Upcoming'
                                  ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                                  : statusLabel === 'No show'
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : statusLabel === 'Past'
                                      ? 'border-gray-200 bg-gray-100 text-gray-600'
                                      : 'border-red-100 bg-red-50 text-red-600'
                              }`}
                            >
                              {statusLabel}
                            </span>
                          </td>
                          <td className="hidden px-1 py-2 text-right align-top md:table-cell md:px-6 md:py-4">
                            <button
                              type="button"
                              onClick={e => { e.preventDefault(); e.stopPropagation(); handleSelectMeeting(booking) }}
                              className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 hover:underline md:text-[12px] md:tracking-wider"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {filteredMeetings.length > MEETINGS_PER_PAGE && (
              <div className="mt-3 flex shrink-0 items-center justify-between md:mt-4">
                <p className="text-[10px] font-medium text-gray-500 md:text-[12px]">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="app-btn-secondary py-1.5 px-3 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="app-btn-secondary py-1.5 px-3 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className={`flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out shrink-0 min-w-0 ${
            panelOpen ? 'w-full md:w-[480px]' : 'w-0'
          }`}
        >
          {detailPanelBooking && (
            <MeetingDetailPanel
              booking={detailPanelBooking}
              counterparty={getCounterpartyDisplay(detailPanelBooking, profiles, roomUsersById)}
              eventType={eventTypeMap.get(detailPanelBooking.eventTypeId)}
              onClose={handleClosePanel}
              onCancel={() => {
                if (selectedMeeting) {
                  setCancelActionError(null)
                  setCancelModalBooking(selectedMeeting)
                }
              }}
              canCancel={detailPanelBooking.status === 'confirmed'}
              onReschedule={
                detailPanelBooking.status === 'confirmed' && new Date(detailPanelBooking.startTime) > new Date()
                  ? () => navigate(`/meetings/reschedule/${detailPanelBooking.id}`)
                  : undefined
              }
              canMarkNoShow={canMarkNoShow}
              onRequestMarkNoShow={canMarkNoShow ? openMarkNoShowModal : undefined}
              isMarkNoShowPending={isMarkNoShowPending}
              canUndoNoShow={canUndoNoShow}
              onUndoNoShow={canUndoNoShow ? handleUndoNoShow : undefined}
              isUndoNoShowPending={isUndoNoShowPending}
              canDeletePermanently={canDeletePermanently}
              onRequestPermanentDelete={canDeletePermanently ? openPermanentDeleteModal : undefined}
              isPermanentDeletePending={isDeletingPermanent}
            />
          )}
        </div>
      </div>

      {/* Cancel Modal */}
      <Modal
        isOpen={!!cancelModalBooking}
        onClose={() => {
          setCancelModalBooking(null)
          setCancelActionError(null)
        }}
        title="Cancel Meeting?"
        subtitle="This action cannot be undone"
        variant="light"
      >
        {cancelModalBooking && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <p className="font-semibold text-[#111827]">{cancelModalBooking.eventTitle}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                with {getCounterpartyDisplay(cancelModalBooking, profiles, roomUsersById).name} on {formatDate(cancelModalBooking.startTime)}
              </p>
            </div>

            {cancelModalBooking.seriesId && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelSeries}
                  onChange={e => setCancelSeries(e.target.checked)}
                  className="rounded border-gray-300 bg-white text-[#111827] focus:ring-gray-300"
                />
                Cancel entire series ({bookings.filter(b => b.seriesId === cancelModalBooking.seriesId && b.status === 'confirmed').length} meetings)
              </label>
            )}

            <p className="text-sm text-gray-500">
              The other participant will be notified via email about this cancellation.
            </p>

            {cancelActionError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {cancelActionError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={() => {
                  setCancelModalBooking(null)
                  setCancelActionError(null)
                }}
                className="app-btn-secondary py-2 px-4"
              >
                Keep Meeting
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling || isSendingEmail}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-[12px] uppercase tracking-wider hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Meeting'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Permanent delete — past, cancelled, or no-show only */}
      <Modal
        isOpen={!!deleteModalBooking}
        onClose={() => {
          if (isDeletingPermanent) return
          setDeleteModalBooking(null)
          setPermanentDeleteError(null)
        }}
        title="Delete this meeting permanently?"
        subtitle="This cannot be undone"
        variant="light"
      >
        {deleteModalBooking && (
          <div className="space-y-4">
            <p className="text-sm text-[#374151] leading-relaxed">
              This removes the booking from BookWithMe for <strong>everyone</strong> (host and guest). Linked
              calendar entries we created for this slot are removed when possible. You will not be able to
              restore it.
            </p>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <p className="font-semibold text-[#111827]">{deleteModalBooking.eventTitle}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {formatDate(deleteModalBooking.startTime)} · {getMeetingStatusLabel(deleteModalBooking)}
              </p>
            </div>
            {permanentDeleteError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {permanentDeleteError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalBooking(null)
                  setPermanentDeleteError(null)
                }}
                disabled={isDeletingPermanent}
                className="app-btn-secondary py-2 px-4 disabled:opacity-50"
              >
                Keep meeting
              </button>
              <button
                type="button"
                onClick={confirmPermanentDelete}
                disabled={isDeletingPermanent}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold text-[12px] uppercase tracking-wider hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDeletingPermanent ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Mark no-show confirmation */}
      <Modal
        isOpen={!!noShowModal}
        onClose={() => !isMarkNoShowPending && setNoShowModal(null)}
        title="Mark as no-show?"
        variant="light"
      >
        {noShowModal && (
          <div className="space-y-4">
            <p className="text-sm text-[#374151] leading-relaxed">
              Are you sure you want to mark &ldquo;{noShowModal.guestName}&rdquo; as a no-show?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNoShowModal(null)}
                disabled={isMarkNoShowPending}
                className="app-btn-secondary py-2 px-4"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMarkNoShowModal}
                disabled={isMarkNoShowPending}
                className="py-2 px-4 rounded-lg font-bold text-[12px] uppercase tracking-wider bg-black text-white hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isMarkNoShowPending ? 'Saving…' : 'Mark as no show'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
